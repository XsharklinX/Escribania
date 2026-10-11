import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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
import UpdateDialog from "./components/UpdateDialog";
import { applyOnCloseIfPending, initUpdater } from "./lib/updater";
import { broadcastManifest } from "./lib/panels";
import { openSample } from "./lib/sample";
import { stopSync } from "./lib/sync";
import { applyCustomTheme, initThemes, useThemes } from "./lib/themes";
import { startPlugins } from "./lib/plugins";

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
  const customThemes = useThemes((s) => s.themes);

  // Arranque: ajustes, datos de la app y proyecto abierto con doble clic.
  useEffect(() => {
    void (async () => {
      const [info, saved] = await Promise.all([api.appInfo().catch(() => null), api.settingsLoad().catch(() => null)]);
      const merged = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === "object" ? (saved as Partial<Settings>) : {}) };
      useStore.setState({ info, settings: merged, settingsLoaded: true });
      if (info?.startup_file) await openProject(info.startup_file);
      else if (info?.flags?.includes("--ejemplo")) await openSample().catch(() => false);
      if (info?.flags?.includes("--recorrido") && useStore.getState().project) useStore.setState({ tour: 0 });
      void initUpdater();
      void initThemes();
      void startPlugins();
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
    const custom = settings.theme.startsWith("custom:") ? customThemes.find((x) => `custom:${x.id}` === settings.theme) ?? null : null;
    r.dataset.theme = custom ? (custom.dark ? "tinta" : "algodon") : settings.theme.startsWith("custom:") ? "algodon" : settings.theme;
    applyCustomTheme(custom);
    r.lang = settings.lang;
    r.style.setProperty("--editor-font", settings.dyslexia ? '"OpenDyslexic", sans-serif' : FONTS[settings.font]);
    r.style.setProperty("--editor-size", `${settings.fontSize}px`);
    r.style.setProperty("--editor-lh", String(settings.lineHeight));
    r.style.setProperty("--line-width", `${settings.lineWidth}px`);
  }, [settings.theme, settings.lang, settings.font, settings.fontSize, settings.lineHeight, settings.lineWidth, settings.dyslexia, customThemes]);

  // Accesibilidad: letra para dislexia, alto contraste, menos movimiento y tamaño de la interfaz.
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.dyslexia = settings.dyslexia ? "on" : "";
    r.dataset.contrast = settings.contrast ? "high" : "";
    r.dataset.motion = settings.reduceMotion ? "reduce" : "";
  }, [settings.dyslexia, settings.contrast, settings.reduceMotion]);
  useEffect(() => {
    if (!loaded) return;
    void getCurrentWebview().setZoom(settings.uiScale || 1).catch(() => {});
  }, [settings.uiScale, loaded]);

  // Al cerrar la ventana: guardar todo y hacer copia antes de salir.
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async () => {
      if (useStore.getState().project) {
        await flushAll();
        await saveJournal();
        await backupNow();
      }
      stopSync();
      await applyOnCloseIfPending();
    });
    return () => void un.then((f) => f());
  }, []);

  // Paneles en otra ventana: se les avisa de cada cambio del proyecto.
  const manifest = useStore((s) => s.project?.manifest);
  useEffect(() => {
    if (manifest) broadcastManifest(manifest);
  }, [manifest]);

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
      <UpdateDialog />
    </>
  );
}
