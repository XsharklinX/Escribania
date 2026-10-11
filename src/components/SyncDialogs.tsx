import { useState } from "react";
import { CloudOff, Copy, Laptop, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../lib/i18n";
import { closeProject } from "../lib/projects";
import { flushAll } from "../lib/saver";
import { reloadManifest, resolveCloud, resolveText, takeLock, useSync } from "../lib/sync";
import Modal from "./Modal";

/** Avisos de la sincronía por carpeta: otro equipo, cambios cruzados y copias en conflicto. */
export default function SyncDialogs() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const { foreignLock, textConflict, manifestConflict } = useSync();
  const time = (ms: number) => new Date(ms).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" });
  if (foreignLock)
    return (
      <Modal
        title={t("sync.lockTitle")}
        onClose={() => void takeLock()}
        footer={
          <>
            <button className="btn" onClick={() => void closeProject()}>
              {t("sync.close")}
            </button>
            <button className="btn primary" onClick={() => void takeLock()}>
              {t("sync.continue")}
            </button>
          </>
        }
      >
        <div className="body sync-body">
          <Laptop size={28} className="muted" />
          <p>{t("sync.lockText", { pc: foreignLock.machine, when: time(foreignLock.since) })}</p>
        </div>
      </Modal>
    );
  if (textConflict)
    return (
      <Modal
        title={t("sync.textTitle")}
        onClose={() => void resolveText("both")}
        footer={
          <>
            <button className="btn" onClick={() => void resolveText("theirs")}>
              {t("sync.theirs")}
            </button>
            <button className="btn" onClick={() => void resolveText("mine")}>
              {t("sync.mine")}
            </button>
            <button className="btn primary" onClick={() => void resolveText("both")}>
              {t("sync.both")}
            </button>
          </>
        }
      >
        <div className="body sync-body">
          <CloudOff size={28} className="muted" />
          <p>{t("sync.textText", { title: textConflict.title })}</p>
        </div>
      </Modal>
    );
  if (manifestConflict)
    return (
      <Modal
        title={t("sync.manTitle")}
        onClose={() => useSync.setState({ manifestConflict: false })}
        footer={
          <>
            <button className="btn" onClick={() => void reloadManifest()}>
              {t("sync.manTheirs")}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                useSync.setState({ manifestConflict: false });
                void flushAll();
              }}
            >
              {t("sync.manMine")}
            </button>
          </>
        }
      >
        <div className="body sync-body">
          <CloudOff size={28} className="muted" />
          <p>{t("sync.manText")}</p>
        </div>
      </Modal>
    );
  return null;
}

/** Lista de copias en conflicto (desde la barra de estado). */
export function CloudConflicts({ onClose }: { onClose: () => void }) {
  const t = useT();
  const conflicts = useSync((s) => s.conflicts);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn().catch((e) => useStore.getState().toast(String(e), "error"));
    setBusy(false);
  };
  return (
    <Modal title={t("sync.cloudTitle")} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{t("set.close")}</button>}>
      <div className="body">
        <p className="muted">{t("sync.cloudHint")}</p>
        {conflicts.length === 0 && <p>{t("sync.cloudNone")}</p>}
        {conflicts.map((c) => (
          <div key={c.file} className="sync-row">
            <div>
              <b>{c.file.split("/").pop()}</b>
              <small className="muted">
                {t("sync.copyOf")} {c.original.split("/").pop()}
              </small>
            </div>
            <button className="btn" disabled={busy} onClick={() => void run(() => resolveCloud(c, "variant"))}>
              <Copy size={14} /> {t("sync.asVariant")}
            </button>
            <button className="icon-btn danger" disabled={busy} title={t("sync.delete")} onClick={() => void run(() => resolveCloud(c, "delete"))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
