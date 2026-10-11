/**
 * Corrector local con diccionarios Hunspell (español e inglés) incluidos en la app.
 * Nada sale del equipo. Acepta solos los nombres del Códice, el glosario y el
 * diccionario personal (`diccionario.json` en la carpeta de datos).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useStore } from "../store";
import type { Lang } from "../types";
import { api } from "./api";
import { textblocks } from "./editorExtensions";

let worker: Worker | null = null;
let workerLang: Lang | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const waiting = new Map<number, (v: Record<string, unknown>) => void>();
/** palabra → correcta. */
const cache = new Map<string, boolean>();
let userWords: string[] | null = null;
const listeners = new Set<() => void>();

function call(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    worker!.postMessage({ ...msg, id });
  });
}

async function loadUserWords(): Promise<string[]> {
  if (userWords) return userWords;
  try {
    const raw = (await api.appJsonRead("diccionario.json")) as { words?: string[] } | null;
    userWords = raw?.words ?? [];
  } catch {
    userWords = [];
  }
  return userWords;
}

/** Palabras del proyecto que nunca son errores: nombres, alias y términos del Códice. */
function projectWords(): string[] {
  const m = useStore.getState().project?.manifest;
  if (!m) return [];
  return m.codex.flatMap((e) => [e.name, ...e.aliases]).flatMap((n) => n.split(/[^\p{L}'’-]+/u)).filter((w) => w.length > 1);
}

export function ensureSpeller(lang: Lang): Promise<void> {
  if (worker && workerLang === lang && ready) return ready;
  worker?.terminate();
  cache.clear();
  workerLang = lang;
  worker = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const r = waiting.get(e.data.id);
    if (r) {
      waiting.delete(e.data.id);
      r(e.data);
    }
  };
  ready = (async () => {
    const extra = [...(await loadUserWords()), ...projectWords()];
    const base = new URL(`./dict/${lang}`, document.baseURI).href;
    await call({ type: "init", aff: `${base}.aff`, dic: `${base}.dic`, extra });
  })();
  return ready;
}

const WORD = /[\p{L}][\p{L}'’]*[\p{L}]|\p{L}/gu;

function skip(w: string): boolean {
  return w.length < 2 || /\d/.test(w) || (w === w.toUpperCase() && w.length <= 5);
}

/** Comprueba palabras nuevas y avisa cuando hay resultados. */
async function checkWords(words: string[]) {
  const lang = useStore.getState().settings.lang;
  await ensureSpeller(lang);
  const todo = [...new Set(words)].filter((w) => !cache.has(w) && !skip(w));
  if (!todo.length) return;
  for (const w of todo) cache.set(w, true); // provisional para no pedirla dos veces
  const r = await call({ type: "check", words: todo });
  const bad = new Set((r.bad as string[]) ?? []);
  for (const w of todo) cache.set(w, !bad.has(w));
  if (bad.size) listeners.forEach((l) => l());
}

export async function suggest(word: string): Promise<string[]> {
  await ensureSpeller(useStore.getState().settings.lang);
  const r = await call({ type: "suggest", word });
  return (r.suggestions as string[]) ?? [];
}

export async function addToDictionary(word: string) {
  const words = await loadUserWords();
  if (!words.includes(word)) words.push(word);
  await api.appJsonWrite("diccionario.json", { words }).catch(() => {});
  cache.set(word, true);
  if (worker) await call({ type: "add", words: [word] });
  listeners.forEach((l) => l());
}

export function isMisspelled(w: string): boolean {
  return cache.get(w) === false;
}

export const spellKey = new PluginKey<DecorationSet>("spellcheck");

export const SpellCheck = Extension.create<{ isOn: () => boolean }>({
  name: "spellcheck",
  addOptions() {
    return { isOn: () => false };
  },
  addProseMirrorPlugins() {
    const { isOn } = this.options;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const build = (state: EditorState) => {
      if (!isOn()) return DecorationSet.empty;
      const decos: Decoration[] = [];
      for (const b of textblocks(state.doc)) {
        for (const m of b.text.matchAll(WORD)) {
          if (isMisspelled(m[0])) decos.push(Decoration.inline(b.map[m.index!], b.map[m.index! + m[0].length - 1] + 1, { class: "spell-error", "data-word": m[0] }));
        }
      }
      return DecorationSet.create(state.doc, decos);
    };
    return [
      new Plugin({
        key: spellKey,
        state: {
          init: (_, state) => build(state),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(spellKey) ? build(state) : old.map(tr.mapping, tr.doc)),
        },
        props: { decorations: (state) => spellKey.getState(state) },
        view(view) {
          const run = () => {
            if (!isOn()) return;
            const words = textblocks(view.state.doc).flatMap((b) => [...b.text.matchAll(WORD)].map((m) => m[0]));
            void checkWords(words);
          };
          const refresh = () => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(spellKey, true));
          };
          listeners.add(refresh);
          run();
          return {
            update(v, prev) {
              if (v.state.doc === prev.doc) return;
              if (timer) clearTimeout(timer);
              timer = setTimeout(run, 500);
            },
            destroy() {
              listeners.delete(refresh);
              if (timer) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
