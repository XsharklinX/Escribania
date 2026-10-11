/**
 * Variantes de una escena: dos o más versiones del mismo texto. La que entra en
 * el libro es la activa y vive siempre en el archivo del texto, así que
 * compilar, buscar o contar palabras no cambia. Las demás se guardan en
 * `texto/variantes/`. Cambiar de variante guarda la activa en su archivo y
 * trae la elegida al del texto.
 */
import { useStore } from "../store";
import type { TreeNode, Variant } from "../types";
import { api } from "./api";
import { flushTexts } from "./saver";
import { countWords } from "./words";
import { locate } from "./tree";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function variantFile(file: string, id: string): string {
  const stem = file.replace(/^texto\//, "").replace(/\.md$/, "");
  return `texto/variantes/${stem}~${id.toLowerCase()}.md`;
}

/** Siguiente letra libre. */
export function nextVariantId(list: Variant[]): string {
  for (const l of LETTERS) if (!list.some((v) => v.id === l)) return l;
  return String(list.length + 1);
}

function node(id: string): TreeNode | undefined {
  const p = useStore.getState().project;
  return p ? locate(p.manifest, id)?.node : undefined;
}

/** Crea una variante nueva copiando la activa y pasa a escribir en ella. */
export async function createVariant(id: string): Promise<void> {
  const st = useStore.getState();
  const p = st.project;
  const n = node(id);
  if (!p || !n?.file) return;
  await flushTexts();
  const body = await api.textRead(p.root, n.file);
  const list = n.variants?.length ? [...n.variants] : [{ id: "A", name: "A", file: variantFile(n.file, "A") }];
  const active = n.variantActive ?? list[0].id;
  const fresh: Variant = { id: nextVariantId(list), name: "", file: "" };
  fresh.name = fresh.id;
  fresh.file = variantFile(n.file, fresh.id);
  const words = countWords(body);
  // La activa se guarda tal cual; la nueva empieza siendo una copia.
  await api.textWrite(p.root, list.find((v) => v.id === active)!.file, n.id, n.title, body);
  await api.textWrite(p.root, fresh.file, n.id, n.title, body);
  st.editManifest((m) => {
    const x = locate(m, id)!.node;
    x.variants = [...list.map((v) => (v.id === active ? { ...v, words } : v)), { ...fresh, words }];
    x.variantActive = fresh.id;
  });
}

/** Pasa a la variante `to`: la actual se guarda en su archivo y `to` ocupa el del texto. */
export async function switchVariant(id: string, to: string): Promise<void> {
  const st = useStore.getState();
  const p = st.project;
  const n = node(id);
  if (!p || !n?.file || !n.variants?.length) return;
  const active = n.variantActive ?? n.variants[0].id;
  if (active === to) return;
  const target = n.variants.find((v) => v.id === to);
  const current = n.variants.find((v) => v.id === active);
  if (!target || !current) return;
  await flushTexts();
  const mine = await api.textRead(p.root, n.file);
  const theirs = await api.textRead(p.root, target.file);
  await api.textWrite(p.root, current.file, n.id, n.title, mine);
  await api.textWrite(p.root, n.file, n.id, n.title, theirs);
  st.setWords(n.file, countWords(theirs));
  st.editManifest((m) => {
    const x = locate(m, id)!.node;
    x.variants = (x.variants ?? []).map((v) => (v.id === active ? { ...v, words: countWords(mine) } : v));
    x.variantActive = to;
  });
  useStore.setState({ reload: useStore.getState().reload + 1 });
}

/** Texto de una variante (la activa se lee del archivo del texto, que es el vigente). */
export async function readVariant(n: TreeNode, vid: string): Promise<string> {
  const p = useStore.getState().project!;
  const active = n.variantActive ?? n.variants?.[0]?.id;
  if (vid === active) {
    await flushTexts();
    return api.textRead(p.root, n.file!);
  }
  const v = n.variants?.find((x) => x.id === vid);
  return v ? api.textRead(p.root, v.file) : "";
}

export function renameVariant(id: string, vid: string, name: string) {
  useStore.getState().editManifest((m) => {
    const x = locate(m, id)!.node;
    x.variants = (x.variants ?? []).map((v) => (v.id === vid ? { ...v, name } : v));
  });
}

/** Borra una variante que no es la activa. Si queda una sola, el texto vuelve a ser normal. */
export async function deleteVariant(id: string, vid: string): Promise<void> {
  const st = useStore.getState();
  const p = st.project;
  const n = node(id);
  if (!p || !n?.variants) return;
  const active = n.variantActive ?? n.variants[0].id;
  if (vid === active) return;
  const v = n.variants.find((x) => x.id === vid);
  if (!v) return;
  await api.textDelete(p.root, v.file).catch(() => {});
  const rest = n.variants.filter((x) => x.id !== vid);
  if (rest.length <= 1) for (const r of rest) await api.textDelete(p.root, r.file).catch(() => {});
  st.editManifest((m) => {
    const x = locate(m, id)!.node;
    if (rest.length <= 1) {
      delete x.variants;
      delete x.variantActive;
    } else x.variants = rest;
  });
}
