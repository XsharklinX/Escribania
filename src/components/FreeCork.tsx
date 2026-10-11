import { useRef, useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { TreeNode } from "../types";
import { useT } from "../lib/i18n";
import { locate } from "../lib/tree";
import { newId } from "../lib/ids";
import { povColor } from "../lib/model";

const W = 200;
const H = 120;
const COLORS = ["", "#F6E7A8", "#F7C9C1", "#C9E4CF", "#C7D7F5", "#E1D2F2"];

/**
 * Corcho libre: las fichas donde quieras, de colores para agruparlas y con
 * flechas entre escenas (pulsa «Unir» y luego dos fichas). Las posiciones se
 * guardan en el proyecto; las fichas nuevas aparecen en rejilla.
 */
export default function FreeCork({ nodes }: { nodes: TreeNode[] }) {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const selected = useStore((s) => s.selected);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);
  const [linking, setLinking] = useState<string | null | false>(false);
  const area = useRef<HTMLDivElement>(null);

  const pos = (n: TreeNode, i: number) => (drag?.id === n.id ? { x: drag.x, y: drag.y } : n.cork ?? { x: 30 + (i % 5) * (W + 30), y: 30 + Math.floor(i / 5) * (H + 40) });
  const ids = new Set(nodes.map((n) => n.id));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const center = (id: string) => {
    const n = nodes[index.get(id)!];
    const p = pos(n, index.get(id)!);
    return { x: p.x + W / 2, y: p.y + H / 2 };
  };
  const links = m.corkLinks.filter((l) => ids.has(l.from) && ids.has(l.to));
  const setNode = (id: string, fn: (n: TreeNode) => void) => edit((mm) => fn(locate(mm, id)!.node));

  const onDown = (e: React.PointerEvent, n: TreeNode, i: number) => {
    if ((e.target as HTMLElement).closest("button, textarea")) return;
    useStore.getState().select(n.id);
    if (linking !== false) {
      if (linking === null) setLinking(n.id);
      else if (linking !== n.id) {
        const from = linking;
        edit((mm) => void (!mm.corkLinks.some((l) => l.from === from && l.to === n.id) && mm.corkLinks.push({ id: newId(), from, to: n.id })));
        setLinking(null);
      }
      return;
    }
    const p = pos(n, i);
    const r = area.current!.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: n.id, dx: e.clientX - r.left + area.current!.scrollLeft - p.x, dy: e.clientY - r.top + area.current!.scrollTop - p.y, x: p.x, y: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag || !area.current) return;
    const r = area.current.getBoundingClientRect();
    setDrag({ ...drag, x: Math.max(0, e.clientX - r.left + area.current.scrollLeft - drag.dx), y: Math.max(0, e.clientY - r.top + area.current.scrollTop - drag.dy) });
  };
  const onUp = () => {
    if (!drag) return;
    const { id, x, y } = drag;
    setDrag(null);
    setNode(id, (n) => void (n.cork = { ...(n.cork ?? {}), x: Math.round(x), y: Math.round(y) }));
  };

  const maxX = Math.max(900, ...nodes.map((n, i) => pos(n, i).x + W + 60));
  const maxY = Math.max(600, ...nodes.map((n, i) => pos(n, i).y + H + 60));

  return (
    <div className="free-cork-wrap">
      <div className="free-tools">
        <button className={`btn ${linking !== false ? "primary" : ""}`} onClick={() => setLinking(linking === false ? null : false)}>
          <Link2 size={14} /> {linking === false ? t("fc.link") : linking === null ? t("fc.pickFrom") : t("fc.pickTo")}
        </button>
        <span className="muted">{t("fc.hint")}</span>
      </div>
      <div className="free-cork" ref={area} onPointerMove={onMove} onPointerUp={onUp}>
        <div style={{ width: maxX, height: maxY, position: "relative" }}>
          <svg className="fc-links" width={maxX} height={maxY}>
            <defs>
              <marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {links.map((l) => {
              const a = center(l.from);
              const b = center(l.to);
              // Termina en el borde de la ficha, no en su centro.
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const k = Math.min(Math.abs((W / 2 + 6) / (dx || 1e-6)), Math.abs((H / 2 + 6) / (dy || 1e-6)), 0.5);
              return (
                <g key={l.id} className="fc-link" onClick={() => edit((mm) => void (mm.corkLinks = mm.corkLinks.filter((x) => x.id !== l.id)))}>
                  <line x1={a.x + dx * k} y1={a.y + dy * k} x2={b.x - dx * k} y2={b.y - dy * k} markerEnd="url(#fc-arrow)" />
                  <title>{t("fc.unlink")}</title>
                </g>
              );
            })}
          </svg>
          {nodes.map((n, i) => {
            const p = pos(n, i);
            const color = n.cork?.color ?? "";
            return (
              <div
                key={n.id}
                className={`fc-card ${selected === n.id ? "on" : ""} ${linking === n.id ? "linking" : ""}`}
                style={{ left: p.x, top: p.y, width: W, height: H, background: color || undefined }}
                onPointerDown={(e) => onDown(e, n, i)}
                onDoubleClick={() => useStore.setState({ selected: n.id, view: "hoja" })}
              >
                <span className="pin" style={{ background: povColor(m, n) ?? `var(--st-${n.status})` }} />
                <b>{n.title}</b>
                <p>{n.synopsis}</p>
                <div className="fc-colors">
                  {COLORS.map((c) => (
                    <button key={c || "none"} className={c === color ? "on" : ""} style={{ background: c || "var(--paper)" }} onClick={() => setNode(n.id, (x) => void (x.cork = { ...(x.cork ?? pos(n, i)), color: c || undefined }))} aria-label={c || t("fc.noColor")} />
                  ))}
                  {links.some((l) => l.from === n.id || l.to === n.id) && (
                    <button className="fc-x" title={t("fc.unlinkAll")} onClick={() => edit((mm) => void (mm.corkLinks = mm.corkLinks.filter((l) => l.from !== n.id && l.to !== n.id)))}>
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
