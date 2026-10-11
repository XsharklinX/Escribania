/** Operaciones sobre el árbol del Legajo. Todas modifican el manifiesto recibido
 *  (el store pasa siempre una copia). */
import type { Manifest, SectionId, TreeNode } from "../types";

export const SECTIONS: SectionId[] = ["manuscript", "research", "notes", "trash"];

export interface Located {
  section: SectionId;
  list: TreeNode[];
  index: number;
  node: TreeNode;
  parent: TreeNode | null;
  depth: number;
}

export function locate(m: Manifest, id: string): Located | null {
  for (const section of SECTIONS) {
    const found = find(m.sections[section], id, null, 0);
    if (found) return { section, ...found };
  }
  return null;
}

function find(list: TreeNode[], id: string, parent: TreeNode | null, depth: number): Omit<Located, "section"> | null {
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    if (node.id === id) return { list, index: i, node, parent, depth };
    if (node.children) {
      const f = find(node.children, id, node, depth + 1);
      if (f) return f;
    }
  }
  return null;
}

export function walk(list: TreeNode[], fn: (n: TreeNode, depth: number, parent: TreeNode | null) => void, depth = 0, parent: TreeNode | null = null) {
  for (const n of list) {
    fn(n, depth, parent);
    if (n.children) walk(n.children, fn, depth + 1, n);
  }
}

export function isInside(ancestor: TreeNode, id: string): boolean {
  let hit = false;
  walk(ancestor.children ?? [], (n) => {
    if (n.id === id) hit = true;
  });
  return hit;
}

export type DropZone = "before" | "after" | "inside";

/** Mueve `id` respecto a `targetId`. Devuelve false si el movimiento no tiene sentido. */
export function moveNode(m: Manifest, id: string, targetId: string, zone: DropZone): boolean {
  if (id === targetId) return false;
  const src = locate(m, id);
  const dst = locate(m, targetId);
  if (!src || !dst) return false;
  if (isInside(src.node, targetId)) return false;
  if (zone === "inside" && dst.node.type !== "folder") return false;
  const [node] = src.list.splice(src.index, 1);
  const target = locate(m, targetId)!;
  if (target.section !== "trash") delete node.trashedFrom;
  if (zone === "inside") {
    target.node.children = target.node.children ?? [];
    target.node.children.push(node);
    target.node.open = true;
  } else {
    target.list.splice(zone === "before" ? target.index : target.index + 1, 0, node);
  }
  return true;
}

/** Pone `id` al final de una sección (soltar sobre la cabecera de la sección). */
export function moveToSection(m: Manifest, id: string, section: SectionId): boolean {
  const src = locate(m, id);
  if (!src) return false;
  const [node] = src.list.splice(src.index, 1);
  if (section === "trash") node.trashedFrom = node.trashedFrom ?? src.section;
  else delete node.trashedFrom;
  m.sections[section].push(node);
  return true;
}

export function trashNode(m: Manifest, id: string): boolean {
  const src = locate(m, id);
  if (!src || src.section === "trash") return false;
  return moveToSection(m, id, "trash");
}

export function restoreNode(m: Manifest, id: string): boolean {
  const src = locate(m, id);
  if (!src || src.section !== "trash") return false;
  const to = src.node.trashedFrom && src.node.trashedFrom !== "trash" ? src.node.trashedFrom : "manuscript";
  return moveToSection(m, id, to);
}

/** Inserta `node`: dentro de la carpeta seleccionada, detrás del texto seleccionado
 *  o al final del Manuscrito. */
export function insertNear(m: Manifest, node: TreeNode, selectedId: string | null) {
  const sel = selectedId ? locate(m, selectedId) : null;
  if (!sel || sel.section === "trash") {
    m.sections.manuscript.push(node);
  } else if (sel.node.type === "folder") {
    sel.node.children = sel.node.children ?? [];
    sel.node.children.push(node);
    sel.node.open = true;
  } else {
    sel.list.splice(sel.index + 1, 0, node);
  }
}

export function filesIn(list: TreeNode[]): string[] {
  const out: string[] = [];
  walk(list, (n) => {
    if (n.file) out.push(n.file);
    for (const v of n.variants ?? []) out.push(v.file);
  });
  return out;
}

/** Recursos copiados (PDF, imágenes, páginas guardadas) de una rama. */
export function assetsIn(list: TreeNode[]): string[] {
  const out: string[] = [];
  walk(list, (n) => {
    if (n.asset) out.push(n.asset);
  });
  return out;
}

/** Todos los textos del proyecto en orden: Manuscrito, Investigación y Notas. */
export function allTexts(m: Manifest, sections: SectionId[] = ["manuscript", "research", "notes"]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const s of sections) walk(m.sections[s], (n) => {
    if (n.type === "text" && n.file) out.push(n);
  });
  return out;
}

export function wordsOf(node: TreeNode, words: Record<string, number>): number {
  if (node.type === "text") return node.file ? words[node.file] ?? 0 : 0;
  return (node.children ?? []).reduce((s, c) => s + wordsOf(c, words), 0);
}

/** Palabras del libro: textos del Manuscrito marcados para compilar. */
export function bookWords(m: Manifest, words: Record<string, number>): number {
  let total = 0;
  const visit = (list: TreeNode[]) => {
    for (const n of list) {
      if (!n.include) continue;
      if (n.type === "text" && n.file) total += words[n.file] ?? 0;
      if (n.children) visit(n.children);
    }
  };
  visit(m.sections.manuscript);
  return total;
}

/** Lista plana visible (respeta carpetas plegadas) para moverse con el teclado. */
export function visibleIds(list: TreeNode[]): string[] {
  const out: string[] = [];
  const visit = (l: TreeNode[]) => {
    for (const n of l) {
      out.push(n.id);
      if (n.children && n.open) visit(n.children);
    }
  };
  visit(list);
  return out;
}
