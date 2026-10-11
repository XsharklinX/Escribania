import { useEffect, useState } from "react";
import { Coffee, Square, Timer } from "lucide-react";
import { useStore } from "../store";
import { tNow, useT } from "../lib/i18n";
import { updateJournal, useJournal } from "../lib/journal";
import { formatNumber } from "../lib/words";
import Modal from "./Modal";

const DURATIONS = [10, 15, 20, 25, 30, 45, 60];

export function SprintDialog() {
  const t = useT();
  const s = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const [brave, setBrave] = useState(false);
  const close = () => useStore.setState({ dialog: null });

  const start = () => {
    useStore.setState({
      dialog: null,
      view: "hoja",
      sprint: { start: Date.now(), minutes: s.sprintMinutes, goal: s.sprintGoal, base: useJournal.getState().net, brave },
    });
  };

  return (
    <Modal
      title={t("sprint.title")}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="btn primary" onClick={start}>
            <Timer size={15} /> {t("sprint.start")}
          </button>
        </>
      }
    >
      <div className="body">
        <p className="muted">{t("sprint.hint")}</p>
        <div className="field">
          <span>{t("sprint.minutes")}</span>
          <div className="seg">
            {DURATIONS.map((d) => (
              <button key={d} className={s.sprintMinutes === d ? "on" : ""} onClick={() => set({ sprintMinutes: d })}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{t("sprint.goal")}</span>
          <input id="sprint-goal" className="input" type="number" min={50} step={50} style={{ width: 140 }} value={s.sprintGoal} onChange={(e) => set({ sprintGoal: Math.max(50, Number(e.target.value) || 50) })} />
        </label>
        <label className="check">
          <input id="sprint-brave" type="checkbox" checked={brave} onChange={(e) => setBrave(e.target.checked)} />
          {t("sprint.brave")}
        </label>
        <label className="check">
          <input id="sprint-break" type="checkbox" checked={s.sprintBreak} onChange={(e) => set({ sprintBreak: e.target.checked })} />
          {t("sprint.break")}
        </label>
      </div>
    </Modal>
  );
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function finish(early: boolean) {
  const st = useStore.getState();
  const sp = st.sprint;
  if (!sp || sp.finished) return;
  const words = useJournal.getState().net - sp.base;
  const minutes = early ? Math.max(1, Math.round((Date.now() - sp.start) / 60000)) : sp.minutes;
  if (words > 0 || !early)
    updateJournal((j) => ({ ...j, sprints: [...j.sprints, { start: new Date(sp.start).toISOString(), minutes, goal: sp.goal, words: Math.max(0, words), brave: sp.brave }] }));
  st.toast(words >= sp.goal ? tNow("sprint.won", { n: words }) : tNow("sprint.result", { n: Math.max(0, words), g: sp.goal }));
  if (!early && st.settings.sprintBreak) useStore.setState({ sprint: { ...sp, finished: true, breakUntil: Date.now() + 5 * 60000 } });
  else useStore.setState({ sprint: null });
}

export function SprintWidget() {
  const t = useT();
  const sp = useStore((s) => s.sprint)!;
  const lang = useStore((s) => s.settings.lang);
  const net = useJournal((s) => s.net);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const end = sp.start + sp.minutes * 60000;
  useEffect(() => {
    if (!sp.finished && now >= end) finish(false);
    if (sp.finished && sp.breakUntil && now >= sp.breakUntil) {
      useStore.setState({ sprint: null });
      useStore.getState().toast(tNow("sprint.breakOver"));
    }
  }, [now, end, sp]);

  if (sp.finished) {
    return (
      <button className="sprint-widget break" onClick={() => useStore.setState({ sprint: null })} title={t("sprint.skipBreak")}>
        <Coffee size={15} /> {t("sprint.breakLabel")} {mmss((sp.breakUntil ?? now) - now)}
      </button>
    );
  }

  const words = net - sp.base;
  const total = sp.minutes * 60000;
  const p = Math.min(1, (now - sp.start) / total);
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative" }}>
      <button className={`sprint-widget ${sp.brave ? "brave" : ""}`} onClick={() => setOpen(!open)} title={t("sprint.title")}>
        <svg width="20" height="20" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
          <circle cx="10" cy="10" r={r} fill="none" stroke="var(--acc)" strokeWidth="3" strokeDasharray={`${(c * p).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 10 10)" />
        </svg>
        <b>{mmss(end - now)}</b>
        <span>
          {formatNumber(Math.max(0, words), lang)}/{formatNumber(sp.goal, lang)}
        </span>
      </button>
      {open && (
        <div className="menu" style={{ position: "absolute", right: 0, top: 36 }} onMouseLeave={() => setOpen(false)}>
          <button
            onClick={() => {
              setOpen(false);
              finish(true);
            }}
          >
            <Square size={13} /> {t("sprint.stop")}
          </button>
          <button
            className="danger"
            onClick={() => {
              setOpen(false);
              useStore.setState({ sprint: null });
            }}
          >
            {t("sprint.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
