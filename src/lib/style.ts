/**
 * Lupa de estilo: repeticiones cercanas, adverbios en -mente, muletillas,
 * frases larguísimas, voz pasiva y legibilidad (Fernández-Huerta en español,
 * Flesch en inglés). Solo señala: nunca cambia el texto.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { create } from "zustand";
import type { Lang } from "../types";
import { textblocks } from "./editorExtensions";

export type LensKind = "rep" | "adv" | "crutch" | "long" | "passive";
export const LENS_KINDS: LensKind[] = ["rep", "adv", "crutch", "long", "passive"];

export interface LensHit {
  kind: LensKind;
  from: number;
  to: number;
  text: string;
}

export interface LensResult {
  hits: LensHit[];
  words: number;
  sentences: number;
  syllables: number;
  readability: number;
  counts: Record<LensKind, number>;
  topRepeated: [string, number][];
}

export const DEFAULT_CRUTCHES: Record<Lang, string[]> = {
  es: [
    "la verdad es que", "de repente", "de pronto", "en realidad", "realmente", "simplemente", "básicamente", "un poco", "de alguna manera",
    "por supuesto", "sin embargo", "entonces", "un tanto", "en cierto modo", "algo así", "de hecho", "obviamente", "claramente", "literalmente",
    "comenzó a", "empezó a", "pareció", "sintió que", "se dio cuenta de que",
  ],
  en: [
    "suddenly", "really", "very", "just", "actually", "basically", "literally", "somehow", "a bit", "kind of", "sort of", "started to", "began to",
    "seemed to", "felt that", "realized that", "of course",
  ],
};

const STOP: Record<Lang, Set<string>> = {
  es: new Set(
    "para como pero porque cuando donde desde hasta sobre entre este esta esto estos estas aquel aquella eso esos esas ellos ellas nosotros vosotros usted ustedes también tanto todo toda todos todas otro otra otros otras mismo misma cual cuales quien quienes había habían tenía tenían estaba estaban era eran fue fueron sido estar tener hacer haber nada algo cada después antes ahora luego mientras aunque sino solo sólo muy más menos bien así tan ya aún hacia según durante".split(" "),
  ),
  en: new Set("that this with from they them their there have were what when which would could should about into than then been also some just more said like only over very".split(" ")),
};

const NOT_ADVERB = new Set(["mente", "demente", "clemente", "simiente", "vehemente", "inclemente", "fuente"]);
const NOT_LY = new Set(["only", "family", "reply", "early", "holy", "ugly", "fly", "july", "italy", "lily", "belly", "jelly", "silly", "rely", "supply", "apply"]);

/** Sílabas de una palabra española (núcleos vocálicos con diptongos e hiatos). */
export function syllablesEs(word: string): number {
  const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
  if (!w) return 0;
  const strong = "aeoáéóíú";
  const vowel = "aeiouáéíóúü";
  let n = 0;
  let prev = "";
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    if (!vowel.includes(c)) {
      prev = "";
      continue;
    }
    // "y" final ya no llega aquí. Dos fuertes seguidas: hiato (nueva sílaba).
    if (!prev || (strong.includes(prev) && strong.includes(c))) n++;
    prev = c;
  }
  // "que", "qui", "gue", "gui": la u no suena y no forma diptongo nuevo (ya contado).
  return Math.max(1, n);
}

