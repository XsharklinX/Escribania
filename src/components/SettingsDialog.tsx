import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { SHORTCUTS, comboFor, comboOf, type ShortcutId } from "../lib/shortcuts";
import { openPath } from "@tauri-apps/plugin-opener";
import { useStore } from "../store";
import type { FontId, Lang, QuoteStyle, ThemeId } from "../types";
import { useT, type TKey } from "../lib/i18n";
import { backupNow, flushAll, startBackups } from "../lib/saver";
import { checkForUpdate, rollback, useUpdate } from "../lib/updater";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { createSaga, joinSaga, leaveSaga, pushSaga, sagaInfo, type SagaFile } from "../lib/saga";
import Modal from "./Modal";
import ExtensionsTab from "./ExtensionsTab";
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

type Tab = "look" | "writing" | "a11y" | "ext" | "project" | "data";

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
    ["a11y", "a11y.tab"],
    ["ext", "ext.tab"],
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

        {tab === "a11y" && <A11yTab />}
        {tab === "ext" && <ExtensionsTab />}

        {tab === "project" && m && (
          <>
            <SagaSection />
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
            <UpdatesSection />
            <p className="muted">
              Escribanía v{info?.version} · {t("set.about")}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function SagaSection() {
  const t = useT();
  const sagaRel = useStore((st) => st.project?.manifest.saga);
  const toast = useStore((st) => st.toast);
  const [info, setInfo] = useState<SagaFile | null>(null);
  const [name, setName] = useState("");
  useEffect(() => void sagaInfo().then(setInfo), [sagaRel]);
  const fail = (e: unknown) => toast(String(e), "error");
  return (
    <div className="field saga-box">
      <span>{t("saga.title")}</span>
      {sagaRel ? (
        <>
          <p>
            <b>{info?.name ?? sagaRel}</b> · {t("saga.books", { n: info?.books.length ?? 1 })} · {t("saga.entries", { n: info?.codex.length ?? 0 })}
          </p>
          {info && <small className="muted">{info.books.map((b) => b.title).join(" · ")}</small>}
          <small className="muted">{t("saga.how")}</small>
          <div className="row-wrap">
            <button className="btn" onClick={() => void pushSaga().then(() => sagaInfo().then(setInfo))}>
              {t("saga.syncNow")}
            </button>
            <button className="btn ghost" onClick={leaveSaga}>
              {t("saga.leave")}
            </button>
          </div>
        </>
      ) : (
        <>
          <small className="muted">{t("saga.hint")}</small>
          <div className="row-wrap">
            <input className="input" style={{ maxWidth: 220 }} placeholder={t("saga.namePh")} value={name} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn"
              disabled={!name.trim()}
              onClick={async () => {
                const dir = await openDialog({ directory: true, multiple: false, title: t("saga.where") });
                if (typeof dir !== "string") return;
                const sep = dir.includes("\\") ? "\\" : "/";
                await createSaga(`${dir}${sep}${name.trim()}.saga.json`, name.trim()).catch(fail);
              }}
            >
              {t("saga.create")}
            </button>
            <button
              className="btn"
              onClick={async () => {
                const path = await openDialog({ multiple: false, filters: [{ name: "Saga", extensions: ["json"] }] });
                if (typeof path === "string") await joinSaga(path).catch(fail);
              }}
            >
              {t("saga.join")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function A11yTab() {
  const t = useT();
  const s = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapturing(null);
      const combo = e.key === "Backspace" || e.key === "Delete" ? "" : comboOf(e);
      if (combo === "" && e.key !== "Backspace" && e.key !== "Delete") return;
      set({ keys: { ...useStore.getState().settings.keys, [capturing]: combo } });
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, set]);
  const taken = (id: ShortcutId, combo: string) => combo && SHORTCUTS.some((x) => x.id !== id && comboFor(x.id) === combo);
  return (
    <>
      <label className="check">
        <input id="a11y-dys" type="checkbox" checked={s.dyslexia} onChange={(e) => set({ dyslexia: e.target.checked })} />
        <span>
          {t("a11y.dyslexia")}
          <small className="muted" style={{ display: "block" }}>{t("a11y.dyslexiaHint")}</small>
        </span>
      </label>
      <label className="check">
        <input id="a11y-contrast" type="checkbox" checked={s.contrast} onChange={(e) => set({ contrast: e.target.checked })} />
        {t("a11y.contrast")}
      </label>
      <label className="check">
        <input id="a11y-motion" type="checkbox" checked={s.reduceMotion} onChange={(e) => set({ reduceMotion: e.target.checked })} />
        {t("a11y.motion")}
      </label>
      <Range label={t("a11y.scale")} value={s.uiScale} min={0.8} max={1.6} step={0.05} onChange={(v) => set({ uiScale: v })} />
      <div className="field">
        <span>{t("a11y.keys")}</span>
        <div className="keys-table">
          {SHORTCUTS.map((sc) => {
            const combo = comboFor(sc.id);
            return (
              <div key={sc.id} className="keys-row">
                <span>{t(`key.${sc.id}` as TKey)}</span>
                <button className={`kbd ${capturing === sc.id ? "capturing" : ""} ${taken(sc.id, combo) ? "clash" : ""}`} onClick={() => setCapturing(capturing === sc.id ? null : sc.id)}>
                  {capturing === sc.id ? t("a11y.press") : combo || t("a11y.none")}
                </button>
                {s.keys[sc.id] !== undefined && (
                  <button
                    className="mini"
                    title={t("a11y.reset")}
                    onClick={() => {
                      const k = { ...s.keys };
                      delete k[sc.id];
                      set({ keys: k });
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <small className="muted">{t("a11y.keysHint")}</small>
      </div>
    </>
  );
}

function UpdatesSection() {
  const t = useT();
  const s = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const u = useUpdate();
  if (!u.status) return null;
  if (!u.status.configured) return <p className="muted">{t("up.notConfigured")}</p>;
  const last = s.updateChecked ? new Date(s.updateChecked).toLocaleString(s.lang) : "—";
  return (
    <div className="field">
      <span>{t("up.section")}</span>
      <div className="update-row">
        <select id="set-updates" className="select" style={{ maxWidth: 260 }} value={s.updates} onChange={(e) => set({ updates: e.target.value as typeof s.updates })}>
          <option value="stable">{t("up.channel.stable")}</option>
          <option value="beta">{t("up.channel.beta")}</option>
          <option value="off">{t("up.channel.off")}</option>
        </select>
        <button className="btn" disabled={u.phase === "checking" || u.phase === "downloading"} onClick={() => void checkForUpdate(true)}>
          {u.phase === "checking" ? t("up.checking") : t("up.checkNow")}
        </button>
        {u.status.previous && (
          <button
            className="btn"
            onClick={async () => {
              if (!(await ask(t("up.rollbackAsk", { v: u.status!.previous! }), { kind: "warning" }))) return;
              if (useStore.getState().project) await flushAll();
              await rollback().catch((e) => useStore.getState().toast(String(e)));
            }}
          >
            {t("up.rollback", { v: u.status.previous })}
          </button>
        )}
      </div>
      <small className="muted">
        {u.phase === "none" ? t("up.upToDate") + " · " : u.phase === "error" ? u.error + " · " : ""}
        {t("up.lastCheck", { d: last })}
      </small>
    </div>
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
