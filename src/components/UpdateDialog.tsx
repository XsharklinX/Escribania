import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ShieldCheck } from "lucide-react";
import logo from "../assets/logo.png";
import { useStore } from "../store";
import { useT } from "../lib/i18n";
import { flushAll, backupNow } from "../lib/saver";
import { saveJournal } from "../lib/journal";
import { applyUpdate, formatSize, useUpdate } from "../lib/updater";
import type { ReleaseNotes } from "../types";

/** «Fe de erratas»: las novedades de una edición, como en un libro. */
export default function UpdateDialog() {
  const t = useT();
  const u = useUpdate();
  const lang = useStore((s) => s.settings.lang);
  const notesSaved = useStore((s) => s.settings.updateNotes);
  const setSettings = useStore((s) => s.setSettings);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  if (!u.dialog) return null;

  const done = u.dialog === "done";
  const close = () => {
    useUpdate.setState({ dialog: null });
    if (done) setSettings({ updateNotes: null });
  };
  const notesAll = done ? notesSaved?.notes : u.release?.notes;
  const notes: ReleaseNotes | undefined = notesAll?.[lang] ?? notesAll?.es ?? notesAll?.en;
  const from = u.status?.version ?? "";
  const to = done ? notesSaved?.version ?? from : u.release?.version ?? "";
  const size = formatSize(u.release?.asset?.size ?? 0);
  const pct = u.progress.total ? Math.min(100, Math.round((u.progress.done / u.progress.total) * 100)) : 0;
  const manual = !done && (!u.status?.canApply || !u.release?.asset);

  const restart = async () => {
    setBusy(true);
    try {
      if (useStore.getState().project) {
        await flushAll();
        await saveJournal();
        await backupNow();
      }
      await applyUpdate(true);
    } catch (e) {
      toast(String(e));
      setBusy(false);
    }
  };

  const sections: [keyof ReleaseNotes, string][] = [
    ["nuevo", t("up.new")],
    ["mejorado", t("up.improved")],
    ["corregido", t("up.fixed")],
  ];
  const empty = !notes || sections.every(([k]) => !notes[k]?.length);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="errata" role="dialog" aria-label={t("up.title")}>
        <div className="er-head">
          <img src={logo} alt="" />
          <div>
            <h2>{done ? t("up.titleDone") : t("up.title")}</h2>
            <span className="v">
              ESCRIBANÍA {done ? "" : `${from} → `}
              {to}
              {size && !done ? ` · ${size}` : ""}
            </span>
          </div>
        </div>
        <div className="er-body">
          {done && <p className="muted">{t("up.doneText", { v: to })}</p>}
          {empty ? (
            <p className="muted">{t("up.noNotes")}</p>
          ) : (
            sections.map(([k, label]) =>
              notes![k]?.length ? (
                <div className="er-sec" key={k}>
                  <span className="k">{label}</span>
                  <ul>
                    {notes![k].map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )
          )}
        </div>
        <div className="er-foot">
          {!done && !manual && (
            <div className="er-prog">
              {u.phase === "downloading" && (
                <>
                  <span>{t("up.downloading")}</span>
                  <div className="bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <span>{pct}%</span>
                </>
              )}
              {u.phase === "ready" && (
                <span className="ok">
                  <ShieldCheck size={14} /> {t("up.verified")} · {t("up.ready")}
                </span>
              )}
              {u.phase === "error" && <span className="bad">{u.error}</span>}
            </div>
          )}
          {manual && <p className="muted" style={{ margin: 0 }}>{t("up.manual")}</p>}
          <div className="er-acts">
            {done ? (
              <button className="btn primary" onClick={close}>
                {t("up.gotIt")}
              </button>
            ) : manual ? (
              <button className="btn primary" onClick={() => u.status?.releasesUrl && void openUrl(u.status.releasesUrl)}>
                {t("up.web")}
              </button>
            ) : (
              <>
                <button className="btn primary" disabled={u.phase !== "ready" || busy} onClick={() => void restart()}>
                  {t("up.restart")}
                </button>
                <button
                  className="btn"
                  disabled={u.phase !== "ready" || busy}
                  onClick={() => {
                    useUpdate.setState({ applyOnClose: true, dialog: null });
                    toast(t("up.onCloseSet"));
                  }}
                >
                  {t("up.onClose")}
                </button>
              </>
            )}
            {!done && (
              <button className="btn ghost" onClick={close}>
                {t("up.later")}
              </button>
            )}
            <span className="sp" />
            {u.status?.releasesUrl && (
              <a href="#" onClick={(e) => (e.preventDefault(), void openUrl(u.status!.releasesUrl))}>
                {t("up.seeGithub")}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
