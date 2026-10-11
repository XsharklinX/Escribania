import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Flame, Plus, Trophy, X } from "lucide-react";
import { useStore } from "../store";
import { tNow, useT } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { bookWords } from "../lib/tree";
import { formatNumber } from "../lib/words";
import { slugify, newId } from "../lib/ids";
import { bestHour, challengeProgress, dayKey, lastDays, net, pace, streaks, updateJournal, useJournal, type Challenge, type Journal } from "../lib/journal";

const WEEKDAYS_ES = ["D", "L", "M", "X", "J", "V", "S"];
const WEEKDAYS_EN = ["S", "M", "T", "W", "T", "F", "S"];

export default function Termometro() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const edit = useStore((s) => s.editManifest);
  const journal = useJournal((s) => s.journal);
  const session = useJournal((s) => s.session);
  const book = bookWords(m, words);
  const f = (n: number) => formatNumber(n, lang);
  const p = pace(m, book, journal);
  const today = journal.days[dayKey()] ?? { w: 0, d: 0, m: 0 };
  const st = streaks(journal, m.target.restDays);
  const wd = lang === "es" ? WEEKDAYS_ES : WEEKDAYS_EN;

  // Retos conseguidos: se apunta la fecha una sola vez.
  useEffect(() => {
    const done = journal.challenges.filter((c) => !c.done && challengeProgress(c, journal) >= c.target);
    if (!done.length) return;
    updateJournal((j) => ({ ...j, challenges: j.challenges.map((c) => (done.some((d) => d.id === c.id) ? { ...c, done: dayKey() } : c)) }));
    for (const c of done) useStore.getState().toast(tNow("ch.completed", { name: c.name }));
  }, [journal]);

  return (
    <div className="view stats-view">
      <div className="view-head">
        <h2>{t("view.termometro")}</h2>
      </div>
      <div className="stats-grid">
        <section className="stat-card wide">
          <div className="k">{t("goal.book")}</div>
          <div className="big">
            {f(book)}
            {m.target.words > 0 && <small> / {f(m.target.words)}</small>}
          </div>
          {m.target.words > 0 && (
            <div className="bar lg">
              <i style={{ width: `${Math.min(100, (book / m.target.words) * 100)}%` }} />
            </div>
          )}
          <div className="goal-form">
            <label className="field">
              <span>{t("set.projTarget")}</span>
              <input className="input" type="number" min={0} step={1000} value={m.target.words || ""} onChange={(e) => edit((mm) => void (mm.target.words = Math.max(0, Number(e.target.value) || 0)))} />
            </label>
            <label className="field">
              <span>{t("set.projDeadline")}</span>
              <input className="input" type="date" value={m.target.deadline ?? ""} onChange={(e) => edit((mm) => void (mm.target.deadline = e.target.value || null))} />
            </label>
            <div className="field">
              <span>{t("goal.restDays")}</span>
              <div className="weekdays">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <button
                    key={d}
                    className={m.target.restDays.includes(d) ? "on" : ""}
                    title={t("goal.restDaysHint")}
                    onClick={() => edit((mm) => void (mm.target.restDays = mm.target.restDays.includes(d) ? mm.target.restDays.filter((x) => x !== d) : [...mm.target.restDays, d]))}
                  >
                    {wd[d]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="stat-card">
          <div className="k">{t("goal.pace")}</div>
          {p && m.target.deadline ? (
            <>
              <div className="big">
                {f(p.perDay)}
                <small> {t("goal.perDay")}</small>
              </div>
              <div className="bar">
                <i style={{ width: `${p.perDay ? Math.min(100, (p.today / p.perDay) * 100) : 100}%` }} />
              </div>
              <p className="muted">{p.remaining === 0 ? t("goal.reached") : t("goal.paceText", { today: f(Math.max(0, p.today)), days: p.daysLeft, left: f(p.remaining) })}</p>
            </>
          ) : (
            <p className="muted">{t("goal.setDeadline")}</p>
          )}
        </section>

        <section className="stat-card">
          <div className="k">{t("goal.today")}</div>
          <div className="big">
            {net(today) >= 0 ? "+" : "−"}
            {f(Math.abs(net(today)))}
          </div>
          <p className="muted">{t("goal.todayText", { w: f(today.w), d: f(today.d), m: today.m })}</p>
          {session && <p className="muted">{t("goal.sessionText", { w: f(session.w - session.d), m: session.m })}</p>}
        </section>

        <section className="stat-card">
          <div className="k">{t("goal.streak")}</div>
          <div className="big">
            <Flame size={22} style={{ color: st.current ? "#E2702B" : "var(--sub)", verticalAlign: -3 }} /> {st.current}
            <small> {t("goal.days")}</small>
          </div>
          <p className="muted">{t("goal.best", { n: st.best })}</p>
        </section>

        <section className="stat-card wide">
          <div className="k">{t("goal.heatmap")}</div>
          <Heatmap journal={journal} perDay={p?.perDay ?? 0} lang={lang} />
        </section>

        <section className="stat-card wide">
          <div className="k">{t("goal.last30")}</div>
          <Bars journal={journal} perDay={p?.perDay ?? 0} lang={lang} />
        </section>

        <Challenges journal={journal} />
        <Sprints journal={journal} />
        <Sessions journal={journal} title={m.title} />
      </div>
    </div>
  );
}

