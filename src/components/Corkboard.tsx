import { useRef, useState } from "react";
import { ArrowUp, FilePlus2, Folder } from "lucide-react";
import { useStore } from "../store";
import type { Manifest, TreeNode } from "../types";
import { useT } from "../lib/i18n";
import { locate, moveNode, moveToSection, walk, wordsOf, type DropZone } from "../lib/tree";
import { formatNumber } from "../lib/words";
import { povColor } from "../lib/model";
import { createNode } from "./Binder";

type Item = { kind: "header"; id: string; title: string } | { kind: "card"; node: TreeNode };

/** Carpeta cuyo contenido se ve: la seleccionada, o la del texto seleccionado. */
function containerOf(m: Manifest, selected: string | null): { folder: TreeNode | null; list: TreeNode[] } {
  const loc = selected ? locate(m, selected) : null;
  if (!loc || loc.section === "trash") return { folder: null, list: m.sections.manuscript };
  if (loc.node.type === "folder") return { folder: loc.node, list: loc.node.children ?? [] };
  return { folder: loc.parent, list: loc.list };
}

export default function Corkboard() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const selected = useStore((s) => s.selected);
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const edit = useStore((s) => s.editManifest);
  const [scope, setScope] = useState<"folder" | "book">("folder");
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);
  const dragId = useRef<string | null>(null);

  const { folder, list } = containerOf(m, selected);
  const items: Item[] = [];
  if (scope === "folder") list.forEach((n) => items.push({ kind: "card", node: n }));
  else
    walk(m.sections.manuscript, (n) => {
      if (n.type === "folder") items.push({ kind: "header", id: n.id, title: n.title });
      else items.push({ kind: "card", node: n });
    });

  const parentLoc = folder ? locate(m, folder.id) : null;

  const onDrop = (target: TreeNode, zone: DropZone) => {
    const id = dragId.current;
    setDrop(null);
    if (id) edit((mm) => void moveNode(mm, id, target.id, zone));
  };

  const newCard = () => {
    if (folder) useStore.setState({ selected: folder.id });
    else useStore.setState({ selected: null });
    createNode("text");
    useStore.setState({ view: "corcho", renaming: null });
  };

  return (
    <div className="view cork-view">
      <div className="view-head">
        {scope === "folder" && folder && (
          <button className="icon-btn" title={t("cork.up")} onClick={() => useStore.setState({ selected: parentLoc?.parent?.id ?? null })}>
            <ArrowUp size={16} />
          </button>
        )}
        <h2>{scope === "book" ? t("cork.wholeBook") : folder?.title ?? t("sec.manuscript")}</h2>
        <span className="spacer" />
        <div className="seg">
          <button className={scope === "folder" ? "on" : ""} onClick={() => setScope("folder")}>
            {t("cork.folder")}
          </button>
          <button className={scope === "book" ? "on" : ""} onClick={() => setScope("book")}>
            {t("cork.book")}
          </button>
        </div>
        <button className="btn" onClick={newCard}>
          <FilePlus2 size={15} /> {t("cork.newCard")}
        </button>
      </div>
      <div
        className="cork"
        onDragOver={(e) => dragId.current && e.preventDefault()}
        onDrop={(e) => {
          // Soltar en el hueco: al final de la carpeta.
          if (e.target !== e.currentTarget || !dragId.current) return;
          const id = dragId.current;
          setDrop(null);
          if (folder) edit((mm) => void moveNode(mm, id, folder.id, "inside"));
          else edit((mm) => void moveToSection(mm, id, "manuscript"));
        }}
      >
        {items.length === 0 && <p className="cork-empty">{t("cork.empty")}</p>}
        {items.map((it) =>
          it.kind === "header" ? (
            <h3 key={"h" + it.id} className="cork-header">
              {it.title}
            </h3>
          ) : (
            <IndexCard
              key={it.node.id}
              node={it.node}
              m={m}
              words={wordsOf(it.node, words)}
              lang={lang}
              selected={selected === it.node.id}
              drop={drop?.id === it.node.id ? drop.zone : null}
              onDragStart={() => (dragId.current = it.node.id)}
              onDragEnd={() => {
                dragId.current = null;
                setDrop(null);
              }}
              onDragOver={(zone) => dragId.current && dragId.current !== it.node.id && setDrop({ id: it.node.id, zone })}
              onDrop={(zone) => onDrop(it.node, zone)}
            />
          ),
        )}
      </div>
    </div>
  );
}

interface CardProps {
  node: TreeNode;
  m: Manifest;
  words: number;
  lang: string;
  selected: boolean;
  drop: DropZone | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (zone: DropZone) => void;
  onDrop: (zone: DropZone) => void;
}

function IndexCard({ node, m, words, lang, selected, drop, onDragStart, onDragEnd, onDragOver, onDrop }: CardProps) {
  const t = useT();
  const edit = useStore((s) => s.editManifest);
  const pin = povColor(m, node) ?? (node.type === "folder" ? "var(--sub)" : `var(--st-${node.status})`);
  const zone = (e: React.DragEvent): DropZone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (node.type === "folder" && e.clientX > r.left + r.width * 0.3 && e.clientX < r.right - r.width * 0.3) return "inside";
    return e.clientX < r.left + r.width / 2 ? "before" : "after";
  };
  const pov = node.pov ? m.codex.find((c) => c.id === node.pov) : null;

  return (
    <div
      className={`index-card ${selected ? "on" : ""} ${node.type === "folder" ? "folder" : ""} ${drop ? "drop-" + drop : ""} ${!node.include ? "excluded" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", node.title);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver(zone(e));
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(zone(e));
      }}
      onClick={() => useStore.getState().select(node.id)}
      onDoubleClick={() => useStore.setState({ selected: node.id, view: node.type === "folder" ? "corcho" : "hoja" })}
    >
      <span className="pin" style={{ background: pin }} />
      <div className="ic-title">
        {node.type === "folder" && <Folder size={14} />}
        <b>{node.title}</b>
      </div>
      <textarea
        className="ic-syn"
        value={node.synopsis}
        placeholder={t("insp.synopsisPh")}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onChange={(e) => edit((mm) => void (locate(mm, node.id)!.node.synopsis = e.target.value))}
      />
      <div className="ic-foot">
        {node.type === "text" && <span className="pill-st" style={{ background: `var(--st-${node.status})` }} title={t(`status.${node.status}`)} />}
        {pov && <span style={{ color: pov.color }}>{pov.name}</span>}
        {node.day && <span>{node.day}</span>}
        <span className="spacer" />
        <span>{node.type === "folder" ? t("cork.items", { n: node.children?.length ?? 0 }) : formatNumber(words, lang)}</span>
      </div>
    </div>
  );
}
