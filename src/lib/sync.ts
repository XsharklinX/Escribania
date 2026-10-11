/**
 * Sincronía por carpeta (Dropbox, OneDrive, Syncthing…), del lado de la interfaz:
 * - Al abrir, el candado avisa si el proyecto está abierto en otro equipo.
 * - Cada pocos segundos se miran las fechas de los archivos: si un texto
 *   cambia desde fuera y aquí no hay nada sin guardar, se recarga; si aquí
 *   también se estaba escribiendo, se pregunta qué hacer (conflicto).
 * - Las copias en conflicto que dejan los servicios en la nube se listan para
 *   decidir: guardarlas como variante del texto original o borrarlas.
 */
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useStore } from "../store";
import { api } from "./api";
import { ownWrites } from "./ownWrites";
import { dropPendingText, flushAll, hasPendingText, isManifestDirty } from "./saver";
import { locate, walk, SECTIONS } from "./tree";
import { normalizeManifest } from "./model";
import { countWords } from "./words";
import { tNow } from "./i18n";

export interface Lock {
  machine: string;
  user: string;
  pid: number;
  since: number;
  beat: number;
}

export interface CloudConflict {
  file: string;
  original: string;
}

/** Un texto cambiado fuera mientras aquí había cambios sin guardar. */
export interface TextConflict {
  file: string;
  id: string;
  title: string;
}

export const useSync = create<{ conflicts: CloudConflict[]; textConflict: TextConflict | null; manifestConflict: boolean; foreignLock: Lock | null }>(() => ({
  conflicts: [],
  textConflict: null,
  manifestConflict: false,
  foreignLock: null,
}));

const OWN_WINDOW = 8000;
let known: Record<string, number> = {};
let poll: ReturnType<typeof setInterval> | null = null;
let ticks = 0;

function nodeByFile(file: string) {
  const m = useStore.getState().project?.manifest;
  if (!m) return null;
  let found: { id: string; title: string } | null = null;
  for (const s of SECTIONS) walk(m.sections[s], (n) => void (n.file === file && (found = { id: n.id, title: n.title })));
  if (!found) {
    const e = m.codex.find((x) => x.file === file);
    if (e) found = { id: e.id, title: e.name };
  }
  return found as { id: string; title: string } | null;
}

/** ¿Está ese archivo a la vista (Hoja o Hoja partida)? */
function isShown(file: string): boolean {
  const st = useStore.getState();
  const m = st.project?.manifest;
  if (!m) return false;
  const ids = [st.selected, st.split?.kind !== "codex" ? st.split?.id : null].filter(Boolean) as string[];
  return ids.some((id) => locate(m, id)?.node.file === file);
}

async function check() {
  const p = useStore.getState().project;
  if (!p) return;
  const now = await invoke<Record<string, number>>("project_mtimes", { root: p.root }).catch(() => null);
  if (!now) return;
  const changed = Object.keys(now).filter((k) => known[k] !== undefined && known[k] !== now[k]);
  const added = Object.keys(now).filter((k) => known[k] === undefined);
  known = now;
  const recent = (key: string) => Date.now() - (ownWrites.get(key) ?? 0) < OWN_WINDOW;
  let reload = false;
  for (const file of changed) {
    if (!file.includes("/")) {
      if (recent("@manifest")) continue;
      if (isManifestDirty()) useSync.setState({ manifestConflict: true });
      else await reloadManifest();
      continue;
    }
    if (recent(file)) continue;
    const node = nodeByFile(file);
    if (!node) continue;
    if (hasPendingText(file)) {
      useSync.setState({ textConflict: { file, ...node } });
      continue;
    }
    const body = await api.textRead(p.root, file).catch(() => null);
    if (body !== null) useStore.getState().setWords(file, countWords(body));
    if (isShown(file)) reload = true;
  }
  if (reload) {
    useStore.setState({ reload: useStore.getState().reload + 1 });
    useStore.getState().toast(tNow("sync.updated"));
  }
  // Las copias en conflicto aparecen como archivos nuevos; se miran también de vez en cuando.
  if (added.length || ticks++ % 20 === 0) {
    const conflicts = await invoke<CloudConflict[]>("project_conflicts", { root: p.root }).catch(() => []);
    useSync.setState({ conflicts });
  }
  if (ticks % 40 === 0) {
    const other = await invoke<Lock | null>("lock_refresh", { root: p.root }).catch(() => null);
    if (other) useSync.setState({ foreignLock: other });
  }
}

