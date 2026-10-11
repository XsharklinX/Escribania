import { useEffect, useState } from "react";
import { CloudRain, Flame, Waves, X } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../lib/i18n";
import { isPlaying, setAmbientVolume, toggleAmbient, type Ambient } from "../lib/ambient";
import { bookWords } from "../lib/tree";
import { formatNumber } from "../lib/words";
import { setRetiro } from "./Workspace";

/** Barra flotante de Retiro: aparece al mover el ratón y se esconde al escribir. */
export default function RetiroBar() {
  const t = useT();
  const volume = useStore((s) => s.settings.ambientVolume);
  const setSettings = useStore((s) => s.setSettings);
  const session = useStore((s) => bookWords(s.project!.manifest, s.words) - s.sessionStart);
  const lang = useStore((s) => s.settings.lang);
  const [visible, setVisible] = useState(true);
  const [, force] = useState(0);

  useEffect(() => {
    let timer = setTimeout(() => setVisible(false), 2500);
    const show = () => {
      setVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), 2500);
    };
    const hide = () => setVisible(false);
    window.addEventListener("mousemove", show);
    window.addEventListener("keydown", hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", show);
      window.removeEventListener("keydown", hide);
    };
  }, []);

  useEffect(() => setAmbientVolume(volume), [volume]);

  const sound = (kind: Ambient, Icon: typeof CloudRain, label: string) => (
    <button
      className={isPlaying(kind) ? "on" : ""}
      onClick={() => {
        toggleAmbient(kind);
        setAmbientVolume(volume);
        force((n) => n + 1);
      }}
    >
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div className={`retiro-bar ${visible ? "" : "hidden"}`}>
      {sound("rain", CloudRain, t("retiro.rain"))}
      {sound("fire", Flame, t("retiro.fire"))}
      {sound("sea", Waves, t("retiro.sea"))}
      <input
        id="retiro-volume"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        aria-label={t("retiro.volume")}
        onChange={(e) => setSettings({ ambientVolume: Number(e.target.value) })}
      />
      <span className="count">
        {session >= 0 ? "+" : "−"}
        {formatNumber(Math.abs(session), lang)} {t("ed.words")}
      </span>
      <button onClick={() => void setRetiro(false)}>
        <X size={14} /> {t("retiro.exit")}
      </button>
    </div>
  );
}
