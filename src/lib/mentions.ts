/** Ecos: índice de en qué textos aparece cada ficha del Códice. */
import { useStore } from "../store";
import type { Manifest } from "../types";
import { api } from "./api";
import type { MentionTerm } from "./editorExtensions";
import { flushTexts } from "./saver";
import { allTexts } from "./tree";

export function mentionTerms(m: Manifest): MentionTerm[] {
  if (!useStore.getState().settings.mentions) return [];
  return m.codex.filter((e) => e.mentions && e.name.trim()).map((e) => ({ id: e.id, names: [e.name, ...e.aliases], color: e.color }));
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function refreshMentions(delay = 0) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    const p = useStore.getState().project;
    if (!p) return;
    await flushTexts();
    const terms = p.manifest.codex.filter((e) => e.name.trim()).map((e) => ({ id: e.id, names: [e.name, ...e.aliases] }));
    const files = allTexts(p.manifest, ["manuscript", "notes"]).map((n) => n.file!);
    try {
      useStore.setState({ mentions: terms.length ? await api.mentions(p.root, files, terms) : {} });
    } catch {
      /* el índice se recalcula la próxima vez */
    }
  }, delay);
}