export function syllablesEn(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function readability(lang: Lang, words: number, sentences: number, syllables: number): number {
  if (!words || !sentences) return 0;
  if (lang === "es") return 206.84 - 0.6 * ((syllables / words) * 100) - 1.02 * ((sentences / words) * 100);
  return 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
}

export function readabilityLabel(score: number, lang: Lang): string {
  const es = ["Muy difícil", "Difícil", "Bastante difícil", "Normal", "Bastante fácil", "Fácil", "Muy fácil"];
  const en = ["Very hard", "Hard", "Fairly hard", "Standard", "Fairly easy", "Easy", "Very easy"];
  const i = score < 30 ? 0 : score < 50 ? 1 : score < 60 ? 2 : score < 70 ? 3 : score < 80 ? 4 : score < 90 ? 5 : 6;
  return (lang === "es" ? es : en)[i];
}

const L = "[\\p{L}\\p{N}_]";

function stem(w: string, lang: Lang): string {
  let s = w.toLocaleLowerCase();
  if (lang === "es") s = s.replace(/(es|s)$/, "");
  else s = s.replace(/(ing|ed|s)$/, "");
  return s.slice(0, Math.max(4, s.length));
}

export function analyze(doc: PMNode, lang: Lang, longLimit: number, crutches: string[]): LensResult {
  const hits: LensHit[] = [];
  const counts: Record<LensKind, number> = { rep: 0, adv: 0, crutch: 0, long: 0, passive: 0 };
  let words = 0;
  let sentences = 0;
  let syllables = 0;
  const seen = new Map<string, { idx: number; from: number; to: number; text: string; marked: boolean }>();
  const freq = new Map<string, number>();
  let wordIndex = 0;
  const syl = lang === "es" ? syllablesEs : syllablesEn;
  const adverb = lang === "es" ? /(?<![\p{L}])\p{L}+mente(?![\p{L}])/giu : /(?<![\p{L}])\p{L}+ly(?![\p{L}])/giu;
  const passive =
    lang === "es"
      ? /(?<![\p{L}])(fue|fueron|era|eran|es|son|será|serán|sido|siendo)\s+\p{L}+(ado|ada|ados|adas|ido|ida|idos|idas|ito|ita|itos|itas|cho|cha|chos|chas|sto|sta|stos|stas|ierto|ierta|uelto|uelta)(?![\p{L}])/giu
      : /\b(was|were|is|are|been|be|being)\s+\w+(ed|en)\b/gi;
  const crutchRe = crutches.length
    ? new RegExp(`(?<!${L})(?:${crutches.map((c) => c.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean).join("|")})(?!${L})`, "giu")
    : null;

  for (const b of textblocks(doc)) {
    const t = b.text;
    const at = (i: number, len: number) => ({ from: b.map[i], to: b.map[i + len - 1] + 1 });
    // Palabras: recuento, sílabas y repeticiones a menos de 50 palabras.
    for (const m of t.matchAll(/\p{L}[\p{L}'’]*/gu)) {
      const w = m[0];
      words++;
      wordIndex++;
      syllables += syl(w);
      if (w.length < 4 || STOP[lang].has(w.toLocaleLowerCase())) continue;
      const s = stem(w, lang);
      freq.set(s, (freq.get(s) ?? 0) + 1);
      const r = at(m.index!, w.length);
      const prev = seen.get(s);
      if (prev && wordIndex - prev.idx <= 50) {
        if (!prev.marked) {
          hits.push({ kind: "rep", from: prev.from, to: prev.to, text: prev.text });
          counts.rep++;
          prev.marked = true;
        }
        hits.push({ kind: "rep", ...r, text: w });
        counts.rep++;
        seen.set(s, { idx: wordIndex, ...r, text: w, marked: true });
      } else seen.set(s, { idx: wordIndex, ...r, text: w, marked: false });
    }
    for (const m of t.matchAll(adverb)) {
      if ((lang === "es" ? NOT_ADVERB : NOT_LY).has(m[0].toLowerCase())) continue;
      hits.push({ kind: "adv", ...at(m.index!, m[0].length), text: m[0] });
      counts.adv++;
    }
    if (crutchRe)
      for (const m of t.matchAll(crutchRe)) {
        hits.push({ kind: "crutch", ...at(m.index!, m[0].length), text: m[0] });
        counts.crutch++;
      }
    for (const m of t.matchAll(passive)) {
      hits.push({ kind: "passive", ...at(m.index!, m[0].length), text: m[0] });
      counts.passive++;
    }
    // Frases.
    const re = /[^.!?…]+[.!?…]*[»”")]*\s*/gu;
    for (const m of t.matchAll(re)) {
      const n = (m[0].match(/\p{L}[\p{L}'’]*/gu) ?? []).length;
      if (!n) continue;
      sentences++;
      if (n > longLimit) {
        const len = m[0].trimEnd().length;
        hits.push({ kind: "long", ...at(m.index!, len), text: m[0].trim() });
        counts.long++;
      }
    }
  }
  const topRepeated = [...freq.entries()].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { hits, words, sentences, syllables, readability: Math.round(readability(lang, words, sentences, syllables)), counts, topRepeated };
}

/** Resultado de la Lupa del texto abierto, para el Inspector. */
export const useLens = create<{ result: LensResult | null; kinds: LensKind[] }>(() => ({ result: null, kinds: [...LENS_KINDS] }));

export const lensKey = new PluginKey<DecorationSet>("styleLens");

export const StyleLens = Extension.create<{ isOn: () => boolean; lang: () => Lang; long: () => number; crutches: () => string[] }>({
  name: "styleLens",
  addOptions() {
    return { isOn: () => false, lang: () => "es" as Lang, long: () => 40, crutches: () => [] };
  },
  addProseMirrorPlugins() {
    const o = this.options;
    const build = (state: EditorState) => {
      if (!o.isOn()) {
        if (useLens.getState().result) useLens.setState({ result: null });
        return DecorationSet.empty;
      }
      const r = analyze(state.doc, o.lang(), o.long(), o.crutches());
      queueMicrotask(() => useLens.setState({ result: r }));
      const kinds = useLens.getState().kinds;
      return DecorationSet.create(
        state.doc,
        r.hits.filter((h) => kinds.includes(h.kind)).map((h) => Decoration.inline(h.from, h.to, { class: `lens-${h.kind}` })),
      );
    };
    return [
      new Plugin({
        key: lensKey,
        state: {
          init: (_, state) => build(state),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(lensKey) ? build(state) : old),
        },
        props: { decorations: (state) => lensKey.getState(state) },
      }),
    ];
  },
});
