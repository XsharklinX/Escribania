import { useStore } from "../store";
import type { TreeNode } from "../types";
import { useT } from "../lib/i18n";
import { MOLDS, povColor } from "../lib/model";
import { walk } from "../lib/tree";

interface Slot {
  node: TreeNode;
  start: number;
  size: number;
}

export default function StructureView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const selected = useStore((s) => s.selected);
  const edit = useStore((s) => s.editManifest);
  const mold = MOLDS.find((x) => x.id === m.structure.template) ?? null;

  // Textos del libro en orden, con su posición en palabras.
  const texts: TreeNode[] = [];
  const skip = new Set<string>();
  walk(m.sections.manuscript, (n, _d, parent) => {
    if (!n.include || (parent && skip.has(parent.id))) {
      skip.add(n.id);
      return;
    }
    if (n.type === "text") texts.push(n);
  });
  const total = texts.reduce((s, n) => s + (words[n.file!] ?? 0), 0);
  const byCount = total === 0;
  let acc = 0;
  const slots: Slot[] = texts.map((n) => {
    const size = byCount ? 1 : words[n.file!] ?? 0;
    const s = { node: n, start: acc, size };
    acc += size;
    return s;
  });
  const span = Math.max(1, acc);
  const pctOf = (id: string) => {
    const s = slots.find((x) => x.node.id === id);
    return s ? (s.start / span) * 100 : null;
  };
  const here = selected ? pctOf(selected) : null;

  return (
    <div className="view structure-view">
      <div className="view-head">
        <h2>{t("view.estructura")}</h2>
        <span className="spacer" />
        <select id="mold" className="select" style={{ width: 240 }} value={m.structure.template ?? ""} onChange={(e) => edit((mm) => void (mm.structure.template = e.target.value || null))}>
          <option value="">{t("mold.none")}</option>
          {MOLDS.map((x) => (
            <option key={x.id} value={x.id}>
              {x[lang]}
            </option>
          ))}
        </select>
      </div>

      {texts.length === 0 ? (
        <p className="muted pad">{t("mold.noTexts")}</p>
      ) : (
        <div className="structure">
          <div className="track-wrap">
            {mold && (
              <div className="beat-row">
                {mold.beats.map((b) => (
                  <span key={b.id} className="beat-mark" style={{ left: `${b.pct}%` }} title={`${b[lang]} · ${b.pct}%`}>
                    <i />
                    <small>{b[lang]}</small>
                  </span>
                ))}
              </div>
            )}
            <div className="track">
              {slots.map((s) => (
                <button
                  key={s.node.id}
                  className={`slot ${selected === s.node.id ? "on" : ""}`}
                  style={{ flexGrow: Math.max(s.size, span / 400), background: povColor(m, s.node) ?? `var(--st-${s.node.status})` }}
                  title={`${s.node.title} · ${Math.round((s.start / span) * 100)}%`}
                  onClick={() => useStore.getState().select(s.node.id)}
                  onDoubleClick={() => useStore.setState({ selected: s.node.id, view: "hoja" })}
                />
              ))}
              {here !== null && (
                <span className="here" style={{ left: `${here}%` }}>
                  <b>{t("mold.here", { p: Math.round(here) })}</b>
                </span>
              )}
            </div>
            <div className="scale">
              {[0, 25, 50, 75, 100].map((p) => (
                <span key={p} style={{ left: `${p}%` }}>
                  {p}%
                </span>
              ))}
            </div>
            {byCount && <p className="muted">{t("mold.byCount")}</p>}
          </div>

          {mold ? (
            <table className="beats-table">
              <thead>
                <tr>
                  <th>{t("mold.beat")}</th>
                  <th className="num">{t("mold.ideal")}</th>
                  <th>{t("mold.scene")}</th>
                  <th className="num">{t("mold.actual")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mold.beats.map((b) => {
                  const assigned = m.structure.beats[b.id];
                  const actual = assigned ? pctOf(assigned) : null;
                  const diff = actual === null ? null : actual - b.pct;
                  const level = diff === null ? "" : Math.abs(diff) <= 5 ? "ok" : Math.abs(diff) <= 12 ? "warn" : "bad";
                  return (
                    <tr key={b.id}>
                      <td>
                        <b>{b[lang]}</b>
                      </td>
                      <td className="num">{b.pct}%</td>
                      <td>
                        <select
                          className="cell"
                          value={assigned ?? ""}
                          onChange={(e) =>
                            edit((mm) => {
                              if (e.target.value) mm.structure.beats[b.id] = e.target.value;
                              else delete mm.structure.beats[b.id];
                            })
                          }
                        >
                          <option value="">—</option>
                          {texts.map((n, i) => (
                            <option key={n.id} value={n.id}>
                              {i + 1}. {n.title}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">{actual === null ? "—" : `${Math.round(actual)}%`}</td>
                      <td>
                        {diff !== null && (
                          <span className={`dev ${level}`}>
                            {level === "ok" ? t("mold.onTime") : diff < 0 ? t("mold.early", { n: Math.round(-diff) }) : t("mold.late", { n: Math.round(diff) })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">{t("mold.pick")}</p>
          )}
          <p className="muted">{t("mold.disclaimer")}</p>
        </div>
      )}
    </div>
  );
}
