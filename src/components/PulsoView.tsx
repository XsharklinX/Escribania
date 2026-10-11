import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useStore } from "../store";
import type { TreeNode } from "../types";
import { useT } from "../lib/i18n";
import { api, type TextStats } from "../lib/api";
import { flushTexts } from "../lib/saver";
import { refreshMentions } from "../lib/mentions";
import { walk } from "../lib/tree";
import { formatNumber } from "../lib/words";
import { povColor } from "../lib/model";

interface Unit {
  node: TreeNode;
  chapter: string;
  newChapter: boolean;
}

/** Textos del libro en orden, con el capítulo (carpeta) al que pertenecen. */
function units(list: TreeNode[]): Unit[] {
  const out: Unit[] = [];
  let lastParent = "";
  const skip = new Set<string>();
  walk(list, (n, _d, parent) => {
    if (!n.include || (parent && skip.has(parent.id))) {
      skip.add(n.id);
      return;
    }
    if (n.type !== "text") return;
    const chapter = parent?.title ?? "";
    out.push({ node: n, chapter, newChapter: (parent?.id ?? "") !== lastParent });
    lastParent = parent?.id ?? "";
  });
  return out;
}

export default function PulsoView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const root = useStore((s) => s.project!.root);
  const lang = useStore((s) => s.settings.lang);
  const mentions = useStore((s) => s.mentions);
  const edit = useStore((s) => s.editManifest);
  const [stats, setStats] = useState<Record<string, TextStats> | null>(null);
  const list = units(m.sections.manuscript);
  const files = list.map((u) => u.node.file!);
  const key = files.join("|");

  const load = async () => {
    await flushTexts();
    setStats(await api.textsStats(root, files));
    refreshMentions();
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!list.length) return <div className="view"><p className="muted pad">{t("mold.noTexts")}</p></div>;
  const st = (u: Unit) => stats?.[u.node.file!] ?? { words: 0, dialogue: 0, sentences: 0, paragraphs: 0, longest: 0 };
  const total = list.reduce((a, u) => a + st(u).words, 0);
  const dialogue = list.reduce((a, u) => a + st(u).dialogue, 0);
  const sentences = list.reduce((a, u) => a + st(u).sentences, 0);
  const maxW = Math.max(1, ...list.map((u) => st(u).words));
  const f = (n: number) => formatNumber(n, lang);

  const W = 900;
  const H = 220;
  const bw = W / list.length;
  const y = (v: number, max: number) => H - 20 - (v / max) * (H - 36);

  const characters = m.codex.filter((e) => e.kind === "character");
  const presence = characters.map((c) => ({ c, row: list.map((u) => (mentions[c.id]?.[u.node.file!] ?? 0) > 0 || u.node.pov === c.id) })).filter((r) => r.row.some(Boolean));
  const warnings: string[] = [];
  const gap = Math.max(4, Math.round(list.length * 0.25));
  for (const { c, row } of presence) {
    const last = row.lastIndexOf(true);
    if (list.length - 1 - last >= gap) warnings.push(t("pulse.vanishes", { name: c.name, at: list[last].node.title }));
    let run = 0;
    let seen = false;
    for (let i = 0; i <= last; i++) {
      if (row[i]) {
        if (seen && run >= gap) warnings.push(t("pulse.absent", { name: c.name, n: run, at: list[i].node.title }));
        seen = true;
        run = 0;
      } else if (seen) run++;
    }
  }
  const povWords = new Map<string, number>();
  for (const u of list) povWords.set(u.node.pov ?? "", (povWords.get(u.node.pov ?? "") ?? 0) + st(u).words);

  return (
    <div className="view pulse-view">
      <div className="view-head">
        <h2>{t("view.pulso")}</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => void load()}>
          <RefreshCw size={15} /> {t("pulse.refresh")}
        </button>
      </div>
      <div className="stats-grid">
        <section className="stat-card">
          <div className="k">{t("pulse.scenes")}</div>
          <div className="big">{list.length}</div>
          <p className="muted">{t("pulse.avgScene", { n: f(Math.round(total / list.length)) })}</p>
        </section>
        <section className="stat-card">
          <div className="k">{t("pulse.dialogue")}</div>
          <div className="big">{total ? Math.round((dialogue / total) * 100) : 0}%</div>
          <p className="muted">{t("pulse.dialogueHint")}</p>
        </section>
        <section className="stat-card">
          <div className="k">{t("pulse.sentence")}</div>
          <div className="big">
            {sentences ? Math.round(total / sentences) : 0}
            <small> {t("ed.words")}</small>
          </div>
          <p className="muted">{t("pulse.sentenceHint")}</p>
        </section>

        <section className="stat-card wide">
          <div className="k">{t("pulse.rhythm")}</div>
          <div className="chart-wrap">
            <svg viewBox={`0 0 ${W + 40} ${H}`} className="chart pulse-chart">
              {[0, 0.5, 1].map((r) => (
                <g key={r}>
                  <line x1={36} x2={W + 36} y1={y(maxW * r, maxW)} y2={y(maxW * r, maxW)} className="grid" />
                  <text x={30} y={y(maxW * r, maxW) + 3} textAnchor="end" className="axis">
                    {f(Math.round(maxW * r))}
                  </text>
                </g>
              ))}
              {list.map((u, i) => (
                <g key={u.node.id}>
                  {u.newChapter && i > 0 && <line x1={36 + i * bw} x2={36 + i * bw} y1={10} y2={H - 18} className="chapter-line" />}
                  <rect x={36 + i * bw + 1} y={y(st(u).words, maxW)} width={Math.max(1, bw - 2)} height={H - 20 - y(st(u).words, maxW)} rx={2} fill={povColor(m, u.node) ?? "var(--acc)"} opacity={0.55}>
                    <title>{`${u.node.title} · ${f(st(u).words)} · ${t("pulse.dialogue")} ${st(u).words ? Math.round((st(u).dialogue / st(u).words) * 100) : 0}%`}</title>
                  </rect>
                </g>
              ))}
              {/* Solo une las escenas puntuadas: las que no tienen tensión no caen a cero. */}
              <polyline
                className="tension-line"
                points={list
                  .map((u, i) => (u.node.tension ? `${36 + i * bw + bw / 2},${y(u.node.tension, 10)}` : ""))
                  .filter(Boolean)
                  .join(" ")}
              />
              {list.map((u, i) => (u.node.tension ? <circle key={u.node.id} cx={36 + i * bw + bw / 2} cy={y(u.node.tension, 10)} r={3} className="tension-dot" /> : null))}
              <polyline
                className="dialogue-line"
                points={list.map((u, i) => `${36 + i * bw + bw / 2},${y(st(u).words ? st(u).dialogue / st(u).words : 0, 1)}`).join(" ")}
              />
            </svg>
          </div>
          <div className="legend">
            <span><i className="lg-bar" /> {t("pulse.legendWords")}</span>
            <span><i className="lg-tension" /> {t("pulse.legendTension")}</span>
            <span><i className="lg-dialogue" /> {t("pulse.legendDialogue")}</span>
          </div>
        </section>

        <section className="stat-card wide">
          <div className="k">{t("pulse.tension")}</div>
          <p className="muted">{t("pulse.tensionHint")}</p>
          <div className="tension-grid" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(22px, 1fr))` }}>
            {list.map((u) => (
              <select
                key={u.node.id}
                title={u.node.title}
                value={u.node.tension ?? 0}
                onChange={(e) => edit((mm) => {
                  const n = (function find(l: TreeNode[]): TreeNode | undefined {
                    for (const x of l) {
                      if (x.id === u.node.id) return x;
                      const r = x.children && find(x.children);
                      if (r) return r;
                    }
                  })(mm.sections.manuscript);
                  if (n) n.tension = Number(e.target.value) || undefined;
                })}
              >
                <option value={0}>·</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </section>

        <section className="stat-card wide">
          <div className="k">{t("pulse.presence")}</div>
          {presence.length === 0 ? (
            <p className="muted">{t("pulse.noPresence")}</p>
          ) : (
            <div className="presence">
              {presence.map(({ c, row }) => (
                <div key={c.id} className="presence-row" style={{ gridTemplateColumns: `140px repeat(${list.length}, minmax(4px, 1fr))` }}>
                  <span style={{ color: c.color }}>{c.name}</span>
                  {row.map((on, i) => (
                    <i key={i} style={{ background: on ? c.color : undefined }} title={list[i].node.title} />
                  ))}
                </div>
              ))}
            </div>
          )}
          {warnings.map((w) => (
            <p key={w} className="pulse-warn">
              ⚠ {w}
            </p>
          ))}
        </section>

        <section className="stat-card">
          <div className="k">{t("pulse.pov")}</div>
          <div className="mini-list">
            {[...povWords.entries()].sort((a, b) => b[1] - a[1]).map(([id, w]) => {
              const e = m.codex.find((x) => x.id === id);
              return (
                <div key={id || "none"} className="mini-row">
                  <span style={{ color: e?.color }}>{e?.name ?? t("pulse.noPov")}</span>
                  <span className="bar">
                    <i style={{ width: `${total ? (w / total) * 100 : 0}%`, background: e?.color }} />
                  </span>
                  <b>{total ? Math.round((w / total) * 100) : 0}%</b>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
