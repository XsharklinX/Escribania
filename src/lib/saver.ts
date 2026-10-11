/**
 * Salvavidas: guardado automático.
 *
 * - Textos: se guardan 1 s después de dejar de teclear, al cambiar de texto y al cerrar.
 * - Proyecto (.escribania): 0,6 s después de cualquier cambio en el árbol.
 * - Copias .zip: al abrir, cada `backupMinutes` si hubo cambios, y al cerrar.
 */
import { useStore } from "../store";
import { api, errorText } from "./api";
import { tNow } from "./i18n";

interface PendingText {
  root: string;
  file: string;
  id: string;
  title: string;
  body: string;
}

const pendingTexts = new Map<string, PendingText>();
let textTimer: ReturnType<typeof setTimeout> | null = null;
let manifestTimer: ReturnType<typeof setTimeout> | null = null;
let manifestDirty = false;
let inFlight: Promise<void> = Promise.resolve();
let changedSinceBackup = false;
let backupTimer: ReturnType<typeof setInterval> | null = null;

function setState(s: "saved" | "pending" | "saving" | "error") {
  if (useStore.getState().saveState !== s) useStore.setState({ saveState: s });
}

function refreshState() {
  setState(pendingTexts.size || manifestDirty ? "pending" : "saved");
}

export function queueText(t: PendingText) {
  pendingTexts.set(t.file, t);
  changedSinceBackup = true;
  setState("pending");
  if (textTimer) clearTimeout(textTimer);
  textTimer = setTimeout(() => void flushTexts(), 1000);
}

export function queueManifest() {
  manifestDirty = true;
  changedSinceBackup = true;
  setState("pending");
  if (manifestTimer) clearTimeout(manifestTimer);
  manifestTimer = setTimeout(() => void flushManifest(), 600);
}

async function run(job: () => Promise<void>) {
  // Las escrituras van en fila: nunca dos a la vez sobre el mismo archivo.
  inFlight = inFlight.then(job, job);
  return inFlight;
}

export function flushTexts(): Promise<void> {
  if (textTimer) clearTimeout(textTimer);
  textTimer = null;
  const batch = [...pendingTexts.values()];
  pendingTexts.clear();
  if (!batch.length) return inFlight;
  return run(async () => {
    setState("saving");
    for (const t of batch) {
      try {
        await api.textWrite(t.root, t.file, t.id, t.title, t.body);
      } catch (e) {
        // Se vuelve a poner en cola para no perder el texto.
        if (!pendingTexts.has(t.file)) pendingTexts.set(t.file, t);
        useStore.getState().toast(`${tNow("toast.saveError")}: ${errorText(e)}`, "error");
        setState("error");
        return;
      }
    }
    refreshState();
  });
}

export function flushManifest(): Promise<void> {
  if (manifestTimer) clearTimeout(manifestTimer);
  manifestTimer = null;
  if (!manifestDirty) return inFlight;
  manifestDirty = false;
  return run(async () => {
    const p = useStore.getState().project;
    if (!p) return;
    setState("saving");
    try {
      await api.projectSave(p.path, p.manifest);
      refreshState();
    } catch (e) {
      manifestDirty = true;
      useStore.getState().toast(`${tNow("toast.saveError")}: ${errorText(e)}`, "error");
      setState("error");
    }
  });
}

export async function flushAll() {
  await flushTexts();
  await flushManifest();
  await inFlight;
}

export async function backupNow(force = false): Promise<string | null> {
  const { project, settings } = useStore.getState();
  if (!project || (!force && !changedSinceBackup)) return null;
  await flushAll();
  try {
    const path = await api.projectBackup(project.root, settings.backupKeep);
    changedSinceBackup = false;
    return path;
  } catch (e) {
    useStore.getState().toast(errorText(e), "error");
    return null;
  }
}

export function startBackups() {
  stopBackups();
  const minutes = Math.max(1, useStore.getState().settings.backupMinutes);
  backupTimer = setInterval(() => void backupNow(), minutes * 60_000);
}

export function stopBackups() {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = null;
}

// Cada cambio del manifiesto en el store programa su guardado.
useStore.subscribe((s, prev) => {
  if (s.project && prev.project && s.project.path === prev.project.path && s.project.manifest !== prev.project.manifest) {
    queueManifest();
  }
});
