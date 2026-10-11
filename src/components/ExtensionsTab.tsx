import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Palette, Plus, Puzzle, Trash2, Upload } from "lucide-react";
import { useStore } from "../store";
import { useT, type TKey } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { slugify } from "../lib/ids";
import { currentColors, parseThemeFile, saveThemes, themeFile, THEME_VARS, useThemes, type CustomTheme } from "../lib/themes";
import { GALLERY, loadPlugins, makePlugin, parseHeader, savePlugins, usePlugins, type Plugin } from "../lib/plugins";
import { newId } from "../lib/ids";

/** Ajustes › Extensiones: temas propios y extensiones (con una galería de ejemplo). */
export default function ExtensionsTab() {
  return (
    <>
      <ThemesSection />
      <PluginsSection />
    </>
  );
}

function ThemesSection() {
  const t = useT();
  const themes = useThemes((s) => s.themes);
  const theme = useStore((s) => s.settings.theme);
  const set = useStore((s) => s.setSettings);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState<CustomTheme | null>(null);
  const store = async (list: CustomTheme[]) => {
    useThemes.setState({ themes: list });
    await saveThemes(list).catch((e) => toast(errorText(e), "error"));
  };
  return (
    <div className="field">
      <span>
        <Palette size={13} /> {t("ext.themes")}
      </span>
      <div className="choice-grid">
        {themes.map((th) => (
          <button key={th.id} className={`choice ${theme === `custom:${th.id}` ? "on" : ""}`} onClick={() => set({ theme: `custom:${th.id}` })} onDoubleClick={() => setEditing(th)}>
            <span className="theme-swatch">
              {(["bg", "paper", "acc", "text"] as const).map((k) => (
                <i key={k} style={{ background: th.colors[k] }} />
              ))}
            </span>
            <b>{th.name}</b>
          </button>
        ))}
      </div>
      <div className="row-wrap">
        <button className="btn" onClick={() => setEditing({ id: newId(), name: t("ext.newTheme"), dark: document.documentElement.style.colorScheme === "dark" || ["tinta", "pizarra"].includes(document.documentElement.dataset.theme ?? ""), colors: currentColors() })}>
          <Plus size={14} /> {t("ext.createTheme")}
        </button>
        <button
          className="btn"
          onClick={async () => {
            const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
            if (typeof path !== "string") return;
            try {
              const th = parseThemeFile(await api.fileReadText(path));
              await store([...themes, th]);
              set({ theme: `custom:${th.id}` });
            } catch {
              toast(t("ext.badTheme"), "error");
            }
          }}
        >
          <Upload size={14} /> {t("ext.importTheme")}
        </button>
      </div>
      <small className="muted">{t("ext.themesHint")}</small>
      {editing && (
        <div className="theme-editor">
          <div className="row-wrap">
            <input className="input" style={{ maxWidth: 220 }} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <label className="check">
              <input type="checkbox" checked={editing.dark} onChange={(e) => setEditing({ ...editing, dark: e.target.checked })} /> {t("ext.dark")}
            </label>
          </div>
          <div className="theme-colors">
            {THEME_VARS.map((v) => (
              <label key={v}>
                <input type="color" value={editing.colors[v]} onChange={(e) => setEditing({ ...editing, colors: { ...editing.colors, [v]: e.target.value } })} />
                {t(`ext.var.${v}` as TKey)}
              </label>
            ))}
          </div>
          <div className="row-wrap">
            <button
              className="btn primary"
              onClick={async () => {
                await store([...themes.filter((x) => x.id !== editing.id), editing]);
                set({ theme: `custom:${editing.id}` });
                setEditing(null);
              }}
            >
              {t("cal.save")}
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
            <span className="spacer" />
            {themes.some((x) => x.id === editing.id) && (
              <>
                <button
                  className="icon-btn"
                  title={t("ext.exportTheme")}
                  onClick={async () => {
                    const path = await save({ defaultPath: `${slugify(editing.name) || "tema"}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
                    if (path) await api.fileWriteText(path, themeFile(editing)).then(() => toast(t("exp.done")));
                  }}
                >
                  <Download size={15} />
                </button>
                <button
                  className="icon-btn danger"
                  title={t("ext.deleteTheme")}
                  onClick={async () => {
                    await store(themes.filter((x) => x.id !== editing.id));
                    if (theme === `custom:${editing.id}`) set({ theme: "algodon" });
                    setEditing(null);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PluginsSection() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const running = usePlugins((s) => s.running);
  const errors = usePlugins((s) => s.errors);
  const [list, setList] = useState<Plugin[]>([]);
  useEffect(() => void loadPlugins().then(setList), []);
  const store = async (next: Plugin[]) => {
    setList(next);
    await savePlugins(next).catch((e) => toast(errorText(e), "error"));
  };
  const installed = new Set(list.map((p) => p.name));
  return (
    <div className="field">
      <span>
        <Puzzle size={13} /> {t("ext.plugins")}
      </span>
      <small className="muted">{t("ext.pluginsHint")}</small>
      {list.length === 0 && <p className="muted">{t("ext.none")}</p>}
      {list.map((p) => {
        const r = running.find((x) => x.plugin.id === p.id);
        return (
          <div key={p.id} className="plugin-row">
            <label className="check">
              <input type="checkbox" checked={p.enabled} onChange={(e) => void store(list.map((x) => (x.id === p.id ? { ...x, enabled: e.target.checked } : x)))} />
            </label>
            <div>
              <b>{p.name}</b> <small className="muted">v{p.version}{p.author ? ` · ${p.author}` : ""}</small>
              <small className="muted">{p.description}</small>
              {errors[p.id] && <small className="error-text">{errors[p.id]}</small>}
              {r && <small className="ok-line">{t("ext.commands", { n: r.commands.length })}: {r.commands.join(" · ")}</small>}
            </div>
            <button className="icon-btn danger" title={t("ext.remove")} onClick={() => void store(list.filter((x) => x.id !== p.id))}>
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      <div className="row-wrap">
        <button
          className="btn"
          onClick={async () => {
            const path = await open({ multiple: false, filters: [{ name: "JavaScript", extensions: ["js"] }] });
            if (typeof path !== "string") return;
            try {
              await store([...list, makePlugin(await api.fileReadText(path))]);
            } catch (e) {
              toast(errorText(e), "error");
            }
          }}
        >
          <Upload size={14} /> {t("ext.installFile")}
        </button>
      </div>
      <div className="gallery">
        <b>{t("ext.gallery")}</b>
        {GALLERY.map((code) => {
          const h = parseHeader(code);
          return (
            <div key={h.name} className="plugin-row">
              <div>
                <b>{h.name}</b>
                <small className="muted">{h.description}</small>
              </div>
              <button className="btn" disabled={installed.has(h.name)} onClick={() => void store([...list, makePlugin(code)])}>
                {installed.has(h.name) ? t("ext.installed") : t("ext.install")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
