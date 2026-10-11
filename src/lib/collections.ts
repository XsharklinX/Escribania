/**
 * Etiquetas y colecciones: las escenas llevan etiquetas libres y las
 * colecciones agrupan escenas a mano o con un filtro guardado (etiquetas,
 * estado, punto de vista, una palabra del texto) que se actualiza solo.
 */
import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { Collection, Manifest, TreeNode } from "../types";
import { api } from "./api";
import { walk, SECTIONS } from "./tree";

export function allTags(m: Manifest): string[] {
  const set = new Set<string>();
  for (const s of SECTIONS) walk(m.sections[s], (n) => n.tags?.forEach((t) => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function normTag(s: string): string {
  return s.trim().replace(/^#/, "").replace(/\s+/g, " ").slice(0, 40);
}

/** ¿Cumple el nodo la parte del filtro que no necesita leer el texto? */
export function matchesFilter(n: TreeNode, f: Collection["filter"]): boolean {
  if (n.type !== "text" && n.type !== "folder") return false;
  if (f.tags.length && !f.tags.every((t) => n.tags?.includes(t))) return false;
  if (f.status.length && !f.status.includes(n.status)) return false;
  if (f.pov && n.pov !== f.pov) return false;
  return true;
}

export function emptyFilter(): Collection["filter"] {
  return { tags: [], status: [], pov: "", text: "" };
}

/** Nodos de una colección, en el orden del Legajo. La búsqueda de texto se hace en Rust. */
export function useCollectionNodes(c: Collection | null): TreeNode[] | null {
  const m = useStore((s) => s.project?.manifest);
  const root = useStore((s) => s.project?.root);
  const [files, setFiles] = useState<Set<string> | null>(null);
  const text = c?.kind === "smart" ? c.filter.text.trim() : "";
  useEffect(() => {
    if (!text || !m || !root) return setFiles(null);
    const all: string[] = [];
    walk(m.sections.manuscript, (n) => n.file && all.push(n.file));
    let alive = true;
    void api.search(root, all, { query: text, regex: false, case: false, word: false }).then(
      (hits) => alive && setFiles(new Set(hits.map((h) => h.file))),
      () => alive && setFiles(new Set()),
    );
    return () => {
      alive = false;
    };
    // El texto de los archivos no está en el manifiesto: se repite al cambiar el filtro o el árbol.
  }, [text, root, m]);
  if (!c || !m) return null;
  if (text && !files) return null;
  const out: TreeNode[] = [];
  for (const s of SECTIONS) {
    if (s === "trash") continue;
    walk(m.sections[s], (n) => {
      if (c.kind === "manual" ? c.ids.includes(n.id) : matchesFilter(n, c.filter) && n.type === "text" && (!text || (n.file && files!.has(n.file)))) out.push(n);
    });
  }
  return out;
}
