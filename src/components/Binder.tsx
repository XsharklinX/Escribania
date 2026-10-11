import { useEffect, useRef, useState, type DragEvent, type MouseEvent as RMouseEvent } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileImage,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  Globe,
  Library,
  NotebookPen,
  Paperclip,
  Trash2,
} from "lucide-react";
import { useStore } from "../store";
import type { SectionId, Status, TreeNode } from "../types";
import { tNow, useT, type TKey } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { folder, text } from "../lib/templates";
import { newId } from "../lib/ids";
import { importFiles } from "../lib/assets";
import { povColor } from "../lib/model";
import {
  assetsIn,
  bookWords,
  filesIn,
  insertNear,
  locate,
  moveNode,
  moveToSection,
  restoreNode,
  SECTIONS,
  trashNode,
  visibleIds,
  wordsOf,
  type DropZone,
} from "../lib/tree";
import { formatNumber } from "../lib/words";
import Modal from "./Modal";
import { CollectionList, CollectionsBar } from "./Collections";

export const STATUSES: Status[] = ["idea", "draft", "revised", "final"];

export function createNode(type: "text" | "folder") {
  const st = useStore.getState();
  if (!st.project) return;
  const title = tNow(type === "text" ? "tree.newTextTitle" : "tree.newFolderTitle");
  const node = type === "text" ? text(title) : folder(title);
  st.editManifest((m) => insertNear(m, node, st.selected));
  if (node.file) void api.textWrite(st.project.root, node.file, node.id, node.title, "").catch(() => {});
  useStore.setState({ selected: node.id, renaming: node.id, view: st.view === "hoja" || st.view === "corcho" || st.view === "escaleta" ? st.view : "hoja" });
}

/** Mete un nodo en Investigación: junto a lo seleccionado si ya está allí. */
function addToResearch(node: TreeNode) {
  const st = useStore.getState();
  st.editManifest((m) => {
    const sel = st.selected ? locate(m, st.selected) : null;
    if (sel?.section === "research") insertNear(m, node, st.selected);
    else m.sections.research.push(node);
  });
  useStore.setState({ selected: node.id, view: "hoja" });
}

