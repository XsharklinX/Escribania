import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ExternalLink, FilePlus2, FileText, Folder, MessageSquarePlus, RotateCcw, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { Comment, TreeNode } from "../types";
import { tNow, useT } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { docToMarkdown, markdownToHtml } from "../lib/markdown";
import { countWords, formatNumber } from "../lib/words";
import { flushTexts, queueText } from "../lib/saver";
import { bookWords, locate, wordsOf } from "../lib/tree";
import {
  CommentMark,
  CurrentBlock,
  findAll,
  Mentions,
  mentionsKey,
  SearchHighlight,
  searchKey,
  searchRegex,
  WriterTypography,
} from "../lib/editorExtensions";
import { mentionTerms, refreshMentions } from "../lib/mentions";
import { trackDelta } from "../lib/journal";
import { useAsset, useBlobUrl } from "../lib/assets";
import { codexById } from "../lib/model";
import { newId } from "../lib/ids";
import { createNode, nodeIcon } from "./Binder";
import { EntryDetail } from "./CodexView";
import { Deletion, Insertion, TrackChanges } from "../lib/track";
import { SpellCheck, spellKey } from "../lib/spell";
import { DEFAULT_CRUTCHES, StyleLens, lensKey, useLens } from "../lib/style";
import { ReadAloud, stopReading, useTts } from "../lib/tts";
import { Screenplay } from "../lib/screenplay";
import EditorBar from "./EditorBar";
import SpellMenu from "./SpellMenu";

export default function EditorPane() {
  const t = useT();
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selected);
  const split = useStore((s) => s.split);
  const loc = selected ? locate(project.manifest, selected) : null;

  // La Hoja partida no puede mostrar el mismo texto dos veces.
  const showSplit = split && !(split.kind !== "codex" && split.id === selected);

  return (
    <div className={`editor-split ${showSplit ? "is-split" : ""}`}>
      <Pane node={loc?.node ?? null} empty={t("ed.nothing")} />
      {showSplit && (
        <div className="split-pane">
          <div className="split-head">
            <SplitTitle />
            <button className="icon-btn" onClick={() => useStore.setState({ split: null })} title={t("split.close")}>
              <X size={15} />
            </button>
          </div>
          {split.kind === "codex" ? (
            <div className="editor-area">
              <EntryDetail id={split.id} compact />
            </div>
          ) : (
            <Pane node={locate(project.manifest, split.id)?.node ?? null} empty={t("ed.nothing")} side />
          )}
        </div>
      )}
    </div>
  );
}

function SplitTitle() {
  const m = useStore((s) => s.project!.manifest);
  const split = useStore((s) => s.split)!;
  const title = split.kind === "codex" ? codexById(m, split.id)?.name : locate(m, split.id)?.node.title;
  return <b className="split-title">{title}</b>;
}

function Pane({ node, empty, side }: { node: TreeNode | null; empty: string; side?: boolean }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const prefs = useStore((s) => s.project!.manifest.prefs);
  const root = useStore((s) => s.project!.root);
  const reload = useStore((s) => s.reload);
  let content;
  if (!node) content = <div className="editor-empty">{empty}</div>;
  else if (node.type === "folder") content = <FolderView node={node} />;
  else if (node.type === "text")
    content = (
      // Un editor por texto: así el deshacer nunca mezcla dos escenas.
      <SceneEditor key={`${node.id}-${prefs.quotes}-${prefs.dialogueDash}-${reload}`} node={node} root={root} areaRef={areaRef} side={side} />
    );
  else content = <ResearchViewer node={node} />;
  return (
    <div className="editor-area" ref={areaRef}>
      {content}
    </div>
  );
}

let braveToast = 0;
const NO_COMMENTS: Comment[] = [];

