import { Glasses } from "lucide-react";
import { useStore } from "../store";
import { useT, type TKey } from "../lib/i18n";
import { LENS_KINDS, readabilityLabel, useLens, type LensKind } from "../lib/style";
import { formatNumber } from "../lib/words";

const COLORS: Record<LensKind, string> = { rep: "#E0A100", adv: "#8A5BD6", crutch: "#2A9D8F", long: "#D9534F", passive: "#3B82F6" };

/** Inspector › Lupa: recuentos, legibilidad y qué se subraya. */
export default function LensPanel() {
  const t = useT();
  const s = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const result = useLens((st) => st.result);
  const kinds = useLens((st) => st.kinds);

  if (!s.lens)
    return (
      <div className="lens-off">
        <p className="muted">{t("lens.offHint")}</p>
        <button className="btn primary" onClick={() => set({ lens: true })}>
          <Glasses size={15} /> {t("lens.turnOn")}
        </button>
      </div>
    );

  const score = result?.readability ?? 0;
  return (
    <>
      {result && (
        <div className="field">
          <span>{t(s.lang === "es" ? "lens.readEs" : "lens.readEn")}</span>
          <div className="gauge">
            <i style={{ left: `${Math.max(0, Math.min(100, score))}%` }} />
          </div>
          <div className="gauge-labels">
            <span>{t("lens.hard")}</span>
            <b>
              {score} · {readabilityLabel(score, s.lang)}
            </b>
            <span>{t("lens.easy")}</span>
          </div>
          <small className="muted">
            {t("lens.stats", { w: formatNumber(result.words, s.lang), s: result.sentences, a: result.sentences ? Math.round(result.words / result.sentences) : 0 })}
          </small>
        </div>
      )}
      <div className="field">
        <span>{t("lens.marks")}</span>
        {LENS_KINDS.map((k) => (
          <label key={k} className="lens-row">
            <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => useLens.setState({ kinds: e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k) })} />
            <i style={{ background: COLORS[k] }} />
            <span>{t(`lens.${k}` as TKey)}</span>
            <b>{result?.counts[k] ?? 0}</b>
          </label>
        ))}
      </div>
      {result && result.topRepeated.length > 0 && (
        <div className="field">
          <span>{t("lens.top")}</span>
          <div className="chips">
            {result.topRepeated.map(([w, n]) => (
              <span key={w} className="chip-entry">
                {w}… <small className="muted">×{n}</small>
              </span>
            ))}
          </div>
        </div>
      )}
      <label className="field">
        <span>{t("lens.longLimit", { n: s.lensLong })}</span>
        <input type="range" min={20} max={80} value={s.lensLong} onChange={(e) => set({ lensLong: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>{t("lens.crutches")}</span>
        <textarea className="textarea" rows={2} value={s.crutches} placeholder={t("lens.crutchesPh")} onChange={(e) => set({ crutches: e.target.value })} />
      </label>
      <button className="btn" onClick={() => set({ lens: false })}>
        {t("lens.turnOff")}
      </button>
    </>
  );
}
