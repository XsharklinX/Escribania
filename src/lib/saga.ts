/**
 * Series y sagas: las fichas del Códice marcadas como compartidas viven en un
 * archivo `<Saga>.saga.json` común a varios libros. Al abrir un libro se traen
 * de la saga (así, cambiar un personaje en un libro lo cambia en todos) y al
 * guardar se devuelven. Cada libro guarda una copia, por si la saga no está.
 */
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import type { CodexEntry, Manifest, Relation } from "../types";
import { api } from "./api";
import { slugify } from "./ids";

export interface SagaEntry extends Omit<CodexEntry, "file" | "image" | "pos"> {
  desc: string;
}

export interface SagaFile {
  app: "escribania-saga";
  version: 1;
  name: string;
  books: { id: string; title: string }[];
  codex: SagaEntry[];
  relations: Relation[];
  updated: string;
}

const sagaApi = {
  read: (root: string, rel: string) => invoke<SagaFile>("saga_read", { root, rel }),
  write: (root: string, rel: string, saga: SagaFile) => invoke<void>("saga_write", { root, rel, saga }),
  relative: (root: string, path: string) => invoke<string>("saga_relative", { root, path }),
};

export function emptySaga(name: string): SagaFile {
  return { app: "escribania-saga", version: 1, name, books: [], codex: [], relations: [], updated: new Date().toISOString() };
}

/** Mezcla la saga en el manifiesto (sobre una copia). Devuelve las descripciones a escribir. */
export function mergeSaga(m: Manifest, saga: SagaFile): { file: string; id: string; name: string; desc: string }[] {
  const writes: { file: string; id: string; name: string; desc: string }[] = [];
  for (const s of saga.codex) {
    const { desc, ...data } = s;
    const local = m.codex.find((e) => e.id === s.id);
    if (local) {
      Object.assign(local, data, { shared: true });
      writes.push({ file: local.file, id: local.id, name: local.name, desc });
    } else {
      const file = `codice/${slugify(s.name) || "ficha"}-${s.id.slice(0, 4)}.md`;
      m.codex.push({ ...data, file, shared: true });
      writes.push({ file, id: s.id, name: s.name, desc });
    }
  }
  const shared = new Set(saga.codex.map((e) => e.id));
  m.relations = [...m.relations.filter((r) => !(shared.has(r.from) && shared.has(r.to))), ...saga.relations];
  return writes;
}

/** Al abrir el libro: trae las fichas de la saga. */
export async function pullSaga(): Promise<void> {
  const p = useStore.getState().project;
  if (!p?.manifest.saga) return;
  let saga: SagaFile;
  try {
    saga = await sagaApi.read(p.root, p.manifest.saga);
  } catch (e) {
    useStore.getState().toast(String(e), "error");
    return;
  }
  const copy = structuredClone(p.manifest);
  const writes = mergeSaga(copy, saga);
  for (const w of writes) {
    const cur = await api.textRead(p.root, w.file).catch(() => "");
    if (cur.trim() !== w.desc.trim()) await api.textWrite(p.root, w.file, w.id, w.name, w.desc);
  }
  useStore.getState().editManifest((m) => {
    m.codex = copy.codex;
    m.relations = copy.relations;
  });
  if (!saga.books.some((b) => b.id === p.manifest.id)) schedulePush();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSig = "";

/** Devuelve las fichas compartidas a la saga (con un pequeño retraso para agrupar cambios). */
export function schedulePush(force = false) {
  if (force) lastSig = "";
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void pushSaga(), 1500);
}

export async function pushSaga(): Promise<void> {
  const p = useStore.getState().project;
  if (!p?.manifest.saga) return;
  const m = p.manifest;
  const shared = m.codex.filter((e) => e.shared);
  const codex: SagaEntry[] = [];
  for (const e of shared) {
    const { file, image: _image, pos: _pos, ...data } = e;
    codex.push({ ...data, desc: await api.textRead(p.root, file).catch(() => "") });
  }
  const ids = new Set(shared.map((e) => e.id));
  const relations = m.relations.filter((r) => ids.has(r.from) && ids.has(r.to));
  const sig = JSON.stringify([codex, relations, m.title]);
  if (sig === lastSig) return;
  let saga: SagaFile;
  try {
    saga = await sagaApi.read(p.root, m.saga!);
  } catch {
    saga = emptySaga(m.title);
  }
  // Las fichas que este libro no tiene marcadas como compartidas pero sí otros libros se respetan.
  const others = saga.codex.filter((x) => !ids.has(x.id) && !m.codex.some((e) => e.id === x.id));
  saga.codex = [...others, ...codex];
  const otherRels = saga.relations.filter((r) => !(ids.has(r.from) || ids.has(r.to)));
  saga.relations = [...otherRels, ...relations];
  saga.books = [...saga.books.filter((b) => b.id !== m.id), { id: m.id, title: m.title }];
  saga.updated = new Date().toISOString();
  await sagaApi.write(p.root, m.saga!, saga).then(
    () => void (lastSig = sig),
    (e) => useStore.getState().toast(String(e), "error"),
  );
}

/** Crea una saga nueva en `path` (…/Nombre.saga.json) con este libro. */
export async function createSaga(path: string, name: string) {
  const p = useStore.getState().project!;
  const rel = await sagaApi.relative(p.root, path);
  const saga = emptySaga(name);
  saga.books = [{ id: p.manifest.id, title: p.manifest.title }];
  await sagaApi.write(p.root, rel, saga);
  useStore.getState().editManifest((m) => void (m.saga = rel));
  schedulePush(true);
}

export async function joinSaga(path: string) {
  const p = useStore.getState().project!;
  const rel = await sagaApi.relative(p.root, path);
  await sagaApi.read(p.root, rel);
  useStore.getState().editManifest((m) => void (m.saga = rel));
  await pullSaga();
}

export function leaveSaga() {
  useStore.getState().editManifest((m) => {
    delete m.saga;
    for (const e of m.codex) delete e.shared;
  });
}

export async function sagaInfo(): Promise<SagaFile | null> {
  const p = useStore.getState().project;
  if (!p?.manifest.saga) return null;
  return sagaApi.read(p.root, p.manifest.saga).catch(() => null);
}
