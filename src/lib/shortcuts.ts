/** Atajos de teclado configurables (Ajustes › Accesibilidad). */
import { useStore } from "../store";

export type ShortcutId =
  | "retiro"
  | "palette"
  | "search"
  | "save"
  | "newText"
  | "newFolder"
  | "export"
  | "settings"
  | "binder"
  | "inspector"
  | "comment"
  | "thesaurus"
  | "timeMachine"
  | "todo";

export const SHORTCUTS: { id: ShortcutId; combo: string }[] = [
  { id: "retiro", combo: "F11" },
  { id: "palette", combo: "Ctrl+K" },
  { id: "search", combo: "Ctrl+Shift+F" },
  { id: "save", combo: "Ctrl+S" },
  { id: "newText", combo: "Ctrl+N" },
  { id: "newFolder", combo: "Ctrl+Shift+N" },
  { id: "export", combo: "Ctrl+E" },
  { id: "settings", combo: "Ctrl+," },
  { id: "binder", combo: "Ctrl+1" },
  { id: "inspector", combo: "Ctrl+3" },
  { id: "comment", combo: "Ctrl+Alt+M" },
  { id: "thesaurus", combo: "Ctrl+Shift+S" },
  { id: "timeMachine", combo: "Ctrl+Alt+H" },
  { id: "todo", combo: "Ctrl+Alt+T" },
];

const KEY_NAMES: Record<string, string> = { " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Escape: "Esc" };

/** «Ctrl+Shift+K» a partir de una pulsación (Cmd cuenta como Ctrl). Vacío si solo hay modificadores. */
export function comboOf(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string {
  if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(e.key)) return "";
  let key = KEY_NAMES[e.key] ?? e.key;
  if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  // Con Mayús, «,» ya llega como otro carácter: solo se anota para letras, números y teclas con nombre.
  if (e.shiftKey && (/^[A-Z0-9]$/.test(key) || key.length > 1)) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function comboFor(id: ShortcutId): string {
  const custom = useStore.getState().settings.keys?.[id];
  return custom ?? SHORTCUTS.find((s) => s.id === id)!.combo;
}

export function matches(e: KeyboardEvent, id: ShortcutId): boolean {
  const combo = comboFor(id);
  return !!combo && comboOf(e) === combo;
}
