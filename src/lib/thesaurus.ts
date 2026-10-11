/**
 * Sinónimos y antónimos sin conexión: los tesauros libres de LibreOffice
 * (OpenThesaurus en español, WordNet en inglés), preparados con
 * scripts/tesauro.py en public/thes/<idioma>.txt.gz. Se cargan la primera vez
 * que se piden y se quedan en memoria.
 */
import type { Lang } from "../types";

export interface ThesaurusEntry {
  /** Palabra del diccionario que se ha encontrado (puede ser el singular, el masculino…). */
  word: string;
  senses: string[][];
  antonyms: string[];
}

const cache = new Map<Lang, Promise<Map<string, string>>>();

async function gunzipText(res: Response): Promise<string> {
  if (!res.body) return "";
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

export function parseThesaurus(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return map;
}

function load(lang: Lang): Promise<Map<string, string>> {
  let p = cache.get(lang);
  if (!p) {
    p = fetch(new URL(`./thes/${lang}.txt.gz`, document.baseURI).href)
      .then((r) => (r.ok ? gunzipText(r) : ""))
      .then(parseThesaurus);
    p.catch(() => cache.delete(lang));
    cache.set(lang, p);
  }
  return p;
}

/** Formas a probar si la palabra no está tal cual: plural, femenino, verbo conjugado (lo básico). */
export function candidates(word: string, lang: Lang): string[] {
  const w = word.toLowerCase();
  const out = [w];
  const add = (x: string) => x.length > 1 && !out.includes(x) && out.push(x);
  if (lang === "es") {
    if (w.endsWith("ces")) add(w.slice(0, -3) + "z");
    if (w.endsWith("es")) add(w.slice(0, -2));
    if (w.endsWith("s")) add(w.slice(0, -1));
    const base = out[out.length - 1];
    if (base.endsWith("a")) add(base.slice(0, -1) + "o");
    if (w.endsWith("as")) add(w.slice(0, -2) + "o");
    // Adjetivos en -ísimo y adverbios en -mente.
    if (w.endsWith("mente")) add(w.slice(0, -5).replace(/a$/, "o"));
    if (w.endsWith("ísimo")) add(w.slice(0, -5) + "o");
    // Verbos: participio, gerundio e imperfecto → infinitivo (el tesauro trae infinitivos).
    const verb: [RegExp, string[]][] = [
      [/(ad[oa]s?)$/, ["ar"]],
      [/(id[oa]s?)$/, ["ir", "er"]],
      [/(ando)$/, ["ar"]],
      [/(iendo)$/, ["er", "ir"]],
      [/(aba|abas|aban|ábamos)$/, ["ar"]],
      [/(ía|ías|ían|íamos)$/, ["er", "ir"]],
      [/(ó)$/, ["ar"]],
      [/(ió)$/, ["er", "ir"]],
    ];
    for (const [re, ends] of verb) {
      const m = re.exec(w);
      if (m) for (const e of ends) add(w.slice(0, m.index) + e);
    }
  } else {
    if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
    if (w.endsWith("es")) add(w.slice(0, -2));
    if (w.endsWith("s")) add(w.slice(0, -1));
    if (w.endsWith("ed")) {
      add(w.slice(0, -2));
      add(w.slice(0, -1));
    }
    if (w.endsWith("ing")) {
      add(w.slice(0, -3));
      add(w.slice(0, -3) + "e");
    }
    if (w.endsWith("ly")) add(w.slice(0, -2));
  }
  return out;
}

export function lookupIn(map: Map<string, string>, word: string, lang: Lang): ThesaurusEntry | null {
  for (const c of candidates(word, lang)) {
    const raw = map.get(c);
    if (!raw) continue;
    const cols = raw.split("\t");
    const antonyms = cols[cols.length - 1].startsWith("!") ? cols.pop()!.slice(1).split("|") : [];
    return { word: c, senses: cols.map((s) => s.split("|")), antonyms };
  }
  return null;
}

export async function lookup(word: string, lang: Lang): Promise<ThesaurusEntry | null> {
  return lookupIn(await load(lang), word, lang);
}

/** Respeta la mayúscula inicial de la palabra que se sustituye. */
export function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}
