import type { Editor } from "@tiptap/react";

/** El editor de la Hoja principal (no el de la Hoja partida), para las herramientas que insertan texto. */
let current: Editor | null = null;

export function setActiveEditor(e: Editor | null) {
  current = e;
}

export function activeEditor(): Editor | null {
  return current && !current.isDestroyed ? current : null;
}