export async function importResearch() {
  const files = await importFiles("investigacion", ["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "md", "html", "htm"]);
  for (const f of files) {
    addToResearch({ id: newId(), type: "file", title: f.name.replace(/\.[^.]+$/, ""), asset: f.rel, mime: f.mime, status: "draft", include: false, synopsis: "", notes: "", target: 0 });
  }
}

export function openBeside(id: string) {
  const st = useStore.getState();
  const loc = st.project ? locate(st.project.manifest, id) : null;
  if (!loc || loc.node.type === "folder") return;
  useStore.setState({ split: { kind: loc.node.type === "text" ? "text" : "research", id }, view: "hoja" });
}

async function deleteForever(ids: string[]) {
  const st = useStore.getState();
  const p = st.project;
  if (!p) return;
  const files: string[] = [];
  const assets: string[] = [];
  for (const id of ids) {
    const loc = locate(p.manifest, id);
    if (loc) {
      files.push(...filesIn([loc.node]));
      assets.push(...assetsIn([loc.node]));
    }
  }
  st.editManifest((m) => {
    for (const id of ids) {
      const loc = locate(m, id);
      if (loc) loc.list.splice(loc.index, 1);
    }
  });
  for (const f of files) await api.textDelete(p.root, f).catch(() => {});
  for (const a of assets) await api.assetDelete(p.root, a).catch(() => {});
}

export async function emptyTrash() {
  const p = useStore.getState().project;
  if (!p || !p.manifest.sections.trash.length) return;
  if (!(await ask(tNow("tree.emptyTrashAsk"), { title: tNow("tree.emptyTrash"), kind: "warning" }))) return;
  await deleteForever(p.manifest.sections.trash.map((n) => n.id));
}

const SECTION_ICON = { manuscript: BookOpen, research: Library, notes: NotebookPen, trash: Trash2 };
const SECTION_LABEL: Record<SectionId, TKey> = { manuscript: "sec.manuscript", research: "sec.research", notes: "sec.notes", trash: "sec.trash" };

export function nodeIcon(n: TreeNode) {
  if (n.type === "folder") return n.open ? FolderOpen : Folder;
  if (n.type === "link") return Globe;
  if (n.type === "file") return n.mime?.startsWith("image/") ? FileImage : n.mime === "application/pdf" ? FileType2 : Paperclip;
  return FileText;
}

type Drop = { id: string; zone: DropZone } | { section: SectionId } | null;
type Menu = { x: number; y: number; id: string | null; section: SectionId } | null;

export default function Binder() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const selected = useStore((s) => s.selected);
  const collection = useStore((s) => s.collection);
  const [drop, setDrop] = useState<Drop>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [webOpen, setWebOpen] = useState(false);
  const dragId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mantener visible la fila seleccionada.
  useEffect(() => {
    scrollRef.current?.querySelector(".row.on")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const st = useStore.getState();
    const ids = SECTIONS.flatMap((s) => visibleIds(m.sections[s]));
    const i = selected ? ids.indexOf(selected) : -1;
    const loc = selected ? locate(m, selected) : null;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) st.select(next);
    } else if (e.key === "ArrowRight" && loc?.node.type === "folder") {
      st.editManifest((mm) => void (locate(mm, loc.node.id)!.node.open = true));
    } else if (e.key === "ArrowLeft" && loc?.node.type === "folder") {
      st.editManifest((mm) => void (locate(mm, loc.node.id)!.node.open = false));
    } else if (e.key === "F2" && selected) {
      useStore.setState({ renaming: selected });
    } else if (e.key === "Delete" && selected && loc) {
      e.preventDefault();
      if (loc.section !== "trash") st.editManifest((mm) => void trashNode(mm, selected));
    }
  };

  const openMenu = (e: RMouseEvent, id: string | null, section: SectionId) => {
    e.preventDefault();
    if (id) useStore.getState().select(id);
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 320), id, section });
  };

  return (
    <aside className="binder" onClick={() => setMenu(null)}>
      <CollectionsBar dragId={dragId} />
      <div className="binder-scroll" ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown}>
        {collection && <CollectionList />}
        {!collection && SECTIONS.map((sec) => {
          const Icon = SECTION_ICON[sec];
          const list = m.sections[sec];
          const total = sec === "manuscript" ? bookWords(m, words) : list.reduce((s, n) => s + wordsOf(n, words), 0);
          return (
            <div key={sec}>
              <div
                className={`sec-head ${drop && "section" in drop && drop.section === sec ? "drop" : ""}`}
                onContextMenu={(e) => openMenu(e, null, sec)}
                onDragOver={(e) => {
                  if (!dragId.current) return;
                  e.preventDefault();
                  setDrop({ section: sec });
                }}
                onDragLeave={() => setDrop(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragId.current;
                  setDrop(null);
                  if (id) useStore.getState().editManifest((mm) => void moveToSection(mm, id, sec));
                }}
              >
                <Icon size={13} /> {t(SECTION_LABEL[sec])}
                <span className="n">{total > 0 ? formatNumber(total, lang) : ""}</span>
                {sec === "research" && (
                  <button className="sec-add" title={t("res.import")} onClick={() => void importResearch()}>
                    +
                  </button>
                )}
              </div>
              {list.length === 0 && <div className="empty-sec">{t(sec === "research" ? "res.empty" : "tree.emptySection")}</div>}
              {list.map((n) => (
                <Row key={n.id} node={n} depth={0} section={sec} drop={drop} setDrop={setDrop} dragId={dragId} openMenu={openMenu} />
              ))}
            </div>
          );
        })}
      </div>
      {menu && <ContextMenu menu={menu} close={() => setMenu(null)} openWeb={() => setWebOpen(true)} />}
      {webOpen && <WebPageDialog onClose={() => setWebOpen(false)} />}
    </aside>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  section: SectionId;
  drop: Drop;
  setDrop: (d: Drop) => void;
  dragId: React.MutableRefObject<string | null>;
  openMenu: (e: RMouseEvent, id: string | null, section: SectionId) => void;
}

