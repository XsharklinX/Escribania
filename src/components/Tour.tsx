import { useEffect, useLayoutEffect, useState } from "react";
import { useStore } from "../store";
import { useT, type TKey } from "../lib/i18n";

/** Recorrido de dos minutos: cada paso ilumina una parte de la ventana. */
const STEPS: { sel: string; key: string }[] = [
  { sel: ".binder", key: "tour.0" },
  { sel: ".editor-split", key: "tour.1" },
  { sel: ".editor-bar", key: "tour.2" },
  { sel: ".modes", key: "tour.3" },
  { sel: ".inspector", key: "tour.4" },
  { sel: "[data-tour=retiro]", key: "tour.5" },
  { sel: ".statusbar", key: "tour.6" },
];

export default function Tour() {
  const t = useT();
  const step = useStore((s) => s.tour);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const s = step !== null ? STEPS[step] : null;

  useLayoutEffect(() => {
    if (!s) return;
    const measure = () => setRect(document.querySelector(s.sel)?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [s]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useStore.setState({ tour: null });
      if (e.key === "ArrowRight" || e.key === "Enter") next();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (step === null || !s) return null;
  const next = () => useStore.setState({ tour: step + 1 < STEPS.length ? step + 1 : null });
  const pad = 6;
  const r = rect ?? new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 2 - 50, 200, 100);
  // La tarjeta va a la derecha del hueco si cabe; si no, debajo o encima.
  const cardW = 320;
  let left = r.right + 16;
  let top = r.top;
  if (left + cardW > window.innerWidth - 12) {
    left = Math.max(12, Math.min(r.left, window.innerWidth - cardW - 12));
    top = r.bottom + 16 + 180 < window.innerHeight ? r.bottom + 16 : Math.max(12, r.top - 200);
  }
  top = Math.max(12, Math.min(top, window.innerHeight - 200));
  return (
    <div className="tour">
      <div className="tour-hole" style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }} />
      <div className="tour-card" style={{ left, top, width: cardW }}>
        <span className="tour-n">
          {step + 1} / {STEPS.length}
        </span>
        <h3>{t(`${s.key}.title` as TKey)}</h3>
        <p>{t(`${s.key}.text` as TKey)}</p>
        <div className="row-wrap">
          <button className="btn ghost" onClick={() => useStore.setState({ tour: null })}>
            {t("tour.skip")}
          </button>
          <span className="spacer" />
          {step > 0 && (
            <button className="btn" onClick={() => useStore.setState({ tour: step - 1 })}>
              {t("tour.back")}
            </button>
          )}
          <button className="btn primary" onClick={next}>
            {step + 1 < STEPS.length ? t("tour.next") : t("tour.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
