import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { documentDir, join } from "@tauri-apps/api/path";
import { FilePlus2, FolderOpen, Import, BookOpenText, Compass, Lightbulb, Usb, X } from "lucide-react";
import logo from "../assets/logo.png";
import { openSample } from "../lib/sample";
import { useStore } from "../store";
import { useT, type TKey } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { openProject } from "../lib/projects";
import { buildProject, TEMPLATES, type TemplateId } from "../lib/templates";
import Modal from "./Modal";
import Notebook from "./Notebook";
import ImportDialog from "./ImportDialog";

export default function Welcome() {
  const t = useT();
  const info = useStore((s) => s.info);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [creating, setCreating] = useState(false);
  const dialog = useStore((s) => s.dialog);

  const pick = async () => {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "Escribanía", extensions: ["escribania"] }] });
    if (typeof path === "string") await openProject(path);
  };

  const dateFmt = new Intl.DateTimeFormat(settings.lang === "es" ? "es-ES" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="welcome">
      <aside className="welcome-side">
        <div className="brand">
          <img src={logo} alt="" />
          <div>
            <h1>Escribanía</h1>
            <p>{t("app.tagline")}</p>
          </div>
        </div>
        <div className="welcome-actions">
          <button className="btn primary big" onClick={() => setCreating(true)}>
            <FilePlus2 size={18} /> {t("welcome.new")}
          </button>
          <button className="btn big" onClick={() => void pick()}>
            <FolderOpen size={18} /> {t("welcome.open")}
          </button>
          <button className="btn big" onClick={() => useStore.setState({ dialog: "import" })}>
            <Import size={18} /> {t("imp.title")}
          </button>
          <button className="btn big" onClick={() => useStore.setState({ dialog: "capture" })}>
            <Lightbulb size={18} /> {t("nb.title")}
          </button>
          <button className="btn big" onClick={() => void openSample()}>
            <BookOpenText size={18} /> {t("welcome.sample")}
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              if (await openSample()) useStore.setState({ tour: 0 });
            }}
          >
            <Compass size={16} /> {t("welcome.tour")}
          </button>
        </div>
        <div className="welcome-foot">
          {info?.portable && (
            <span className="badge">
              <Usb size={12} /> {t("app.portable")}
            </span>
          )}
          <span>{t("welcome.free")}</span>
          <span>v{info?.version ?? "0.1.0"}</span>
        </div>
      </aside>
      <main className="welcome-main">
        <h2 className="k">{t("welcome.recent")}</h2>
        {settings.recent.length === 0 ? (
          <p className="empty-note">{t("welcome.noRecent")}</p>
        ) : (
          <div className="recent">
            {settings.recent.map((r) => (
              <div key={r.path} className="recent-item" role="button" tabIndex={0} onClick={() => void openProject(r.path)} onKeyDown={(e) => e.key === "Enter" && void openProject(r.path)}>
                <span className="ico" />
                <span style={{ minWidth: 0 }}>
                  <b>{r.title}</b>
                  <small>{r.path}</small>
                  <small>{dateFmt.format(new Date(r.opened))}</small>
                </span>
                <button
                  className="icon-btn x"
                  title={t("welcome.remove")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSettings({ recent: settings.recent.filter((x) => x.path !== r.path) });
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
      {creating && <NewProject onClose={() => setCreating(false)} />}
      {dialog === "capture" && <Notebook />}
      {dialog === "import" && <ImportDialog onClose={() => useStore.setState({ dialog: null })} />}
    </div>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const t = useT();
  const info = useStore((s) => s.info);
  const lang = useStore((s) => s.settings.lang);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [dir, setDir] = useState("");
  const [tpl, setTpl] = useState<TemplateId>("novel");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        // Portable: los proyectos van junto al programa (Datos/Proyectos), para llevarlos en el USB.
        setDir(info?.portable ? await join(info.data_dir, "Proyectos") : await join(await documentDir(), "Escribanía"));
      } catch {
        /* el usuario elegirá la carpeta */
      }
    })();
  }, [info]);

  const choose = async () => {
    const d = await open({ directory: true, multiple: false, defaultPath: dir || undefined });
    if (typeof d === "string") setDir(d);
  };

  const create = async () => {
    if (!title.trim()) return setError(t("new.needName"));
    if (!dir) return setError(t("new.needDir"));
    setBusy(true);
    setError("");
    try {
      const { manifest, texts } = buildProject(tpl, lang, title.trim(), author.trim());
      const path = await api.projectCreate(dir, title.trim(), manifest, texts);
      if (await openProject(path)) onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("new.title")}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("new.cancel")}
          </button>
          <button className="btn primary" onClick={() => void create()} disabled={busy}>
            {t("new.create")}
          </button>
        </>
      }
    >
      <div className="body">
        <div className="grid2">
          <label className="field">
            <span>{t("new.name")}</span>
            <input id="np-title" className="input" autoFocus value={title} placeholder={t("new.namePh")} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
          </label>
          <label className="field">
            <span>{t("new.author")}</span>
            <input id="np-author" className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span>{t("new.template")}</span>
          <div className="choice-grid">
            {TEMPLATES.map((id) => (
              <button key={id} className={`choice ${tpl === id ? "on" : ""}`} onClick={() => setTpl(id)}>
                <b>{t(`tpl.${id}` as TKey)}</b>
                <small>{t(`tpl.${id}.d` as TKey)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{t("new.location")}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="path" style={{ flex: 1 }}>
              {dir}
              {title.trim() ? (dir.includes("\\") ? "\\" : "/") + title.trim() : ""}
            </div>
            <button className="btn" onClick={() => void choose()}>
              {t("new.choose")}
            </button>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}
