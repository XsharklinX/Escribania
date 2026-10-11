import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useStore } from "../store";
import type { ReleaseNotes } from "../types";

export interface UpdateStatus {
  version: string;
  configured: boolean;
  canApply: boolean;
  previous: string | null;
  releasesUrl: string;
}

export interface Release {
  version: string;
  date: string;
  notes: Record<string, ReleaseNotes>;
  asset: { url: string; size: number; sha256: string; signature: string } | null;
}

type Phase = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";

interface UpdateState {
  status: UpdateStatus | null;
  phase: Phase;
  release: Release | null;
  path: string | null;
  progress: { done: number; total: number };
  error: string;
  /** Ventana «Fe de erratas»: con la edición nueva o con la recién instalada. */
  dialog: null | "offer" | "done";
  applyOnClose: boolean;
}

export const useUpdate = create<UpdateState>(() => ({
  status: null,
  phase: "idle",
  release: null,
  path: null,
  progress: { done: 0, total: 0 },
  error: "",
  dialog: null,
  applyOnClose: false,
}));

const DAY = 24 * 60 * 60 * 1000;

/** Escribiendo a fondo (Retiro o sprint): solo el aviso discreto, sin ventanas. */
function busy() {
  const s = useStore.getState();
  return s.retiro || !!s.sprint;
}

export async function initUpdater() {
  const status = await invoke<UpdateStatus>("update_status").catch(() => null);
  useUpdate.setState({ status });
  // La interfaz se ha visto: esta versión se queda (si no, el próximo arranque vuelve a la anterior).
  void invoke("update_confirm_start").catch(() => {});
  const st = useStore.getState();
  const notes = st.settings.updateNotes;
  if (status && notes && notes.version === status.version) useUpdate.setState({ dialog: "done" });
  else if (notes) st.setSettings({ updateNotes: null });
  if (!status?.configured || st.settings.updates === "off") return;
  const last = Date.parse(st.settings.updateChecked || "");
  if (!Number.isFinite(last) || Date.now() - last > DAY) void checkForUpdate(false);
}

export async function checkForUpdate(manual: boolean): Promise<Release | null> {
  const st = useStore.getState();
  useUpdate.setState({ phase: "checking", error: "" });
  try {
    const release = await invoke<Release | null>("update_check", { channel: st.settings.updates === "beta" ? "beta" : "stable" });
    useStore.getState().setSettings({ updateChecked: new Date().toISOString() });
    if (!release) {
      useUpdate.setState({ phase: "none", release: null });
      return null;
    }
    useUpdate.setState({ phase: "available", release });
    const canApply = useUpdate.getState().status?.canApply && release.asset;
    if (canApply) void download(release, manual);
    else if (manual || !busy()) useUpdate.setState({ dialog: "offer" });
    return release;
  } catch (e) {
    useUpdate.setState({ phase: "error", error: String(e) });
    return null;
  }
}

async function download(release: Release, open: boolean) {
  useUpdate.setState({ phase: "downloading", progress: { done: 0, total: release.asset?.size ?? 0 } });
  if (open) useUpdate.setState({ dialog: "offer" });
  const un = await listen<{ done: number; total: number }>("update-progress", (e) => useUpdate.setState({ progress: e.payload }));
  try {
    const path = await invoke<string>("update_download", { release });
    useUpdate.setState({ phase: "ready", path });
    if (!busy()) useUpdate.setState({ dialog: "offer" });
  } catch (e) {
    useUpdate.setState({ phase: "error", error: String(e) });
  } finally {
    un();
  }
}

/** Antes de cambiar el ejecutable: las notas, para enseñarlas al arrancar la nueva. */
function rememberNotes() {
  const r = useUpdate.getState().release;
  if (r) useStore.getState().setSettings({ updateNotes: { version: r.version, notes: r.notes } });
}

export async function applyUpdate(relaunchNow: boolean) {
  const { path, release } = useUpdate.getState();
  if (!path || !release) return;
  rememberNotes();
  // Los ajustes se guardan con retraso: aquí hace falta ya.
  await invoke("settings_save", { settings: useStore.getState().settings }).catch(() => {});
  await invoke("update_apply", { path, version: release.version, relaunchNow });
}

/** Lo llama el cierre de la ventana si se eligió «Al cerrar». */
export async function applyOnCloseIfPending() {
  if (useUpdate.getState().applyOnClose && useUpdate.getState().phase === "ready") await applyUpdate(false).catch(() => {});
}

export async function rollback() {
  await invoke("update_rollback");
}

export function formatSize(bytes: number) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.round(bytes / 1024)} KB`;
}
