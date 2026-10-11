import { useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useStore } from "../store";
import type { FontId, Lang, QuoteStyle, ThemeId } from "../types";
import { useT, type TKey } from "../lib/i18n";
import { backupNow, startBackups } from "../lib/saver";
import Modal from "./Modal";
import { ttsAvailable, voicesFor } from "../lib/tts";

const THEMES: { id: ThemeId; name: string; colors: string[] }[] = [
  { id: "algodon", name: "Algodón", colors: ["#E6E8EC", "#FFFFFF", "#3350D1", "#23262D"] },
  { id: "tinta", name: "Tinta", colors: ["#0D1220", "#192136", "#8EA2FF", "#DCE2F0"] },
  { id: "olivetti", name: "Olivetti", colors: ["#D6CCB8", "#F1EADC", "#4F6B2A", "#38301F"] },
  { id: "pizarra", name: "Pizarra", colors: ["#1A1C1E", "#292C2F", "#E9B04B", "#ECE8E0"] },
];

const FONTS: { id: FontId; name: string; css: string }[] = [
  { id: "literata", name: "Literata", css: '"Literata", serif' },
  { id: "source-serif", name: "Source Serif", css: '"Source Serif 4", serif' },
  { id: "courier-prime", name: "Courier Prime", css: '"Courier Prime", monospace' },
  { id: "system", name: "Georgia", css: "Georgia, serif" },
];

type Tab = "look" | "writing" | "project" | "data";

