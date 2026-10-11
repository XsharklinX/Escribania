import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { AgendaItem } from "../types";
import { useT, type TKey } from "../lib/i18n";
import { dayKey, useJournal } from "../lib/journal";
import { newId } from "../lib/ids";
import { formatNumber } from "../lib/words";

const KINDS: AgendaItem["kind"][] = ["deadline", "revision", "beta", "submission", "other"];
const COLORS: Record<AgendaItem["kind"] | "sub" | "final", string> = {
  deadline: "#C2416B",
  revision: "#3B6FD8",
  beta: "#8C4FC2",
  submission: "#D2803A",
  other: "#6B7180",
  sub: "#D2803A",
  final: "#B93A28",
};

interface Entry {
  id: string;
  date: string;
  title: string;
  color: string;
  done?: boolean;
  item?: AgendaItem;
}

/**
 * Calendario editorial: en un mes, las fechas que importan del libro —
 * entregas, revisiones y lectores (a mano), la fecha límite de la meta,
 * los envíos registrados en la Imprenta y lo escrito cada día.
 */
export default function CalendarView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const lang = useStore((s) => s.settings.lang);
  const days = useJournal((s) => s.journal.days);
  const today = dayKey();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [editing, setEditing] = useState<AgendaItem | null>(null);

  const entries = useMemo(() => {
    const out: Entry[] = m.agenda.map((a) => ({ id: a.id, date: a.date, title: a.title, color: COLORS[a.kind], done: a.done, item: a }));
    if (m.target.deadline) out.push({ id: "final", date: m.target.deadline, title: t("cal.final"), color: COLORS.final });
    for (const s of m.submissions) {
      if (s.sent) out.push({ id: `s-${s.id}`, date: s.sent.slice(0, 10), title: t("cal.sent", { to: s.to || "?" }), color: COLORS.sub });
      if (s.reply) out.push({ id: `r-${s.id}`, date: s.reply.slice(0, 10), title: t("cal.reply", { to: s.to || "?" }), color: COLORS.sub });
    }
    return out;
  }, [m, t]);

  const [y, mo] = month.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const lead = (first.getDay() + 6) % 7; // lunes primero
  const count = new Date(y, mo, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => dayKey(new Date(y, mo - 1, i + 1)))];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => {
    const d = new Date(y, mo - 1 + n, 1);
    setMonth(dayKey(d).slice(0, 7));
  };
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(lang, { weekday: "short" }));
  const upcoming = entries.filter((e) => e.date >= today && !e.done).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  const daysTo = (d: string) => Math.round((new Date(d + "T00:00").getTime() - new Date(today + "T00:00").getTime()) / 86400000);

  const save = (it: AgendaItem) => {
    edit((mm) => {
      const i = mm.agenda.findIndex((a) => a.id === it.id);
      if (i >= 0) mm.agenda[i] = it;
      else mm.agenda.push(it);
    });
    setEditing(null);
  };

  return (
    <div className="view calendar-view">
      <div className="view-head">
        <h2>{t("view.calendario")}</h2>
        <button className="icon-btn" onClick={() => shift(-1)} aria-label={t("cal.prev")}>
          <ChevronLeft size={16} />
        </button>
        <b className="cal-month">{first.toLocaleDateString(lang, { month: "long", year: "numeric" })}</b>
        <button className="icon-btn" onClick={() => shift(1)} aria-label={t("cal.next")}>
          <ChevronRight size={16} />
        </button>
        <button className="btn" onClick={() => setMonth(today.slice(0, 7))}>
          {t("cal.today")}
        </button>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setEditing({ id: newId(), date: today, title: "", kind: "deadline", done: false })}>
          <Plus size={14} /> {t("cal.add")}
        </button>
      </div>
      <div className="cal-wrap">
        <div className="cal-grid">
          {weekdays.map((w) => (
            <div key={w} className="cal-wd">
              {w}
            </div>
          ))}
          {cells.map((d, i) =>
            d ? (
              <div
                key={d}
                className={`cal-day ${d === today ? "today" : ""}`}
                onDoubleClick={() => setEditing({ id: newId(), date: d, title: "", kind: "other", done: false })}
              >
                <span className="cal-n">{Number(d.slice(8))}</span>
                {days[d]?.w ? <span className="cal-words" title={t("cal.written")}>+{formatNumber(days[d].w, lang)}</span> : null}
                {entries
                  .filter((e) => e.date === d)
                  .map((e) => (
                    <button key={e.id} className={`cal-ev ${e.done ? "done" : ""}`} style={{ borderLeftColor: e.color }} onClick={() => e.item && setEditing(e.item)} title={e.item?.note || e.title}>
                      {e.title}
                    </button>
                  ))}
              </div>
            ) : (
              <div key={`x${i}`} className="cal-day off" />
            ),
          )}
        </div>
        <aside className="cal-side">
          <h3>{t("cal.upcoming")}</h3>
          {upcoming.length === 0 && <p className="muted">{t("cal.nothing")}</p>}
          {upcoming.map((e) => (
            <div key={e.id} className="cal-up" style={{ borderLeftColor: e.color }}>
              <b>{e.title}</b>
              <span className="muted">
                {new Date(e.date + "T00:00").toLocaleDateString(lang, { day: "numeric", month: "short" })} · {daysTo(e.date) === 0 ? t("cal.isToday") : t("cal.inDays", { n: daysTo(e.date) })}
              </span>
            </div>
          ))}
          <h3>{t("cal.legend")}</h3>
          {KINDS.map((k) => (
            <div key={k} className="cal-leg">
              <i style={{ background: COLORS[k] }} /> {t(`cal.kind.${k}` as TKey)}
            </div>
          ))}
          <p className="muted small">{t("cal.hint")}</p>
        </aside>
      </div>
      {editing && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal cal-edit">
            <header>
              <h2>{m.agenda.some((a) => a.id === editing.id) ? t("cal.edit") : t("cal.add")}</h2>
            </header>
            <div className="body">
              <label className="field">
                <span>{t("cal.title")}</span>
                <input className="input" autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </label>
              <div className="grid2">
                <label className="field">
                  <span>{t("cal.date")}</span>
                  <input className="input" type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t("cal.kind")}</span>
                  <select className="select" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as AgendaItem["kind"] })}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`cal.kind.${k}` as TKey)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>{t("cal.note")}</span>
                <textarea className="textarea" rows={2} value={editing.note ?? ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={editing.done} onChange={(e) => setEditing({ ...editing, done: e.target.checked })} /> {t("cal.done")}
              </label>
            </div>
            <footer>
              {m.agenda.some((a) => a.id === editing.id) && (
                <button
                  className="btn danger"
                  style={{ marginRight: "auto" }}
                  onClick={() => {
                    edit((mm) => void (mm.agenda = mm.agenda.filter((a) => a.id !== editing.id)));
                    setEditing(null);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button className="btn" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn primary" disabled={!editing.title.trim() || !editing.date} onClick={() => save({ ...editing, title: editing.title.trim() })}>
                {t("cal.save")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
