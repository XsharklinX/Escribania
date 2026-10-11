import { useMemo, useRef, useState } from "react";
import { Plus, Shuffle } from "lucide-react";
import { useStore } from "../store";
import type { CodexEntry, CodexKind } from "../types";
import { useT } from "../lib/i18n";
import { CODEX_KINDS } from "../lib/model";
import { layout, type P } from "../lib/force";
import { useAsset } from "../lib/assets";
import { newId } from "../lib/ids";

const W = 1000;
const H = 680;

export default function GraphView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const [kinds, setKinds] = useState<CodexKind[]>(["character", "faction"]);
  const [focus, setFocus] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; p: P } | null>(null);
  const [form, setForm] = useState({ from: "", to: "", label: "" });
  const svgRef = useRef<SVGSVGElement>(null);

  const nodes = m.codex.filter((e) => kinds.includes(e.kind));
  const ids = nodes.map((n) => n.id);
  const visible = new Set(ids);
  const edges = m.relations.filter((r) => visible.has(r.from) && visible.has(r.to));

  const fixedKey = JSON.stringify(nodes.map((n) => [n.id, n.pos]));
  const edgeKey = JSON.stringify(edges.map((e) => [e.from, e.to]));
  const pos = useMemo(() => {
    const fixed: Record<string, P> = {};
    for (const n of nodes) if (n.pos) fixed[n.id] = n.pos;
    return layout(ids, edges.map((e) => [e.from, e.to]), fixed, W, H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedKey, edgeKey]);

  const at = (id: string): P => (drag?.id === id ? drag.p : pos[id]);

  const toSvg = (e: React.PointerEvent): P => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.min(W - 40, Math.max(40, r.x)), y: Math.min(H - 40, Math.max(40, r.y)) };
  };

  const relayout = () =>
    edit((mm) => {
      for (const e of mm.codex) delete e.pos;
    });

  const neighbors = new Set<string>();
  if (focus) for (const e of edges) if (e.from === focus || e.to === focus) neighbors.add(e.from === focus ? e.to : e.from);

  return (
    <div className="view graph-view">
      <div className="view-head">
        <h2>{t("view.telarana")}</h2>
        <div className="chips">
          {CODEX_KINDS.map((k) => (
            <button key={k} className={`chip-toggle ${kinds.includes(k) ? "on" : ""}`} onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])}>
              {t(`kind.plural.${k}`)}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn" onClick={relayout} title={t("graph.relayoutHint")}>
          <Shuffle size={15} /> {t("graph.relayout")}
        </button>
      </div>
      <div className="graph-form">
        <select className="select" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
          <option value="">{t("graph.from")}</option>
          {m.codex.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input className="input" placeholder={t("codex.relLabel")} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <select className="select" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
          <option value="">{t("graph.to")}</option>
          {m.codex
            .filter((e) => e.id !== form.from)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
        <button
          className="btn primary"
          disabled={!form.from || !form.to}
          onClick={() => {
            edit((mm) => void mm.relations.push({ id: newId(), from: form.from, to: form.to, label: form.label.trim() }));
            setForm({ from: "", to: "", label: "" });
          }}
        >
          <Plus size={15} /> {t("graph.add")}
        </button>
      </div>
      {nodes.length === 0 ? (
        <p className="muted pad">{t("graph.empty")}</p>
      ) : (
        <svg
          ref={svgRef}
          className="graph"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={(e) => drag && setDrag({ id: drag.id, p: toSvg(e) })}
          onPointerUp={() => {
            if (!drag) return;
            const { id, p } = drag;
            setDrag(null);
            edit((mm) => {
              // Al soltar se fijan las posiciones de todos, para que el resto no salte.
              for (const e of mm.codex) if (pos[e.id]) e.pos = e.id === id ? { x: Math.round(p.x), y: Math.round(p.y) } : e.pos ?? { x: Math.round(pos[e.id].x), y: Math.round(pos[e.id].y) };
            });
          }}
          onClick={(e) => e.target === e.currentTarget && setFocus(null)}
        >
          {edges.map((r) => {
            const a = at(r.from);
            const b = at(r.to);
            if (!a || !b) return null;
            const dim = focus && r.from !== focus && r.to !== focus;
            return (
              <g key={r.id} className={dim ? "dim" : ""}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge" />
                {r.label && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} className="edge-label" textAnchor="middle">
                    {r.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => (
            <GraphNode
              key={n.id}
              entry={n}
              p={at(n.id)}
              dim={!!focus && focus !== n.id && !neighbors.has(n.id)}
              onDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setFocus(n.id);
                setDrag({ id: n.id, p: at(n.id) });
              }}
              onOpen={() => useStore.setState({ view: "codice", codexSelected: n.id })}
            />
          ))}
        </svg>
      )}
      <p className="muted pad">{t("graph.hint")}</p>
    </div>
  );
}

function GraphNode({ entry, p, dim, onDown, onOpen }: { entry: CodexEntry; p: P; dim: boolean; onDown: (e: React.PointerEvent) => void; onOpen: () => void }) {
  const img = useAsset(entry.image);
  if (!p) return null;
  const r = 30;
  const clip = `clip-${entry.id}`;
  return (
    <g className={`gnode ${dim ? "dim" : ""}`} transform={`translate(${p.x},${p.y})`} onPointerDown={onDown} onDoubleClick={onOpen}>
      <circle r={r + 4} fill={entry.color} />
      {img ? (
        <>
          <clipPath id={clip}>
            <circle r={r} />
          </clipPath>
          <image href={img} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
        </>
      ) : (
        <>
          <circle r={r} className="gnode-bg" />
          <text className="gnode-initial" textAnchor="middle" dy="0.35em" fill={entry.color}>
            {entry.name.charAt(0).toUpperCase()}
          </text>
        </>
      )}
      <text className="gnode-label" y={r + 20} textAnchor="middle">
        {entry.name}
      </text>
    </g>
  );
}