export default function SettingsDialog() {
  const t = useT();
  const s = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const info = useStore((st) => st.info);
  const m = useStore((st) => st.project?.manifest);
  const edit = useStore((st) => st.editManifest);
  const toast = useStore((st) => st.toast);
  const [tab, setTab] = useState<Tab>("look");
  const close = () => useStore.setState({ dialog: null });

  const tabs: [Tab, TKey][] = [
    ["look", "set.tab.look"],
    ["writing", "set.tab.writing"],
    ["project", "set.tab.project"],
    ["data", "set.tab.data"],
  ];

  return (
    <Modal title={t("set.title")} onClose={close} wide footer={<button className="btn primary" onClick={close}>{t("set.close")}</button>}>
      <div className="tabs">
        {tabs.map(([id, key]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {t(key)}
          </button>
        ))}
      </div>
      <div className="body">
        {tab === "look" && (
          <>
            <div className="field">
              <span>{t("set.theme")}</span>
              <div className="choice-grid">
                {THEMES.map((th) => (
                  <button key={th.id} className={`choice ${s.theme === th.id ? "on" : ""}`} onClick={() => set({ theme: th.id })}>
                    <span className="theme-swatch">
                      {th.colors.map((c) => (
                        <i key={c} style={{ background: c }} />
                      ))}
                    </span>
                    <b>{th.name}</b>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>{t("set.font")}</span>
              <div className="choice-grid">
                {FONTS.map((f) => (
                  <button key={f.id} className={`choice ${s.font === f.id ? "on" : ""}`} onClick={() => set({ font: f.id })}>
                    <b style={{ fontFamily: f.css, fontSize: 17, fontWeight: 400 }}>{f.name}</b>
                    <small style={{ fontFamily: f.css }}>—Aún no, dijo ella.</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid2">
              <Range label={t("set.fontSize")} value={s.fontSize} min={13} max={28} step={1} unit=" px" onChange={(v) => set({ fontSize: v })} />
              <Range label={t("set.lineHeight")} value={s.lineHeight} min={1.3} max={2.4} step={0.05} onChange={(v) => set({ lineHeight: v })} />
              <Range label={t("set.lineWidth")} value={s.lineWidth} min={480} max={1000} step={20} unit=" px" onChange={(v) => set({ lineWidth: v })} />
              <label className="field">
                <span>{t("set.lang")}</span>
                <select id="set-lang" className="select" value={s.lang} onChange={(e) => set({ lang: e.target.value as Lang })}>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
          </>
        )}

        {tab === "writing" && (
          <>
            <div className="field">
              <span>{t("set.paragraph")}</span>
              <div className="choice-grid">
                {(["indent", "spaced"] as const).map((p) => (
                  <button key={p} className={`choice ${s.paragraph === p ? "on" : ""}`} onClick={() => set({ paragraph: p })}>
                    <b>{t(`set.paragraph.${p}`)}</b>
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input id="set-typewriter" type="checkbox" checked={s.typewriter} onChange={(e) => set({ typewriter: e.target.checked })} />
              {t("set.typewriter")}
            </label>
            {m && (
              <>
                <label className="field">
                  <span>{t("set.quotes")}</span>
                  <select
                    id="set-quotes"
                    className="select"
                    value={m.prefs.quotes}
                    onChange={(e) => edit((mm) => void (mm.prefs.quotes = e.target.value as QuoteStyle))}
                  >
                    <option value="latin">{t("set.quotes.latin")}</option>
                    <option value="english">{t("set.quotes.english")}</option>
                    <option value="none">{t("set.quotes.none")}</option>
                  </select>
                </label>
                <label className="check">
                  <input id="set-dash" type="checkbox" checked={m.prefs.dialogueDash} onChange={(e) => edit((mm) => void (mm.prefs.dialogueDash = e.target.checked))} />
                  {t("set.dialogueDash")}
                </label>
              </>
            )}
            <label className="check">
              <input id="set-mentions" type="checkbox" checked={s.mentions} onChange={(e) => set({ mentions: e.target.checked })} />
              {t("set.mentions")}
            </label>
            <label className="check">
              <input id="set-capture" type="checkbox" checked={s.quickCapture} onChange={(e) => set({ quickCapture: e.target.checked })} />
              {t("set.quickCapture")}
            </label>
            <label className="field">
              <span>{t("set.spell")}</span>
              <select id="set-spell" className="select" style={{ maxWidth: 360 }} value={s.spell} onChange={(e) => set({ spell: e.target.value as typeof s.spell })}>
                <option value="app">{t("set.spell.app")}</option>
                <option value="system">{t("set.spell.system")}</option>
                <option value="off">{t("set.spell.off")}</option>
              </select>
            </label>
            {ttsAvailable() && (
              <div className="grid2">
                <label className="field">
                  <span>{t("set.voice")}</span>
                  <select id="set-voice" className="select" value={s.ttsVoice} onChange={(e) => set({ ttsVoice: e.target.value })}>
                    <option value="">{t("set.voiceAuto")}</option>
                    {voicesFor(s.lang).map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Range label={t("set.voiceRate")} value={s.ttsRate} min={0.6} max={1.6} step={0.05} onChange={(v) => set({ ttsRate: v })} />
              </div>
            )}
            <label className="field">
              <span>{t("set.authorName")}</span>
              <input id="set-author" className="input" style={{ maxWidth: 300 }} value={s.authorName} placeholder={t("cm.you")} onChange={(e) => set({ authorName: e.target.value })} />
            </label>
          </>
        )}

        {tab === "project" && m && (
          <>
            <div className="grid2">
              <label className="field">
                <span>{t("set.projTitle")}</span>
                <input id="set-ptitle" className="input" value={m.title} onChange={(e) => edit((mm) => void (mm.title = e.target.value))} />
              </label>
              <label className="field">
                <span>{t("set.projAuthor")}</span>
                <input id="set-pauthor" className="input" value={m.author} onChange={(e) => edit((mm) => void (mm.author = e.target.value))} />
              </label>
              <label className="field">
                <span>{t("set.projTarget")}</span>
                <input
                  id="set-ptarget"
                  className="input"
                  type="number"
                  min={0}
                  step={1000}
                  value={m.target.words || ""}
                  onChange={(e) => edit((mm) => void (mm.target.words = Math.max(0, Number(e.target.value) || 0)))}
                />
              </label>
              <label className="field">
                <span>{t("set.projDeadline")}</span>
                <input
                  id="set-pdeadline"
                  className="input"
                  type="date"
                  value={m.target.deadline ?? ""}
                  onChange={(e) => edit((mm) => void (mm.target.deadline = e.target.value || null))}
                />
              </label>
            </div>
          </>
        )}

        {tab === "data" && (
          <>
            <div className="grid2">
              <Range label={t("set.backupKeep")} value={s.backupKeep} min={3} max={100} step={1} onChange={(v) => set({ backupKeep: v })} />
              <Range
                label={t("set.backupMinutes")}
                value={s.backupMinutes}
                min={5}
                max={60}
                step={5}
                onChange={(v) => {
                  set({ backupMinutes: v });
                  if (m) startBackups();
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {m && (
                <button
                  className="btn"
                  onClick={async () => {
                    if (await backupNow(true)) toast(t("set.backupDone"));
                  }}
                >
                  {t("set.backupNow")}
                </button>
              )}
              {info && (
                <button className="btn" onClick={() => void openPath(info.backups_dir).catch(() => {})}>
                  {t("set.openBackups")}
                </button>
              )}
            </div>
            {info && (
              <>
                <div className="field">
                  <span>{t("set.mode")}</span>
                  <div>{info.portable ? t("set.mode.portable") : t("set.mode.installed")}</div>
                </div>
                <div className="field">
                  <span>{t("set.dataDir")}</span>
                  <div className="path">{info.data_dir}</div>
                </div>
              </>
            )}
            <p className="muted">
              Escribanía v{info?.version} · {t("set.about")}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function Range(p: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <div className="range-row">
        <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
        <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 54, textAlign: "right" }}>
          {Number.isInteger(p.step) ? p.value : p.value.toFixed(2)}
          {p.unit ?? ""}
        </span>
      </div>
    </label>
  );
}
