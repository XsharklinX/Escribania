import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DEFAULT_SETTINGS, useStore } from "./store";
import type { Settings } from "./types";
import { api } from "./lib/api";
import { backupNow, flushAll } from "./lib/saver";
import { openProject } from "./lib/projects";
import { saveJournal } from "./lib/journal";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import Welcome from "./components/Welcome";
import Workspace from "./components/Workspace";
import Toasts from "./components/Toasts";

const FONTS: Record<Settings["font"], string> = {
  literata: '"Literata", Georgia, serif',
  "source-serif": '"Source Serif 4", Georgia, serif',
  "courier-prime": '"Courier Prime", "Courier New", monospace',
  system: 'Georgia, "Times New Roman", serif',
};

export default function App() {
  const project = useStore((s) => s.project);
  const settings = useStore((s) => s.settings);
  const loaded = useStore((s) => s.settingsLoaded);

  // Arranque: ajustes, datos de la app y proyecto abierto con doble clic.
  useEffect(() => {
    void (async () => {
      const [info, saved] = await Promise.all([api.appInfo().catch(() => null), api.settingsLoad().catch(() => null)]);
      const merged = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === "object" ? (saved as Partial<Settings>) : {}) };
      useStore.setState({ info, settings: merged, settingsLoaded: true });
      if (info?.startup_file) await openProject(info.startup_file);
    })();
  }, []);

  // Guardar ajustes cuando cambian.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => void api.settingsSave(settings).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [settings, loaded]);

  // Tema, tipografía y medidas de la hoja.
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = settings.theme;
    r.lang = settings.lang;
    r.style.setProperty("--editor-font", FONTS[settings.font]);
    r.style.setProperty("--editor-size", `${settings.fontSize}px`);
    r.style.setProperty("--editor-lh", String(settings.lineHeight));
    r.style.setProperty("--line-width", `${settings.lineWidth}px`);
  }, [settings.theme, settings.lang, settings.font, settings.fontSize, settings.lineHeight, settings.lineWidth]);

  // Al cerrar la ventana: guardar todo y hacer copia antes de salir.
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async () => {
      if (useStore.getState().project) {
        await flushAll();
        await saveJournal();
        await backupNow();
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // Cuaderno de ideas: atajo global para apuntar algo aunque la ventana esté minimizada.
  const quick = settings.quickCapture;
  useEffect(() => {
    if (!loaded || !quick) return;
    const combo = "CommandOrControl+Alt+I";
    void register(combo, async (ev) => {
      if (ev.state !== "Pressed") return;
      const w = getCurrentWindow();
      await w.unminimize().catch(() => {});
      await w.show().catch(() => {});
      await w.setFocus().catch(() => {});
      useStore.setState({ dialog: "capture" });
    }).catch(() => {});
    return () => void unregister(combo).catch(() => {});
  }, [loaded, quick]);

  if (!loaded) return null;
  return (
    <>
      {project ? <Workspace /> : <Welcome />}
      <Toasts />
    </>
  );
}