function Row({ node, depth, section, drop, setDrop, dragId, openMenu }: RowProps) {
  const selected = useStore((s) => s.selected === node.id);
  const renaming = useStore((s) => s.renaming === node.id);
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const edit = useStore((s) => s.editManifest);
  const pov = useStore((s) => povColor(s.project!.manifest, node));
  const [dragging, setDragging] = useState(false);
  const isFolder = node.type === "folder";
  const w = wordsOf(node, words);

  const zoneFor = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (isFolder) return y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    return y < 0.5 ? "before" : "after";
  };
  const myDrop = drop && "id" in drop && drop.id === node.id ? drop.zone : null;

  const commitRename = (value: string) => {
    const v = value.trim();
    if (v && v !== node.title) edit((m) => void (locate(m, node.id)!.node.title = v));
    useStore.setState({ renaming: null });
  };

  const Icon = nodeIcon(node);
  return (
    <>
      <div
        className={`row ${selected ? "on" : ""} ${!node.include && section === "manuscript" ? "excluded" : ""} ${dragging ? "dragging" : ""} ${myDrop ? "drop-" + myDrop : ""}`}
        style={{ paddingLeft: 4 + depth * 16 }}
        draggable={!renaming}
        onClick={() => {
          const st = useStore.getState();
          st.select(node.id);
          if (st.view !== "hoja" && st.view !== "corcho" && st.view !== "escaleta" && st.view !== "estructura") st.setView("hoja");
        }}
        onDoubleClick={() => useStore.setState({ renaming: node.id })}
        onContextMenu={(e) => openMenu(e, node.id, section)}
        onDragStart={(e) => {
          dragId.current = node.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.title);
          setDragging(true);
        }}
        onDragEnd={() => {
          dragId.current = null;
          setDragging(false);
          setDrop(null);
        }}
        onDragOver={(e) => {
          const id = dragId.current;
          if (!id || id === node.id) return;
          e.preventDefault();
          e.stopPropagation();
          const zone = zoneFor(e);
          if (!myDrop || myDrop !== zone) setDrop({ id: node.id, zone });
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = dragId.current;
          const zone = zoneFor(e);
          setDrop(null);
          if (id) edit((m) => void moveNode(m, id, node.id, zone));
        }}
      >
        {isFolder ? (
          <button
            className="chev"
            onClick={(e) => {
              e.stopPropagation();
              edit((m) => void (locate(m, node.id)!.node.open = !node.open));
            }}
            aria-label={node.open ? "Plegar" : "Desplegar"}
          >
            {node.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span style={{ width: 16, flex: "none" }} />
        )}
        <Icon size={14} className="ic" style={pov ? { color: pov } : undefined} />
        {renaming ? (
          <input
            className="rename"
            autoFocus
            defaultValue={node.title}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename(e.currentTarget.value);
              if (e.key === "Escape") useStore.setState({ renaming: null });
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="t">{node.title}</span>
        )}
        {w > 0 && !renaming && <span className="w">{formatNumber(w, lang)}</span>}
        {node.type === "text" && <span className="dot" style={{ background: `var(--st-${node.status})` }} title={tNow(`status.${node.status}`)} />}
      </div>
      {isFolder &&
        node.open &&
        (node.children ?? []).map((c) => (
          <Row key={c.id} node={c} depth={depth + 1} section={section} drop={drop} setDrop={setDrop} dragId={dragId} openMenu={openMenu} />
        ))}
    </>
  );
}