function Heatmap({ journal, perDay, lang }: { journal: Journal; perDay: number; lang: string }) {
  const days = lastDays(journal, 26 * 7);
  // Que la primera columna empiece en lunes.
  while (days.length && days[0].date.getDay() !== 1) days.shift();
  const max = Math.max(perDay || 0, ...days.map((d) => d.net), 1);
  const level = (n: number) => (n <= 0 ? 0 : n < max * 0.25 ? 1 : n < max * 0.5 ? 2 : n < max * 0.85 ? 3 : 4);
  const fmt = new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-US", { dateStyle: "medium" });
  return (
    <div className="heat">
      {days.map((d) => (
        <i key={d.key} className={`l${level(d.net)}`} title={`${fmt.format(d.date)} · ${d.net >= 0 ? "+" : ""}${formatNumber(d.net, lang)}`} />
      ))}
    </div>
  );
}

function Bars({ journal, perDay, lang }: { journal: Journal; perDay: number; lang: string }) {
  const days = lastDays(journal, 30);
  const max = Math.max(perDay, ...days.map((d) => d.net), 100);
  const W = 720;
  const H = 160;
  const bw = W / days.length;
  const y = (v: number) => H - 18 - (Math.max(0, v) / max) * (H - 30);
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W + 40} ${H}`} className="chart">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={36} x2={W + 36} y1={y(v)} y2={y(v)} className="grid" />
            <text x={30} y={y(v) + 3} textAnchor="end" className="axis">
              {formatNumber(v, lang)}
            </text>
          </g>
        ))}
        {days.map((d, i) => (
          <g key={d.key}>
            <rect x={36 + i * bw + 2} y={y(d.net)} width={bw - 4} height={Math.max(0, H - 18 - y(d.net))} rx={2} className={d.net >= perDay && perDay ? "bar-ok" : "bar"}>
              <title>{`${d.key} · ${formatNumber(d.net, lang)}`}</title>
            </rect>
            {(i % 5 === 0 || i === days.length - 1) && (
              <text x={36 + i * bw + bw / 2} y={H - 4} textAnchor="middle" className="axis">
                {d.date.getDate()}/{d.date.getMonth() + 1}
              </text>
            )}
          </g>
        ))}
        {perDay > 0 && <line x1={36} x2={W + 36} y1={y(perDay)} y2={y(perDay)} className="target" />}
      </svg>
    </div>
  );
}

function Challenges({ journal }: { journal: Journal }) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const [form, setForm] = useState<null | Omit<Challenge, "id">>(null);
  const year = new Date().getFullYear();
  const plus = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return dayKey(d);
  };
  const presets: Omit<Challenge, "id">[] = [
    { name: t("ch.nano"), kind: "words", target: 50000, start: `${year}-11-01`, end: `${year}-11-30` },
    { name: t("ch.thirty"), kind: "days", target: 30, start: dayKey(), end: plus(29) },
    { name: t("ch.tenK"), kind: "words", target: 10000, start: dayKey(), end: plus(29) },
  ];
  const add = (c: Omit<Challenge, "id">) => updateJournal((j) => ({ ...j, challenges: [...j.challenges, { ...c, id: newId() }] }));

  return (
    <section className="stat-card span2">
      <div className="k" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Trophy size={14} /> {t("ch.title")}
      </div>
      {journal.challenges.length === 0 && <p className="muted">{t("ch.none")}</p>}
      <div className="challenges">
        {journal.challenges.map((c) => {
          const prog = challengeProgress(c, journal);
          const pct = Math.min(100, (prog / c.target) * 100);
          return (
            <div key={c.id} className={`challenge ${c.done ? "done" : ""}`}>
              <div className="ch-head">
                <b>{c.name}</b>
                {c.done && <span className="badge">🏅 {t("ch.done")}</span>}
                <span className="spacer" />
                <button className="icon-btn" onClick={() => updateJournal((j) => ({ ...j, challenges: j.challenges.filter((x) => x.id !== c.id) }))}>
                  <X size={14} />
                </button>
              </div>
              <div className="bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <small className="muted">
                {formatNumber(prog, lang)} / {formatNumber(c.target, lang)} {c.kind === "words" ? t("ed.words") : t("goal.days")} · {c.start} → {c.end}
              </small>
            </div>
          );
        })}
      </div>
      <div className="chips">
        {presets.map((p) => (
          <button key={p.name} className="chip-entry" onClick={() => add(p)}>
            <Plus size={12} /> {p.name}
          </button>
        ))}
        <button className="chip-entry" onClick={() => setForm({ name: "", kind: "words", target: 20000, start: dayKey(), end: plus(30) })}>
          <Plus size={12} /> {t("ch.custom")}
        </button>
      </div>
      {form && (
        <div className="ch-form">
          <input className="input" placeholder={t("ch.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Challenge["kind"] })}>
            <option value="words">{t("ch.kindWords")}</option>
            <option value="days">{t("ch.kindDays")}</option>
          </select>
          <input className="input" type="number" min={1} value={form.target} onChange={(e) => setForm({ ...form, target: Math.max(1, Number(e.target.value) || 1) })} />
          <input className="input" type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <input className="input" type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          <button
            className="btn primary"
            disabled={!form.name.trim() || form.end < form.start}
            onClick={() => {
              add({ ...form, name: form.name.trim() });
              setForm(null);
            }}
          >
            {t("ch.add")}
          </button>
        </div>
      )}
    </section>
  );
}

function Sprints({ journal }: { journal: Journal }) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const list = [...journal.sprints].reverse().slice(0, 12);
  const avg = journal.sprints.length ? Math.round(journal.sprints.reduce((s, x) => s + x.words, 0) / journal.sprints.length) : 0;
  const hour = bestHour(journal);
  return (
    <section className="stat-card">
      <div className="k">{t("sprint.history")}</div>
      {journal.sprints.length === 0 ? (
        <p className="muted">{t("sprint.none")}</p>
      ) : (
        <>
          <p className="muted">{t("sprint.avg", { n: formatNumber(avg, lang), c: journal.sprints.length })}</p>
          <div className="mini-list">
            {list.map((s) => (
              <div key={s.start} className="mini-row">
                <span className="muted">{new Date(s.start).toLocaleString(lang === "es" ? "es-ES" : "en-US", { dateStyle: "short", timeStyle: "short" })}</span>
                <span className="bar">
                  <i style={{ width: `${Math.min(100, (s.words / Math.max(1, s.goal)) * 100)}%` }} />
                </span>
                <b>{formatNumber(s.words, lang)}</b>
              </div>
            ))}
          </div>
        </>
      )}
      {hour !== null && <p className="muted">{t("sprint.bestHour", { h: hour, h2: (hour + 1) % 24 })}</p>}
    </section>
  );
}

function Sessions({ journal, title }: { journal: Journal; title: string }) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const session = useJournal((s) => s.session);
  const all = [...journal.sessions.filter((s) => s.start !== session?.start), ...(session && (session.w || session.d) ? [session] : [])].reverse();
  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-ES" : "en-US", { dateStyle: "short", timeStyle: "short" });

  const exportCsv = async () => {
    try {
      const path = await save({ defaultPath: `${slugify(title)}-bitacora.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      const rows = [t("log.csvHeader")];
      for (const s of [...all].reverse()) rows.push([s.start, s.end, s.m, s.w, s.d, s.w - s.d, s.texts.length].join(";"));
      await api.fileWriteText(path, "﻿" + rows.join("\r\n") + "\r\n");
      useStore.getState().toast(`${t("exp.done")}: ${path}`);
    } catch (e) {
      useStore.getState().toast(errorText(e), "error");
    }
  };

  return (
    <section className="stat-card wide">
      <div className="k" style={{ display: "flex", alignItems: "center" }}>
        {t("log.title")}
        <span className="spacer" />
        <button className="btn" onClick={() => void exportCsv()} disabled={!all.length}>
          <Download size={14} /> CSV
        </button>
      </div>
      {all.length === 0 ? (
        <p className="muted">{t("log.none")}</p>
      ) : (
        <div className="table-wrap">
          <table className="log">
            <thead>
              <tr>
                <th>{t("log.start")}</th>
                <th className="num">{t("log.minutes")}</th>
                <th className="num">{t("log.written")}</th>
                <th className="num">{t("log.deleted")}</th>
                <th className="num">{t("log.net")}</th>
                <th className="num">{t("log.texts")}</th>
              </tr>
            </thead>
            <tbody>
              {all.slice(0, 40).map((s) => (
                <tr key={s.start}>
                  <td>
                    {fmt(s.start)}
                    {s === session && <span className="badge" style={{ marginLeft: 6 }}>{t("log.now")}</span>}
                  </td>
                  <td className="num">{s.m}</td>
                  <td className="num">{formatNumber(s.w, lang)}</td>
                  <td className="num">{formatNumber(s.d, lang)}</td>
                  <td className="num">
                    <b>{formatNumber(s.w - s.d, lang)}</b>
                  </td>
                  <td className="num">{s.texts.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
