import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { Check, ChevronLeft, ChevronRight, Clapperboard, FileDown, AppWindow, Glasses, History, Pause, PenLine, Play, Square, X } from "lucide-react";
import { useStore } from "../store";
import type { TreeNode } from "../types";
import { tNow, useT } from "../lib/i18n";
import { api, errorText, type ImpNode } from "../lib/api";
import { changes, resolveAll, resolveChange, type Change } from "../lib/track";
import { pauseReading, startReading, stopReading, ttsAvailable, useTts } from "../lib/tts";
import { findAll } from "../lib/editorExtensions";
import { locate } from "../lib/tree";
import { newId } from "../lib/ids";
import { VariantsBar } from "./Variants";
import { comboFor } from "../lib/shortcuts";
import { openPanel } from "../lib/panels";

/** Barra de la Hoja: Lápiz rojo, Lupa, lectura en voz alta y modo guion. */
export default function EditorBar({ editor, node }: { editor: Editor | null; node: TreeNode }) {
  const t = useT();
  const tracking = useStore((s) => s.project!.manifest.prefs.trackChanges);
  const lens = useStore((s) => s.settings.lens);
  const screenplay = useStore((s) => Boolean(locate(s.project!.manifest, node.id)?.node.screenplay));
  const speaking = useTts((s) => s.speaking);
  const paused = useTts((s) => s.paused);
  const edit = useStore((s) => s.editManifest);
  const [list, setList] = useState<Change[]>([]);

  // Lista de cambios actualizada con cada edición.
  useEffect(() => {
    if (!editor) return;
    const update = () => setList(changes(editor.state.doc));
    update();
    editor.on("update", update);
    editor.on("create", update);
    return () => {
      editor.off("update", update);
      editor.off("create", update);
    };
  }, [editor]);

  const at = () => {
    if (!editor) return null;
    const pos = editor.state.selection.from;
    return list.find((c) => pos >= c.from && pos <= c.to) ?? list.find((c) => c.from >= pos) ?? list[0] ?? null;
  };
  const go = (dir: 1 | -1) => {
    if (!editor || !list.length) return;
    const pos = editor.state.selection.from;
    const target = dir > 0 ? list.find((c) => c.from > pos) ?? list[0] : [...list].reverse().find((c) => c.to < pos) ?? list[list.length - 1];
    editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).scrollIntoView().run();
  };
  const resolve = (accept: boolean) => {
    const c = at();
    if (!editor || !c) return;
    editor.view.dispatch(resolveChange(editor.state, c, accept));
    setTimeout(() => go(1), 0);
  };
  const all = async (accept: boolean) => {
    if (!editor || !list.length) return;
    if (!(await ask(tNow(accept ? "rev.acceptAllAsk" : "rev.rejectAllAsk", { n: list.length }), { kind: "warning" }))) return;
    editor.view.dispatch(resolveAll(editor.state, accept));
  };

  const importReview = async () => {
    if (!editor) return;
    const path = await open({ multiple: false, filters: [{ name: "Word", extensions: ["docx"] }] });
    if (typeof path !== "string") return;
    try {
      const doc = await api.docxReview(path);
      const flat: ImpNode[] = [];
      const walk = (l: ImpNode[]) => l.forEach((n) => (n.kind === "text" ? flat.push(n) : walk(n.children)));
      walk(doc.manuscript);
      let added = 0;
      const type = editor.schema.marks.comment;
      const newComments: { id: string; text: string; author: string; created: string; resolved: boolean }[] = [];
      let tr = editor.state.tr;
      for (const n of flat)
        for (const c of n.comments) {
          const m = new RegExp(`\\{\\{c:${c.id}\\}\\}([\\s\\S]*?)\\{\\{/c\\}\\}`).exec(n.body);
          const anchor = m?.[1].replace(/\\(.)/g, "$1").replace(/\*\*|\*|~~|\{\+\+|\+\+\}|\{--|--\}/g, "").trim();
          if (!anchor || anchor.length < 2) continue;
          const re = new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u");
          const hit = findAll(tr.doc, new RegExp(re.source, "gu"))[0];
          if (!hit) continue;
          const id = newId();
          tr = tr.addMark(hit.from, hit.to, type.create({ id }));
          newComments.push({ id, text: c.text, author: c.author || "Word", created: c.date || new Date().toISOString(), resolved: false });
          added++;
        }
      if (added) {
        editor.view.dispatch(tr);
        edit((mm) => {
          const nn = locate(mm, node.id)!.node;
          nn.comments = [...(nn.comments ?? []), ...newComments];
        });
      }
      useStore.getState().toast(t("rev.imported", { n: added }));
    } catch (e) {
      useStore.getState().toast(errorText(e), "error");
    }
  };

  return (
    <div className="editor-bar">
      <button className={`eb-btn ${tracking ? "on red" : ""}`} onClick={() => edit((mm) => void (mm.prefs.trackChanges = !mm.prefs.trackChanges))} title={t("rev.toggleHint")}>
        <PenLine size={14} /> {t("rev.title")}
      </button>
      {(tracking || list.length > 0) && (
        <span className="eb-group">
          <span className="muted">{t("rev.count", { n: list.length })}</span>
          <button className="icon-btn" title={t("rev.prev")} onClick={() => go(-1)} disabled={!list.length}>
            <ChevronLeft size={15} />
          </button>
          <button className="icon-btn" title={t("rev.next")} onClick={() => go(1)} disabled={!list.length}>
            <ChevronRight size={15} />
          </button>
          <button className="icon-btn ok" title={t("rev.accept")} onClick={() => resolve(true)} disabled={!list.length}>
            <Check size={15} />
          </button>
          <button className="icon-btn danger" title={t("rev.reject")} onClick={() => resolve(false)} disabled={!list.length}>
            <X size={15} />
          </button>
          <button className="eb-link" onClick={() => void all(true)} disabled={!list.length}>
            {t("rev.acceptAll")}
          </button>
          <button className="eb-link" onClick={() => void all(false)} disabled={!list.length}>
            {t("rev.rejectAll")}
          </button>
        </span>
      )}
      <button className="eb-btn" onClick={() => void importReview()} title={t("rev.importHint")}>
        <FileDown size={14} /> {t("rev.import")}
      </button>
      <VariantsBar node={node} />
      <button className="eb-btn" onClick={() => useStore.setState({ timeMachine: node.id })} title={`${t("tm.title")} (${comboFor("timeMachine")})`}>
        <History size={14} /> {t("tm.short")}
      </button>
      <button className="icon-btn" title={t("panel.open")} onClick={() => void openPanel("text", node.id, node.title)}>
        <AppWindow size={14} />
      </button>
      <span className="spacer" />
      <button className={`eb-btn ${lens ? "on" : ""}`} onClick={() => useStore.getState().setSettings({ lens: !lens })} title={t("lens.hint")}>
        <Glasses size={14} /> {t("lens.title")}
      </button>
      {ttsAvailable() &&
        (speaking ? (
          <span className="eb-group">
            <button className="icon-btn on" onClick={pauseReading} title={paused ? t("tts.resume") : t("tts.pause")}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button className="icon-btn" onClick={stopReading} title={t("tts.stop")}>
              <Square size={13} />
            </button>
          </span>
        ) : (
          <button className="eb-btn" onClick={() => editor && startReading(editor)} title={t("tts.hint")}>
            <Play size={14} /> {t("tts.read")}
          </button>
        ))}
      <button className={`eb-btn ${screenplay ? "on" : ""}`} onClick={() => edit((mm) => void (locate(mm, node.id)!.node.screenplay = !screenplay))} title={t("sp.hint")}>
        <Clapperboard size={14} /> {t("sp.title")}
      </button>
    </div>
  );
}