export async function reloadManifest() {
  const p = useStore.getState().project;
  if (!p) return;
  const o = await api.projectOpen(p.path).catch(() => null);
  if (!o) return;
  useStore.setState({ project: { ...p, manifest: normalizeManifest(o.manifest) }, words: { ...useStore.getState().words, ...o.words }, reload: useStore.getState().reload + 1 });
  useSync.setState({ manifestConflict: false });
  useStore.getState().toast(tNow("sync.updated"));
}

/** Al abrir un proyecto. Devuelve el candado de otro equipo, si lo hay. */
export async function startSync(): Promise<Lock | null> {
  stopSync();
  const p = useStore.getState().project;
  if (!p) return null;
  known = await invoke<Record<string, number>>("project_mtimes", { root: p.root }).catch(() => ({}));
  ticks = 0;
  poll = setInterval(() => void check(), 3000);
  const other = await invoke<Lock | null>("lock_acquire", { root: p.root, force: false }).catch(() => null);
  const conflicts = await invoke<CloudConflict[]>("project_conflicts", { root: p.root }).catch(() => []);
  useSync.setState({ conflicts, foreignLock: other, textConflict: null, manifestConflict: false });
  return other;
}

export async function takeLock() {
  const p = useStore.getState().project;
  if (p) await invoke("lock_acquire", { root: p.root, force: true }).catch(() => {});
  useSync.setState({ foreignLock: null });
}

export function stopSync() {
  if (poll) clearInterval(poll);
  poll = null;
  const p = useStore.getState().project;
  if (p) void invoke("lock_release", { root: p.root }).catch(() => {});
}

/** Resolver un conflicto de texto. */
export async function resolveText(choice: "mine" | "theirs" | "both") {
  const c = useSync.getState().textConflict;
  const p = useStore.getState().project;
  if (!c || !p) return;
  useSync.setState({ textConflict: null });
  if (choice === "mine") {
    await flushAll(); // lo pendiente sobrescribe lo de fuera
    return;
  }
  if (choice === "both") {
    // Lo de fuera se guarda como variante del texto; aquí se sigue con lo propio.
    const theirs = await api.textRead(p.root, c.file);
    await flushAll();
    await addAsVariant(c.id, theirs, tNow("sync.otherMachine"));
    return;
  }
  dropPendingText(c.file);
  const body = await api.textRead(p.root, c.file);
  useStore.getState().setWords(c.file, countWords(body));
  useStore.setState({ reload: useStore.getState().reload + 1 });
}

/** Añade un texto como variante nueva de un nodo (sin cambiar la activa). */
export async function addAsVariant(id: string, body: string, name: string) {
  const { variantFile, nextVariantId } = await import("./variants");
  const st = useStore.getState();
  const p = st.project!;
  const n = locate(p.manifest, id)?.node;
  if (!n?.file) return;
  const list = n.variants?.length ? [...n.variants] : [{ id: "A", name: "A", file: variantFile(n.file, "A") }];
  if (!n.variants?.length) await api.textWrite(p.root, list[0].file, n.id, n.title, await api.textRead(p.root, n.file));
  const vid = nextVariantId(list);
  const file = variantFile(n.file, vid);
  await api.textWrite(p.root, file, n.id, n.title, body);
  st.editManifest((m) => {
    const x = locate(m, id)!.node;
    x.variants = [...list, { id: vid, name, file, words: countWords(body) }];
    x.variantActive = x.variantActive ?? "A";
  });
}

export async function resolveCloud(c: CloudConflict, choice: "variant" | "delete") {
  const p = useStore.getState().project!;
  if (choice === "variant") {
    const node = nodeByFile(c.original);
    if (node && locate(p.manifest, node.id)?.node.type === "text") await addAsVariant(node.id, await api.textRead(p.root, c.file), tNow("sync.cloudCopy"));
    else {
      useStore.getState().toast(tNow("sync.notScene"), "error");
      return;
    }
  }
  await api.textDelete(p.root, c.file);
  useSync.setState({ conflicts: useSync.getState().conflicts.filter((x) => x.file !== c.file) });
}
