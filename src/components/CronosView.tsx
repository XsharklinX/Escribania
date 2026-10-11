import { useRef, useState } from "react";
import { CalendarCog, Plus, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { Calendar, TimelineEvent, TreeNode } from "../types";
import { useT } from "../lib/i18n";
import { conflicts, dayLabel } from "../lib/calendar";
import { locate, walk } from "../lib/tree";
import { povColor, PALETTE } from "../lib/model";
import { newId } from "../lib/ids";
import Modal from "./Modal";

type Sel = { kind: "text"; id: string } | { kind: "event"; id: string } | null;

const ROW = 28;

/** Filas dentro de una pista para que lo que coincide en el tiempo no se tape. */
export function stackRows(items: { id: string; t: number; span: number }[]): { rows: Map<string, number>; count: number } {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const it of [...items].sort((a, b) => a.t - b.t)) {
    let r = ends.findIndex((e) => e <= it.t);
    if (r < 0) r = ends.length;
    ends[r] = it.t + Math.max(1, it.span);
    rows.set(it.id, r);
  }
  return { rows, count: Math.max(1, ends.length) };
}

/** Cronos: la historia en el tiempo, con una pista por personaje. */
export default function CronosView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const lang = useStore((s) => s.settings.lang);
  const mentions = useStore((s) => s.mentions);
  const edit = useStore((s) => s.editManifest);
  const [dayW, setDayW] = useState(56);
  const [sel, setSel] = useState<Sel>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [drag, setDrag] = useState<{ kind: "text" | "event"; id: string; dx: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const cal = m.calendar;

  const texts: { n: TreeNode; order: number }[] = [];
  walk(m.sections.manuscript, (n) => {
    if (n.type === "text" && n.include) texts.push({ n, order: texts.length + 1 });
  });
  const dated = texts.filter((x) => x.n.t != null);
  const undated = texts.filter((x) => x.n.t == null);
  const all = [...dated.map((x) => x.n.t!), ...dated.map((x) => x.n.t! + (x.n.span ?? 1)), ...m.events.flatMap((e) => [e.t, e.t + e.span])];
  const min = Math.min(0, ...all) - 1;
  const max = Math.max(min + 16, ...all) + 3;
  const days = Array.from({ length: max - min }, (_, i) => min + i);
  const x = (day: number) => (day - min) * dayW;
  const characters = m.codex.filter((e) => e.kind === "character");
  const lanes = characters.filter((c) => dated.some((d) => d.n.pov === c.id || (mentions[c.id]?.[d.n.file!] ?? 0) > 0) || m.events.some((e) => e.lane === c.id));
  const issues = conflicts(m, mentions);
  const places = m.codex.filter((e) => e.kind === "place");

  // Escenas narradas antes que otras que ocurren después: flashbacks.
  const flash = new Set<string>();
  let lastT = -Infinity;
  for (const d of dated.sort((a, b) => a.order - b.order)) {
    if (d.n.t! < lastT) flash.add(d.n.id);
    lastT = Math.max(lastT, d.n.t!);
  }

  const dayAt = (clientX: number) => {
    const el = area.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.round((clientX - r.left + el.scrollLeft - 120) / dayW) + min;
  };
  const setText = (id: string, patch: Partial<TreeNode>) => edit((mm) => void Object.assign(locate(mm, id)!.node, patch));
  const setEvent = (id: string, patch: Partial<TimelineEvent>) => edit((mm) => void Object.assign(mm.events.find((e) => e.id === id)!, patch));

  const startDrag = (e: React.PointerEvent, kind: "text" | "event", id: string, t0: number) => {
    e.preventDefault();
    setSel({ kind, id });
    const startX = e.clientX;
    let dx = 0;
    const move = (ev: PointerEvent) => {
      dx = Math.round((ev.clientX - startX) / dayW);
      setDrag({ kind, id, dx });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (dx) kind === "text" ? setText(id, { t: t0 + dx }) : setEvent(id, { t: t0 + dx });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const bar = (n: TreeNode, order: number, lane: string, row = 0) => {
    const t0 = n.t! + (drag?.kind === "text" && drag.id === n.id ? drag.dx : 0);
    return (
      <div
        key={lane + n.id}
        className={`tl-bar ${sel?.kind === "text" && sel.id === n.id ? "on" : ""} ${flash.has(n.id) ? "flash" : ""}`}
        style={{ left: x(t0), top: 5 + row * ROW, width: Math.max(1, n.span ?? 1) * dayW - 4, background: povColor(m, n) ?? "var(--acc)" }}
        title={`${order}. ${n.title} · ${dayLabel(cal, n.t!, lang)}`}
        onPointerDown={(e) => startDrag(e, "text", n.id, n.t!)}
        onDoubleClick={() => useStore.setState({ selected: n.id, view: "hoja" })}
      >
        <b>{order}</b> {n.title}
      </div>
    );
  };

  const selText = sel?.kind === "text" ? locate(m, sel.id)?.node : undefined;
  const selEvent = sel?.kind === "event" ? m.events.find((e) => e.id === sel.id) : undefined;

  return (
    <div className="view cronos-view">
      <div className="view-head">
        <h2>{t("view.cronos")}</h2>
        <span className="muted">{cal.kind === "custom" && cal.months.length ? t("cronos.customCal") : t("cronos.realCal")}</span>
        <span className="spacer" />
        <input type="range" min={24} max={140} value={dayW} onChange={(e) => setDayW(Number(e.target.value))} title={t("mural.zoom")} style={{ width: 110 }} />
        <button
          className="btn"
          onClick={() => {
            const ev: TimelineEvent = { id: newId(), title: t("cronos.newEvent"), t: 0, span: 1, lane: "", color: PALETTE[m.events.length % PALETTE.length], note: "" };
            edit((mm) => void mm.events.push(ev));
            setSel({ kind: "event", id: ev.id });
          }}
        >
          <Plus size={15} /> {t("cronos.addEvent")}
        </button>
        <button className="btn" onClick={() => setCalOpen(true)}>
          <CalendarCog size={15} /> {t("cronos.calendar")}
        </button>
      </div>

      {undated.length > 0 && (
        <div className="tl-tray">
          <span className="muted">{t("cronos.undated")}</span>
          {undated.map(({ n, order }) => (
            <span key={n.id} className="tl-chip" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", n.id)} title={t("cronos.dragHint")}>
              {order}. {n.title}
            </span>
          ))}
        </div>
      )}

      <div
        className="tl-area"
        ref={area}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("text/plain");
          if (id && locate(m, id)) setText(id, { t: dayAt(e.clientX), span: 1 });
        }}
      >
        <div className="tl-inner" style={{ width: 120 + days.length * dayW }}>
          <div className="tl-row tl-scale">
            <span className="tl-label" />
            <div className="tl-lane">
              {days.map((d) => (
                <span key={d} className="tl-day" style={{ left: x(d), width: dayW }}>
                  {dayLabel(cal, d, lang, true)}
                </span>
              ))}
            </div>
          </div>
          <div className="tl-row">
            <span className="tl-label">
              <b>{t("cronos.book")}</b>
            </span>
            <Lane items={dated.map(({ n }) => ({ id: n.id, t: n.t!, span: n.span ?? 1 }))}>{(rows) => dated.map(({ n, order }) => bar(n, order, "book", rows.get(n.id)))}</Lane>
          </div>
          <div className="tl-row">
            <span className="tl-label">{t("cronos.events")}</span>
            <Lane items={m.events.filter((e) => !e.lane)}>
              {(rows) =>
                m.events.filter((e) => !e.lane).map((e) => (
                  <EventBar key={e.id} e={e} row={rows.get(e.id) ?? 0} x={x} dayW={dayW} drag={drag} on={selEvent?.id === e.id} onDown={(ev) => startDrag(ev, "event", e.id, e.t)} />
                ))
              }
            </Lane>
          </div>
          {lanes.map((c) => (
            <div key={c.id} className="tl-row">
              <span className="tl-label" style={{ color: c.color }}>
                {c.name}
              </span>
              {(() => {
                const here = dated.filter((d) => d.n.pov === c.id || (mentions[c.id]?.[d.n.file!] ?? 0) > 0);
                const evs = m.events.filter((e) => e.lane === c.id);
                return (
                  <Lane items={[...here.map(({ n }) => ({ id: n.id, t: n.t!, span: n.span ?? 1 })), ...evs]}>
                    {(rows) => (
                      <>
                        {here.map(({ n, order }) => bar(n, order, c.id, rows.get(n.id)))}
                        {evs.map((e) => (
                          <EventBar key={e.id} e={e} row={rows.get(e.id) ?? 0} x={x} dayW={dayW} drag={drag} on={selEvent?.id === e.id} onDown={(ev) => startDrag(ev, "event", e.id, e.t)} />
                        ))}
                      </>
                    )}
                  </Lane>
                );
              })()}
            </div>
          ))}
        </div>
      </div>

      <div className="tl-bottom">
        {issues.length > 0 && (
          <div className="tl-issues">
            {issues.slice(0, 6).map((c, i) => (
              <p key={i} className="pulse-warn">
                ⚠ {t("cronos.conflict", { who: m.codex.find((e) => e.id === c.who)?.name ?? "?", day: dayLabel(cal, c.t, lang), places: c.places.map((p) => m.codex.find((e) => e.id === p)?.name ?? "?").join(" / ") })}
              </p>
            ))}
          </div>
        )}
        {flash.size > 0 && <p className="muted">{t("cronos.flashHint", { n: flash.size })}</p>}
        {selText && (
          <div className="tl-panel">
            <b>{selText.title}</b>
            <label>
              {t("cronos.day")} <input className="input" type="number" value={selText.t ?? 0} onChange={(e) => setText(selText.id, { t: Number(e.target.value) || 0 })} />
            </label>
            <span className="muted">{dayLabel(cal, selText.t ?? 0, lang)}</span>
            <label>
              {t("cronos.span")} <input className="input" type="number" min={1} value={selText.span ?? 1} onChange={(e) => setText(selText.id, { span: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
            <label>
              {t("cronos.place")}
              <select className="select" value={selText.place ?? ""} onChange={(e) => setText(selText.id, { place: e.target.value || undefined })}>
                <option value="">—</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" onClick={() => setText(selText.id, { t: null })}>
              {t("cronos.unschedule")}
            </button>
            <button className="icon-btn" onClick={() => setSel(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        {selEvent && (
          <div className="tl-panel">
            <input className="input" value={selEvent.title} onChange={(e) => setEvent(selEvent.id, { title: e.target.value })} />
            <label>
              {t("cronos.day")} <input className="input" type="number" value={selEvent.t} onChange={(e) => setEvent(selEvent.id, { t: Number(e.target.value) || 0 })} />
            </label>
            <label>
              {t("cronos.span")} <input className="input" type="number" min={1} value={selEvent.span} onChange={(e) => setEvent(selEvent.id, { span: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
            <select className="select" value={selEvent.lane} onChange={(e) => setEvent(selEvent.id, { lane: e.target.value })}>
              <option value="">{t("cronos.events")}</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input type="color" className="color" value={selEvent.color} onChange={(e) => setEvent(selEvent.id, { color: e.target.value })} />
            <input className="input" placeholder={t("insp.notes")} value={selEvent.note} onChange={(e) => setEvent(selEvent.id, { note: e.target.value })} />
            <button
              className="icon-btn danger"
              onClick={() => {
                edit((mm) => void (mm.events = mm.events.filter((e) => e.id !== selEvent.id)));
                setSel(null);
              }}
            >
              <Trash2 size={14} />
            </button>
            <button className="icon-btn" onClick={() => setSel(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        {!selText && !selEvent && <p className="muted">{t("cronos.hint")}</p>}
      </div>
      {calOpen && <CalendarDialog cal={cal} onClose={() => setCalOpen(false)} />}
    </div>
  );
}

function Lane({ items, children }: { items: { id: string; t: number; span: number }[]; children: (rows: Map<string, number>) => React.ReactNode }) {
  const { rows, count } = stackRows(items);
  return (
    <div className="tl-lane" style={{ minHeight: count * ROW + 8 }}>
      {children(rows)}
    </div>
  );
}

function EventBar({ e, row, x, dayW, drag, on, onDown }: { e: TimelineEvent; row: number; x: (d: number) => number; dayW: number; drag: { kind: string; id: string; dx: number } | null; on: boolean; onDown: (ev: React.PointerEvent) => void }) {
  const t0 = e.t + (drag?.kind === "event" && drag.id === e.id ? drag.dx : 0);
  return (
    <div className={`tl-bar event ${on ? "on" : ""}`} style={{ left: x(t0), top: 5 + row * ROW, width: Math.max(1, e.span) * dayW - 4, background: e.color }} title={e.note || e.title} onPointerDown={onDown}>
      {e.title}
    </div>
  );
}

function CalendarDialog({ cal, onClose }: { cal: Calendar; onClose: () => void }) {
  const t = useT();
  const edit = useStore((s) => s.editManifest);
  const set = (patch: Partial<Calendar>) => edit((mm) => void Object.assign(mm.calendar, patch));
  return (
    <Modal title={t("cronos.calendar")} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{t("set.close")}</button>}>
      <div className="body">
        <div className="choice-grid">
          <button className={`choice ${cal.kind === "real" ? "on" : ""}`} onClick={() => set({ kind: "real" })}>
            <b>{t("cronos.realCal")}</b>
            <small>{t("cronos.realHint")}</small>
          </button>
          <button className={`choice ${cal.kind === "custom" ? "on" : ""}`} onClick={() => set({ kind: "custom", months: cal.months.length ? cal.months : [{ name: "Brumas", days: 30 }, { name: "Mareas", days: 30 }] })}>
            <b>{t("cronos.customCal")}</b>
            <small>{t("cronos.customHint")}</small>
          </button>
        </div>
        {cal.kind === "real" ? (
          <label className="field">
            <span>{t("cronos.startDate")}</span>
            <input className="input" type="date" value={cal.start} onChange={(e) => set({ start: e.target.value })} style={{ maxWidth: 200 }} />
          </label>
        ) : (
          <>
            <div className="grid2">
              <label className="field">
                <span>{t("cronos.yearName")}</span>
                <input className="input" value={cal.yearName} onChange={(e) => set({ yearName: e.target.value })} />
              </label>
              <label className="field">
                <span>{t("cronos.firstYear")}</span>
                <input className="input" type="number" value={cal.firstYear} onChange={(e) => set({ firstYear: Number(e.target.value) || 1 })} />
              </label>
            </div>
            <div className="field">
              <span>{t("cronos.months")}</span>
              {cal.months.map((mo, i) => (
                <div key={i} className="field-row">
                  <input className="input" value={mo.name} onChange={(e) => set({ months: cal.months.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input className="input" type="number" min={1} value={mo.days} onChange={(e) => set({ months: cal.months.map((x, j) => (j === i ? { ...x, days: Math.max(1, Number(e.target.value) || 1) } : x)) })} />
                  <button className="icon-btn" onClick={() => set({ months: cal.months.filter((_, j) => j !== i) })}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button className="btn" onClick={() => set({ months: [...cal.months, { name: "", days: 30 }] })}>
                <Plus size={14} /> {t("cronos.addMonth")}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
