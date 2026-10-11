import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { documentDir, join } from "@tauri-apps/api/path";
import { useStore } from "../store";
import { useT, type TKey } from "../lib/i18n";
import { api, errorText, type ImportKind } from "../lib/api";
import { applyImport } from "../lib/importer";
import { buildProject } from "../lib/templates";
import { openProject } from "../lib/projects";
import Modal from "./Modal";

const KINDS: { id: ImportKind; ext?: string[]; dir?: boolean }[] = [
  { id: "scrivener", ext: ["scrivx"] },
  { id: "manuskript", ext: ["msk"] },
  { id: "docx", ext: ["docx"] },
  { id: "markdown", dir: true },
];

const NAMES: Record<ImportKind, string> = { scrivener: "Scrivener", manuskript: "Manuskript", docx: "Word", markdown: "Markdown" };

/** Puentes: importar desde otros programas. Sin proyecto abierto crea uno nuevo. */
export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useStore((s) => s.project);
  const info = useStore((s) => s.info);
  const lang = useStore((s) => s.settings.lang);
  const [kind, setKind] = useState<ImportKind>("scrivener");
  const [source, setSource] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (project) return;
    void (async () => {
      try {
        setDir(info?.portable ? await join(info.data_dir, "Proyectos") : await join(await documentDir(), "Escribanía"));
      } catch {
        /* se elegirá */
      }
    })();
  }, [project, info]);

  const k = KINDS.find((x) => x.id === kind)!;
  const pick = async (folder: boolean) => {
    const r = await open({ multiple: false, directory: folder, filters: folder ? undefined : [{ name: NAMES[kind], extensions: k.ext ?? [] }] });
    if (typeof r === "string") setSource(r);
  };

  const run = async () => {
    if (!source) return setError(t("imp.pickSource"));
    setBusy(true);
    setError("");
    try {
      const imp = await api.importProject(kind, source);
      if (!useStore.getState().project) {
        if (!dir) throw new Error(t("new.needDir"));
        const title = imp.title || NAMES[kind];
        const { manifest, texts } = buildProject("blank", lang, title, imp.author);
        manifest.sections.manuscript = [];
        const keep = texts.filter((x) => x.file.includes("ideas") || manifest.sections.notes.some((n) => n.file === x.file));
        const path = await api.projectCreate(dir, title, manifest, keep);
        if (!(await openProject(path))) return;
        const r = await applyImport(imp, NAMES[kind], true);
        useStore.getState().toast(t("imp.done", { n: r.texts }) + (r.warnings.length ? ` ${t("imp.warnings", { n: r.warnings.length })}` : ""));
      } else {
        const r = await applyImport(imp, NAMES[kind], false);
        useStore.getState().toast(t("imp.done", { n: r.texts }) + (r.warnings.length ? ` ${t("imp.warnings", { n: r.warnings.length })}` : ""));
      }
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("imp.title")}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn primary" disabled={busy || !source} onClick={() => void run()}>
            {busy ? t("imp.working") : t("imp.go")}
          </button>
        </>
      }
    >
      <div className="body">
        <div className="choice-grid">
          {KINDS.map((x) => (
            <button
              key={x.id}
              className={`choice ${kind === x.id ? "on" : ""}`}
              onClick={() => {
                setKind(x.id);
                setSource("");
              }}
            >
              <b>{NAMES[x.id]}</b>
              <small>{t(`imp.${x.id}` as TKey)}</small>
            </button>
          ))}
        </div>
        <div className="field">
          <span>{t("imp.source")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="path" style={{ flex: 1 }}>
              {source || "—"}
            </div>
            {!k.dir && (
              <button className="btn" onClick={() => void pick(false)}>
                {t("imp.file")}
              </button>
            )}
            {(k.dir || kind === "manuskript" || kind === "scrivener") && (
              <button className="btn" onClick={() => void pick(true)}>
                {t("imp.folderPick")}
              </button>
            )}
          </div>
        </div>
        {!project && (
          <div className="field">
            <span>{t("new.location")}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <div className="path" style={{ flex: 1 }}>
                {dir}
              </div>
              <button
                className="btn"
                onClick={async () => {
                  const d = await open({ directory: true, multiple: false, defaultPath: dir || undefined });
                  if (typeof d === "string") setDir(d);
                }}
              >
                {t("new.choose")}
              </button>
            </div>
          </div>
        )}
        <p className="muted">{project ? t("imp.intoProject") : t("imp.newProject")}</p>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}
