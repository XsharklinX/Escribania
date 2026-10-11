import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { TreeNode } from "../types";
import { useT } from "../lib/i18n";
import { PALETTE } from "../lib/model";
import { walk } from "../lib/tree";
import { newId } from "../lib/ids";

interface Col {
  node: TreeNode;
  chapter: string;
  first: boolean;
}

function columns(list: TreeNode[]): Col[] {
  const out: Col[] = [];
  let last = "";
  walk(list, (n, _d, parent) => {
    if (n.type !== "text" || !n.include) return;
    const ch = parent?.title ?? "";
    out.push({ node: n, chapter: ch, first: (parent?.id ?? "") !== last });
    last = parent?.id ?? "";
  });
  return out;
}

/** Rejilla de tramas: subtramas (filas) por escenas (columnas). */
export default function RejillaView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const [name, setName] = useState("");
  const drag = useRef<{ text: string; plot: string } | null>(null);
  const cols = columns(m.sections.manuscript);
  const grid = m.plotgrid;

  const setCell = (text: string, plot: string, value: string) =>
    edit((mm) => {
      mm.plotgrid[text] = mm.plotgrid[text] ?? {};
      if (value) mm.plotgrid[text][plot] = value;
      else delete mm.plotgrid[text][plot];
    });

  const add = () => {
    if (!name.trim()) return;
    edit((mm) => void mm.plotlines.push({ id: newId(), name: name.trim(), color: PALETTE[mm.plotlines.length % PALETTE.length] }));
    setName("");
  };

  // Subtramas que se apagan antes del último tercio del libro.
  const abandoned = m.plotlines.filter((p) => {
    const filled = cols.map((c, i) => (grid[c.node.id]?.[p.id] ? i : -1)).filter((i) => i >= 0);
    return filled.length > 0 && filled[filled.length - 1] < cols.length * 0.66 && cols.length >= 6;
  });

  return (
    <div className="view grid-view">
      <div className="view-head">
        <h2>{t("view.rejilla")}</h2>
        <span className="spacer" />
        <input className="input" style={{ width: 220 }} placeholder={t("plot.newPh")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn primary" onClick={add} disabled={!name.trim()}>
          <Plus size={15} /> {t("plot.add")}
        </button>
      </div>
      {abandoned.length > 0 && (
        <p className="pulse-warn pad">
          ⚠ {t("plot.abandoned", { names: abandoned.map((p) => p.name).join(", ") })}
        </p>
      )}
      {cols.length === 0 ? (
        <p className="muted pad">{t("mold.noTexts")}</p>
      ) : m.plotlines.length === 0 ? (
        <p className="muted pad">{t("plot.empty")}</p>
      ) : (
        <div className="table-wrap">
          <table className="plotgrid">
            <thead>
              <tr>
                <th className="pl-name" />
                {cols.map((c) => (
                  <th key={c.node.id} className={c.first ? "ch-start" : ""}>
                    {c.first && <small className="muted">{c.chapter}</small>}
                    <button className="link" onClick={() => useStore.setState({ selected: c.node.id, view: "hoja" })}>
                      {c.node.title}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.plotlines.map((p) => (
                <tr key={p.id}>
                  <th className="pl-name">
                    <input type="color" className="color" value={p.color} onChange={(e) => edit((mm) => void (mm.plotlines.find((x) => x.id === p.id)!.color = e.target.value))} />
                    <input className="cell" value={p.name} onChange={(e) => edit((mm) => void (mm.plotlines.find((x) => x.id === p.id)!.name = e.target.value))} />
                    <button
                      className="icon-btn danger"
                      title={t("plot.delete")}
                      onClick={() =>
                        edit((mm) => {
                          mm.plotlines = mm.plotlines.filter((x) => x.id !== p.id);
                          for (const k of Object.keys(mm.plotgrid)) delete mm.plotgrid[k][p.id];
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </th>
                  {cols.map((c) => {
                    const v = grid[c.node.id]?.[p.id] ?? "";
                    return (
                      <td
                        key={c.node.id}
                        className={`${c.first ? "ch-start" : ""} ${v ? "filled" : ""}`}
                        style={v ? { background: `color-mix(in srgb, ${p.color} 18%, var(--paper))`, borderColor: p.color } : undefined}
                        draggable={Boolean(v)}
                        onDragStart={() => (drag.current = { text: c.node.id, plot: p.id })}
                        onDragOver={(e) => drag.current && e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = drag.current;
                          drag.current = null;
                          if (!from || (from.text === c.node.id && from.plot === p.id)) return;
                          const moving = grid[from.text]?.[from.plot] ?? "";
                          setCell(from.text, from.plot, v);
                          setCell(c.node.id, p.id, moving);
                        }}
                      >
                        <textarea className="cell" value={v} placeholder="·" onChange={(e) => setCell(c.node.id, p.id, e.target.value)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted pad">{t("plot.hint")}</p>
    </div>
  );
}