function ContextMenu({ menu, close, openWeb }: { menu: NonNullable<Menu>; close: () => void; openWeb: () => void }) {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const loc = menu.id ? locate(m, menu.id) : null;
  const node = loc?.node;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".menu")) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  const act = (fn: () => void) => () => {
    fn();
    close();
  };

  const inTrash = menu.section === "trash";
  const inResearch = menu.section === "research";
  return (
    <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
      {!inTrash && (
        <>
          <button onClick={act(() => createNode("text"))}>
            <FileText size={14} /> {t(inResearch ? "res.note" : "tree.newText")}
          </button>
          <button onClick={act(() => createNode("folder"))}>
            <Folder size={14} /> {t("tree.newFolder")}
          </button>
        </>
      )}
      {inResearch && (
        <>
          <button onClick={act(() => void importResearch())}>
            <Paperclip size={14} /> {t("res.import")}
          </button>
          <button onClick={act(openWeb)}>
            <Globe size={14} /> {t("res.web")}
          </button>
        </>
      )}
      {node && !inTrash && (
        <>
          <hr />
          {node.type !== "folder" && (
            <button onClick={act(() => openBeside(node.id))}>
              <Columns2 size={14} /> {t("split.open")}
            </button>
          )}
          <button onClick={act(() => useStore.setState({ renaming: node.id }))}>{t("tree.rename")}</button>
          {loc?.section === "manuscript" && (
            <button onClick={act(() => edit((mm) => void (locate(mm, node.id)!.node.include = !node.include)))}>
              <input type="checkbox" readOnly checked={node.include} style={{ margin: 0 }} /> {t("tree.include")}
            </button>
          )}
          {node.type === "text" && (
            <div className="statuses">
              {STATUSES.map((s) => (
                <button key={s} onClick={act(() => edit((mm) => void (locate(mm, node.id)!.node.status = s)))} style={node.status === s ? { color: "var(--acc)", fontWeight: 600 } : undefined}>
                  <span className="dot" style={{ width: 7, height: 7, borderRadius: "50%", background: `var(--st-${s})` }} />
                  {t(`status.${s}`)}
                </button>
              ))}
            </div>
          )}
          <hr />
          <button className="danger" onClick={act(() => edit((mm) => void trashNode(mm, node.id)))}>
            <Trash2 size={14} /> {t("tree.toTrash")}
          </button>
        </>
      )}
      {node && inTrash && (
        <>
          <button onClick={act(() => edit((mm) => void restoreNode(mm, node.id)))}>{t("tree.restore")}</button>
          <button
            className="danger"
            onClick={act(async () => {
              if (await ask(tNow("tree.emptyTrashAsk"), { title: tNow("tree.deleteForever"), kind: "warning" })) await deleteForever([node.id]);
            })}
          >
            {t("tree.deleteForever")}
          </button>
        </>
      )}
      {inTrash && (
        <>
          {node && <hr />}
          <button className="danger" onClick={act(() => void emptyTrash())}>
            <Trash2 size={14} /> {t("tree.emptyTrash")}
          </button>
        </>
      )}
    </div>
  );
}

/** Guardar una página web en Investigación para leerla sin conexión. */
function WebPageDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = useState("https://");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (offline: boolean) => {
    const root = useStore.getState().project?.root;
    if (!root || !/^https?:\/\/.+\..+/.test(url)) return setError(t("res.badUrl"));
    setBusy(true);
    setError("");
    try {
      let title = url.replace(/^https?:\/\//, "").split("/")[0];
      let asset: string | undefined;
      if (offline) {
        const page = await api.webFetch(url);
        if (page.title) title = page.title;
        asset = await api.assetWriteText(root, "investigacion", title, "html", page.html);
      }
      addToResearch({ id: newId(), type: "link", title, url, asset, mime: asset ? "text/html" : undefined, status: "draft", include: false, synopsis: "", notes: "", target: 0 });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("res.web")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn" disabled={busy} onClick={() => void save(false)}>
            {t("res.linkOnly")}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void save(true)}>
            {busy ? t("res.downloading") : t("res.saveCopy")}
          </button>
        </>
      }
    >
      <div className="body">
        <label className="field">
          <span>{t("res.url")}</span>
          <input id="web-url" className="input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save(true)} />
        </label>
        <p className="muted">{t("res.webHint")}</p>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}
