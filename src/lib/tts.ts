/**
 * Lectura en voz alta con las voces del sistema (Web Speech). Lee párrafo a
 * párrafo desde el cursor y resalta la palabra que suena.
 */
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { create } from "zustand";
import { useStore } from "../store";
import { textblocks } from "./editorExtensions";

export const useTts = create<{ speaking: boolean; paused: boolean }>(() => ({ speaking: false, paused: false }));

type Range = { from: number; to: number } | null;

export const ttsKey = new PluginKey<Range>("readAloud");

export const ReadAloud = Extension.create({
  name: "readAloud",
  addProseMirrorPlugins() {
    return [
      new Plugin<Range>({
        key: ttsKey,
        state: {
          init: (): Range => null,
          apply: (tr, old: Range): Range => {
            const meta = tr.getMeta(ttsKey);
            if (meta !== undefined) return meta;
            if (!old || !tr.docChanged) return old;
            return { from: tr.mapping.map(old.from), to: tr.mapping.map(old.to) };
          },
        },
        props: {
          decorations: (state) => {
            const r = ttsKey.getState(state);
            return r ? DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: "tts-word" })]) : null;
          },
        },
      }),
    ];
  },
});

export function ttsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  if (!ttsAvailable()) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
}

let current: Editor | null = null;
let stopped = false;

export function stopReading() {
  stopped = true;
  if (ttsAvailable()) speechSynthesis.cancel();
  if (current && !current.isDestroyed) current.view.dispatch(current.state.tr.setMeta(ttsKey, null));
  current = null;
  useTts.setState({ speaking: false, paused: false });
}

export function pauseReading() {
  if (!ttsAvailable()) return;
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
    useTts.setState({ paused: false });
  } else {
    speechSynthesis.pause();
    useTts.setState({ paused: true });
  }
}

export function startReading(editor: Editor) {
  if (!ttsAvailable()) return;
  stopReading();
  stopped = false;
  current = editor;
  const { settings } = useStore.getState();
  const blocks = textblocks(editor.state.doc);
  const head = editor.state.selection.from;
  let i = Math.max(0, blocks.findIndex((b) => b.map.length && b.map[b.map.length - 1] >= head));
  const voice = speechSynthesis.getVoices().find((v) => v.name === settings.ttsVoice) ?? voicesFor(settings.lang)[0];
  useTts.setState({ speaking: true, paused: false });

  const next = () => {
    if (stopped || !current || current.isDestroyed) return;
    while (i < blocks.length && !blocks[i].text.trim()) i++;
    if (i >= blocks.length) return stopReading();
    const b = blocks[i++];
    const u = new SpeechSynthesisUtterance(b.text);
    u.lang = settings.lang === "es" ? "es-ES" : "en-US";
    if (voice) u.voice = voice;
    u.rate = settings.ttsRate || 1;
    u.onboundary = (ev) => {
      if (ev.name !== "word" || !current || current.isDestroyed) return;
      const start = ev.charIndex;
      const len = ev.charLength || (/^\S+/.exec(b.text.slice(start))?.[0].length ?? 1);
      const from = b.map[start];
      const to = b.map[Math.min(b.map.length - 1, start + len - 1)] + 1;
      if (from !== undefined && to) current.view.dispatch(current.state.tr.setMeta(ttsKey, { from, to }));
    };
    u.onend = next;
    u.onerror = () => stopReading();
    speechSynthesis.speak(u);
  };
  next();
}