function SceneEditor({ node, root, areaRef, side }: { node: TreeNode; root: string; areaRef: RefObject<HTMLDivElement | null>; side?: boolean }) {
  const t = useT();
  const prefs = useStore((s) => s.project!.manifest.prefs);
  const typewriter = useStore((s) => s.settings.typewriter);
  const ready = useRef(false);
  const currentHit = useRef(-1);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  const [hover, setHover] = useState<{ id: string; top: number; left: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const file = node.file!;
  const currentNode = () => {
    const p = useStore.getState().project;
    return p ? locate(p.manifest, node.id)?.node : undefined;
  };
  const [spellMenu, setSpellMenu] = useState<{ x: number; y: number; word: string; from: number; to: number } | null>(null);
  const typewriterRef = useRef(typewriter);
  typewriterRef.current = typewriter;

  const centerCaret = () => {
    const area = areaRef.current;
    if (!typewriterRef.current || !area || !editor || editor.isDestroyed) return;
    requestAnimationFrame(() => {
      try {
        const c = editor.view.coordsAtPos(editor.state.selection.head);
        const r = area.getBoundingClientRect();
        area.scrollTop += c.top - r.top - area.clientHeight * 0.45;
      } catch {
        /* el editor aún no está pintado */
      }
    });
  };

  const updateBubble = (ed: Editor) => {
    const sheet = sheetRef.current;
    const { from, to, empty } = ed.state.selection;
    if (empty || !sheet || !ready.current) return setBubble(null);
    try {
      const a = ed.view.coordsAtPos(from);
      const b = ed.view.coordsAtPos(to);
      const r = sheet.getBoundingClientRect();
      setBubble({ top: Math.min(a.top, b.top) - r.top - 40, left: (a.left + b.left) / 2 - r.left });
    } catch {
      setBubble(null);
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ code: false, codeBlock: false, link: false, underline: false, heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: t("ed.placeholder") }),
      WriterTypography.configure({ quotes: prefs.quotes, dialogueDash: prefs.dialogueDash }),
      CurrentBlock,
      CommentMark,
      Mentions.configure({ getTerms: () => (useStore.getState().project ? mentionTerms(useStore.getState().project!.manifest) : []) }),
      SearchHighlight.configure({
        getRegex: () => (useStore.getState().leftPanel === "search" ? searchRegex(useStore.getState().search) : null),
        getCurrent: () => currentHit.current,
      }),
      Insertion,
      Deletion,
      TrackChanges.configure({ isOn: () => Boolean(useStore.getState().project?.manifest.prefs.trackChanges) }),
      SpellCheck.configure({ isOn: () => useStore.getState().settings.spell === "app" }),
      StyleLens.configure({
        isOn: () => useStore.getState().settings.lens,
        lang: () => useStore.getState().settings.lang,
        long: () => useStore.getState().settings.lensLong,
        crutches: () => {
          const st = useStore.getState().settings;
          return [...DEFAULT_CRUTCHES[st.lang], ...st.crutches.split(",").map((x) => x.trim()).filter(Boolean)];
        },
      }),
      ReadAloud,
      Screenplay.configure({ isOn: () => Boolean(currentNode()?.screenplay) }),
    ],
    editable: false,
    editorProps: {
      attributes: { spellcheck: useStore.getState().settings.spell === "system" ? "true" : "false", lang: useStore.getState().settings.lang },
      handleKeyDown: (_view, event) => {
        const sp = useStore.getState().sprint;
        if (sp?.brave && !sp.finished && (event.key === "Backspace" || event.key === "Delete")) {
          if (Date.now() - braveToast > 4000) {
            braveToast = Date.now();
            useStore.getState().toast(tNow("sprint.braveBlocked"));
          }
          return true;
        }
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === "m") {
          addComment();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (!ready.current) return;
      if (useTts.getState().speaking) stopReading();
      const st = useStore.getState();
      const current = st.project ? locate(st.project.manifest, node.id)?.node : null;
      const before = st.words[file] ?? 0;
      const now = countWords(editor.getText({ blockSeparator: "\n" }));
      st.setWords(file, now);
      trackDelta(node.id, now - before);
      queueText({ root, file, id: node.id, title: current?.title ?? node.title, body: docToMarkdown(editor.getJSON()) });
      if (st.project?.manifest.codex.length) refreshMentions(4000);
      centerCaret();
      setLayoutTick((n) => n + 1);
    },
    onSelectionUpdate: ({ editor }) => {
      centerCaret();
      updateBubble(editor);
    },
  });

  // Cargar el texto del disco (después de guardar lo pendiente, por si se vuelve a un texto recién editado).
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    void (async () => {
      try {
        await flushTexts();
        const md = await api.textRead(root, file);
        if (cancelled || editor.isDestroyed) return;
        editor.commands.setContent(markdownToHtml(md), { emitUpdate: false });
        // El recuento del editor puede diferir un poco del que se hizo al abrir el
        // proyecto; esa diferencia no es escritura de esta sesión.
        const st = useStore.getState();
        const before = bookWords(st.project!.manifest, st.words);
        st.setWords(file, countWords(editor.getText({ blockSeparator: "\n" })));
        const now = useStore.getState();
        const drift = bookWords(now.project!.manifest, now.words) - before;
        if (drift) useStore.setState({ sessionStart: now.sessionStart + drift });
        ready.current = true;
        editor.setEditable(true, false); // sin emitir cambio: abrir no es escribir
        if (!side) editor.commands.focus("end");
        if (areaRef.current) areaRef.current.scrollTop = 0;
        centerCaret();
        setLayoutTick((n) => n + 1);
        jumpToHit();
      } catch (e) {
        useStore.getState().toast(errorText(e), "error");
      }
    })();
    return () => {
      cancelled = true;
      void flushTexts();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Señalar la coincidencia elegida en el panel de búsqueda.
  const jump = useStore((s) => s.jump);
  const jumpToHit = () => {
    const st = useStore.getState();
    if (!editor || !ready.current || !st.jump || st.jump.file !== file) return;
    const re = searchRegex(st.search);
    useStore.setState({ jump: null });
    if (!re) return;
    const hits = findAll(editor.state.doc, re);
    if (!hits.length) return;
    const i = Math.min(st.jump.index, hits.length - 1);
    currentHit.current = i;
    editor.chain().setTextSelection({ from: hits[i].from, to: hits[i].to }).scrollIntoView().run();
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, true));
  };
  useEffect(() => {
    jumpToHit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  // Repintar menciones y búsqueda cuando cambian el Códice o la consulta.
  const codexSig = useStore((s) => (s.settings.mentions ? JSON.stringify(s.project!.manifest.codex.map((e) => [e.name, e.aliases, e.color, e.mentions])) : ""));
  const searchSig = useStore((s) => (s.leftPanel === "search" ? JSON.stringify(s.search) : ""));
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(mentionsKey, true));
  }, [codexSig, editor]);
  useEffect(() => {
    currentHit.current = -1;
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(searchKey, true));
  }, [searchSig, editor]);

  // Repintar Lupa, corrector y guion cuando cambian sus ajustes.
  const pluginSig = useStore((s) =>
    JSON.stringify([s.settings.lens, s.settings.lensLong, s.settings.crutches, s.settings.spell, s.settings.lang, locate(s.project!.manifest, node.id)?.node.screenplay]),
  );
  const lensKinds = useLens((s) => s.kinds);
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(lensKey, true).setMeta(spellKey, true));
  }, [pluginSig, lensKinds, editor]);
  useEffect(() => () => stopReading(), []);
  const screenplay = useStore((s) => Boolean(locate(s.project!.manifest, node.id)?.node.screenplay));

  // ---------- Marginalia ----------
  const comments = useStore((s) => locate(s.project!.manifest, node.id)?.node.comments ?? NO_COMMENTS);
  const showResolved = useStore((s) => s.settings.showResolved);
  const visible = comments.filter((c) => showResolved || !c.resolved);

  const addComment = () => {
    if (!editor) return;
    const { empty } = editor.state.selection;
    if (empty) return useStore.getState().toast(tNow("cm.selectFirst"));
    const st = useStore.getState();
    const id = newId();
    editor.chain().focus().setMark("comment", { id }).run();
    const author = st.settings.authorName || st.project!.manifest.author || tNow("cm.you");
    st.editManifest((m) => {
      const n = locate(m, node.id)!.node;
      n.comments = [...(n.comments ?? []), { id, text: "", author, created: new Date().toISOString(), resolved: false }];
    });
    setActive(id);
    setBubble(null);
  };

  const removeMark = (id: string) => {
    if (!editor) return;
    const type = editor.schema.marks.comment;
    const tr = editor.state.tr;
    editor.state.doc.descendants((n, pos) => {
      if (n.isText && n.marks.some((mk) => mk.type === type && mk.attrs.id === id)) tr.removeMark(pos, pos + n.nodeSize, type);
    });
    if (tr.docChanged) editor.view.dispatch(tr);
  };

  const editComment = (id: string, patch: Partial<Comment>) =>
    useStore.getState().editManifest((m) => {
      const n = locate(m, node.id)!.node;
      n.comments = (n.comments ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c));
    });

  const deleteComment = (id: string) => {
    removeMark(id);
    useStore.getState().editManifest((m) => {
      const n = locate(m, node.id)!.node;
      n.comments = (n.comments ?? []).filter((c) => c.id !== id);
    });
  };

  // Posición de cada comentario: a la altura de su texto, sin solaparse.
  const [tops, setTops] = useState<Record<string, number>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !visible.length) return;
    const base = sheet.getBoundingClientRect().top;
    const wanted = visible
      .map((c) => {
        const el = sheet.querySelector(`.ProseMirror [data-comment="${c.id}"]`);
        return { id: c.id, top: el ? el.getBoundingClientRect().top - base : Number.MAX_SAFE_INTEGER };
      })
      .sort((a, b) => a.top - b.top);
    const next: Record<string, number> = {};
    let floor = 0;
    for (const w of wanted) {
      const top = Math.max(w.top === Number.MAX_SAFE_INTEGER ? floor : w.top, floor);
      next[w.id] = top;
      floor = top + (cardRefs.current[w.id]?.offsetHeight ?? 80) + 8;
    }
    if (JSON.stringify(next) !== JSON.stringify(tops)) setTops(next);
  });
  useEffect(() => {
    const onResize = () => setLayoutTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  void layoutTick;

  // ---------- Ecos: ficha al pasar el ratón ----------
  const onMouseOver = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest(".mention") as HTMLElement | null;
    const sheet = sheetRef.current;
    if (!el || !sheet) return;
    const r = el.getBoundingClientRect();
    const s = sheet.getBoundingClientRect();
    setHover({ id: el.dataset.entry!, top: r.bottom - s.top + 6, left: Math.max(0, r.left - s.left) });
  };
  const onMouseOut = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".mention")) setHover(null);
  };
  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const mention = target.closest(".mention") as HTMLElement | null;
    if (mention && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      useStore.setState({ split: { kind: "codex", id: mention.dataset.entry! } });
      return;
    }
    const c = target.closest("[data-comment]") as HTMLElement | null;
    if (c) setActive(c.dataset.comment!);
  };

  return (
    <>
    {!side && <EditorBar editor={editor} node={node} />}
    <div className={`sheet-wrap ${visible.length ? "has-comments" : ""}`}>
      <div
        className={`sheet ${screenplay ? "screenplay" : ""}`}
        onContextMenu={(e) => {
          const el = (e.target as HTMLElement).closest(".spell-error") as HTMLElement | null;
          if (!el || !editor) return;
          e.preventDefault();
          const from = editor.view.posAtDOM(el, 0);
          const word = el.dataset.word ?? el.textContent ?? "";
          setSpellMenu({ x: e.clientX, y: e.clientY, word, from, to: from + word.length });
        }}
        ref={sheetRef}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && editor) {
            e.preventDefault();
            editor.commands.focus("end");
          }
        }}
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        onClick={onClick}
      >
        <div className="scene-title">{node.title}</div>
        <EditorContent editor={editor} />
        {bubble && (
          <button className="comment-bubble" style={{ top: bubble.top, left: bubble.left }} onMouseDown={(e) => e.preventDefault()} onClick={addComment}>
            <MessageSquarePlus size={14} /> {t("cm.add")}
          </button>
        )}
        {hover && <MentionCard id={hover.id} style={{ top: hover.top, left: hover.left }} />}
        {visible.length > 0 && (
          <div className="margin-col">
            {visible.map((c) => (
              <div
                key={c.id}
                ref={(el) => {
                  cardRefs.current[c.id] = el;
                }}
                className={`cm-card ${active === c.id ? "active" : ""} ${c.resolved ? "resolved" : ""}`}
                style={{ top: tops[c.id] ?? 0 }}
                onClick={() => setActive(c.id)}
              >
                <div className="cm-head">
                  <b>{c.author}</b>
                  <span className="muted">{new Date(c.created).toLocaleDateString()}</span>
                  <button className="mini" title={c.resolved ? t("cm.reopen") : t("cm.resolve")} onClick={() => editComment(c.id, { resolved: !c.resolved })}>
                    {c.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
                  </button>
                  <button className="mini" title={t("cm.delete")} onClick={() => deleteComment(c.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <textarea
                  className="cm-text"
                  autoFocus={active === c.id && !c.text}
                  rows={Math.max(2, Math.ceil((c.text.length || 1) / 30))}
                  value={c.text}
                  placeholder={t("cm.placeholder")}
                  onChange={(e) => editComment(c.id, { text: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    {spellMenu && editor && (
      <SpellMenu
        {...spellMenu}
        onClose={() => setSpellMenu(null)}
        onReplace={(w) => {
          editor.chain().focus().insertContentAt({ from: spellMenu.from, to: spellMenu.to }, w).run();
          setSpellMenu(null);
        }}
      />
    )}
    </>
  );
}

function MentionCard({ id, style }: { id: string; style: React.CSSProperties }) {
  const t = useT();
  const entry = useStore((s) => codexById(s.project!.manifest, id));
  const appearances = useStore((s) => Object.keys(s.mentions[id] ?? {}).length);
  const img = useAsset(entry?.image);
  if (!entry) return null;
  const filled = entry.fields.filter((f) => f.v.trim()).slice(0, 3);
  return (
    <div className="mention-card" style={{ ...style, borderTopColor: entry.color }}>
      {img ? <img src={img} alt="" /> : <span className="avatar" style={{ background: entry.color }}>{entry.name.charAt(0)}</span>}
      <div>
        <b>{entry.name}</b>
        <small className="muted">{t(`kind.${entry.kind}`)}</small>
        {filled.map((f) => (
          <small key={f.k}>
            {f.k}: {f.v}
          </small>
        ))}
        <small className="muted">
          {t("ecos.appears", { n: appearances })} · {t("ecos.ctrlClick")}
        </small>
      </div>
    </div>
  );
}

function ResearchViewer({ node }: { node: TreeNode }) {
  const t = useT();
  const root = useStore((s) => s.project!.root);
  const isHtml = node.mime === "text/html";
  const isText = node.mime === "text/plain";
  const data = useAsset(!isHtml && !isText ? node.asset : null);
  const blob = useBlobUrl(node.mime === "application/pdf" ? data : null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if ((isHtml || isText) && node.asset) void api.assetReadText(root, node.asset).then(setText, () => setText(""));
  }, [node.asset, isHtml, isText, root]);
  const Icon = nodeIcon(node);

  return (
    <div className="research">
      <div className="research-head">
        <Icon size={16} className="muted" />
        <b>{node.title}</b>
        {node.url && (
          <button className="btn" onClick={() => void openUrl(node.url!).catch(() => {})}>
            <ExternalLink size={14} /> {t("res.openBrowser")}
          </button>
        )}
      </div>
      {node.url && <div className="path">{node.url}</div>}
      <div className="research-body">
        {node.mime?.startsWith("image/") && data && <img src={data} alt={node.title} />}
        {node.mime === "application/pdf" && blob && <iframe title={node.title} src={blob} />}
        {isHtml && text !== null && <iframe title={node.title} sandbox="" srcDoc={text} />}
        {isText && text !== null && <pre>{text}</pre>}
        {!node.asset && <p className="muted">{t("res.noCopy")}</p>}
      </div>
    </div>
  );
}

function FolderView({ node }: { node: TreeNode }) {
  const t = useT();
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const children = node.children ?? [];
  return (
    <div className="folder-view">
      <div style={{ display: "flex", alignItems: "end", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2>{node.title}</h2>
          <span className="muted">
            {formatNumber(wordsOf(node, words), lang)} {t("ed.words")}
          </span>
        </div>
        <button className="btn" onClick={() => createNode("text")}>
          <FilePlus2 size={15} /> {t("tree.newText")}
        </button>
      </div>
      {children.length === 0 && <p className="muted">{t("ed.folderEmpty")}</p>}
      {children.map((c) => (
        <button key={c.id} className="folder-card" onClick={() => useStore.getState().select(c.id)}>
          {c.type === "folder" ? <Folder size={16} className="muted" /> : <FileText size={16} className="muted" />}
          <b>{c.title}</b>
          <span className="w">{formatNumber(wordsOf(c, words), lang)}</span>
          {c.synopsis && <p>{c.synopsis}</p>}
        </button>
      ))}
    </div>
  );
}
