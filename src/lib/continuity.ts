/**
 * Continuidad: errores que se cuelan en novelas largas.
 * - Nombres escritos de dos maneras («Tomas» y «Tomás», «Elena» y «Elana»).
 * - Datos que contradicen la ficha del Códice (color de ojos o de pelo).
 * - Edades que no cuadran con la ficha y con el día de Cronos de la escena.
 * Son avisos, no certezas: cada uno enseña la frase para decidir.
 */
import type { CodexEntry, Lang, Manifest, TreeNode } from "../types";
import { walk } from "./tree";

export type Issue =
  | { kind: "spelling"; entry: string; name: string; variant: string; count: number; files: string[]; sample: string }
  | { kind: "field"; entry: string; field: string; expected: string; found: string; file: string; sample: string }
  | { kind: "age"; entry: string; expected: number; found: number; file: string; sample: string };

export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const COLORS: Record<Lang, string[]> = {
  es: ["verde", "azul", "marrón", "negro", "gris", "castaño", "miel", "avellana", "rubio", "pelirrojo", "rojo", "blanco", "canoso", "moreno", "dorado", "oscuro", "claro", "violeta", "ámbar"],
  en: ["green", "blue", "brown", "black", "grey", "gray", "hazel", "amber", "blond", "blonde", "red", "white", "auburn", "golden", "dark", "light", "violet", "silver"],
};

const ATTRS: Record<string, { es: RegExp; en: RegExp; keys: RegExp }> = {
  eyes: { keys: /^(ojos|eyes|color de ojos|eye colou?r)$/i, es: /\bojos\s+(?:muy\s+|tan\s+)?(\p{L}+)/giu, en: /\b(\p{L}+)\s+eyes\b/giu },
  hair: { keys: /^(pelo|cabello|hair|colou?r de pelo|hair colou?r)$/i, es: /\b(?:pelo|cabello|melena)\s+(?:muy\s+)?(\p{L}+)/giu, en: /\b(\p{L}+)\s+hair\b/giu },
};

/** «verdes», «verdosos», «verde» → misma raíz de color. */
function colorStem(word: string, lang: Lang): string | null {
  const w = fold(word);
  for (const c of COLORS[lang]) {
    const f = fold(c);
    if (w === f || w.startsWith(f.slice(0, Math.max(4, f.length - 1)))) return f;
  }
  return null;
}

const NUM_ES: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const NUM_EN: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** «34», «treinta y cuatro», «thirty-four» → 34. */
export function parseAge(s: string, lang: Lang): number | null {
  const t = fold(s.trim());
  if (/^\d{1,3}$/.test(t)) return Number(t);
  const table = lang === "es" ? NUM_ES : NUM_EN;
  const parts = t.split(lang === "es" ? /\s+y\s+/ : /[-\s]+/);
  let n = 0;
  for (const p of parts) {
    const v = table[p];
    if (v === undefined) return null;
    n += v;
  }
  return n || null;
}

const AGE_RE: Record<Lang, RegExp> = {
  es: /\b(\d{1,3}|(?:[a-záéíóú]+)(?:\s+y\s+[a-záéíóú]+)?)\s+años\b/giu,
  en: /\b(\d{1,3}|[a-z]+(?:-[a-z]+)?)\s+(?:years?\s+old|-year-old)\b/giu,
};

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/).filter((s) => s.trim());
}

function namesOf(e: CodexEntry): string[] {
  return [e.name, ...e.aliases].map((x) => x.trim()).filter((x) => x.length > 1);
}

function mentionIndex(sentence: string, e: CodexEntry): number {
  let best = -1;
  for (const n of namesOf(e)) {
    const re = new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u");
    const m = re.exec(sentence);
    if (m && m.index > best) best = m.index;
  }
  return best;
}

/** El personaje al que se refiere una frase: el último nombrado antes de la posición. */
function ownerAt(sentence: string, at: number, people: CodexEntry[]): CodexEntry | null {
  let owner: CodexEntry | null = null;
  let pos = -1;
  for (const e of people) {
    const i = mentionIndex(sentence.slice(0, at + 1), e);
    if (i > pos) {
      pos = i;
      owner = e;
    }
  }
  return owner;
}

export interface TextInfo {
  file: string;
  title: string;
  text: string;
  /** Día de Cronos (0 = primer día de la historia). */
  t?: number | null;
}

export function textsOf(m: Manifest): Omit<TextInfo, "text">[] {
  const out: Omit<TextInfo, "text">[] = [];
  walk(m.sections.manuscript, (n: TreeNode) => {
    if (n.type === "text" && n.file) out.push({ file: n.file, title: n.title, t: n.t });
  });
  return out;
}

export function checkContinuity(m: Manifest, texts: TextInfo[], lang: Lang): Issue[] {
  const issues: Issue[] = [];
  const people = m.codex.filter((e) => e.kind === "character");
  const named = m.codex.filter((e) => e.kind !== "term");

  // 1. Nombres con otra grafía.
  const known = new Map<string, CodexEntry>();
  for (const e of named) for (const n of namesOf(e)) for (const w of n.split(/\s+/)) if (w.length > 2 && /^\p{Lu}/u.test(w)) known.set(w, e);
  const knownFolded = new Set([...known.keys()].map(fold));
  const seen = new Map<string, { entry: CodexEntry; name: string; count: number; files: Set<string>; sample: string }>();
  for (const tx of texts) {
    for (const m2 of tx.text.matchAll(/(?<![\p{L}])(\p{Lu}[\p{Ll}\p{M}]{2,})(?![\p{L}])/gu)) {
      const w = m2[1];
      if (known.has(w)) continue;
      for (const [k, e] of known) {
        const same = fold(w) === fold(k);
        const close = !same && w.length >= 5 && levenshtein(w, k) === 1 && !knownFolded.has(fold(w));
        if (!same && !close) continue;
        const key = `${e.id}|${w}`;
        const cur = seen.get(key) ?? { entry: e, name: k, count: 0, files: new Set<string>(), sample: "" };
        cur.count++;
        cur.files.add(tx.file);
        if (!cur.sample) cur.sample = sentences(tx.text.slice(Math.max(0, (m2.index ?? 0) - 120), (m2.index ?? 0) + 120)).find((s) => s.includes(w)) ?? w;
        seen.set(key, cur);
        break;
      }
    }
  }
  for (const [key, v] of seen) issues.push({ kind: "spelling", entry: v.entry.id, name: v.name, variant: key.split("|")[1], count: v.count, files: [...v.files], sample: v.sample.trim() });

  // 2 y 3. Ojos, pelo y edad frente a la ficha.
  for (const tx of texts) {
    for (const sentence of sentences(tx.text)) {
      for (const [, attr] of Object.entries(ATTRS)) {
        const re = new RegExp(attr[lang].source, "giu");
        for (const mm of sentence.matchAll(re)) {
          const found = colorStem(mm[1], lang);
          if (!found) continue;
          const owner = ownerAt(sentence, mm.index ?? 0, people) ?? (people.filter((p) => mentionIndex(sentence, p) >= 0).length === 1 ? people.find((p) => mentionIndex(sentence, p) >= 0)! : null);
          if (!owner) continue;
          const field = owner.fields.find((f) => attr.keys.test(f.k.trim()) && f.v.trim());
          if (!field) continue;
          const expected = field.v.split(/[\s,;/]+/).map((w) => colorStem(w, lang)).filter(Boolean) as string[];
          if (!expected.length || expected.includes(found)) continue;
          issues.push({ kind: "field", entry: owner.id, field: field.k, expected: field.v, found: mm[1], file: tx.file, sample: sentence.trim() });
        }
      }
      for (const mm of sentence.matchAll(new RegExp(AGE_RE[lang].source, "giu"))) {
        const n = parseAge(mm[1], lang);
        if (n === null || n > 120) continue;
        const owner = ownerAt(sentence, mm.index ?? 0, people);
        if (!owner) continue;
        const field = owner.fields.find((f) => /^(edad|age)$/i.test(f.k.trim()));
        const base = field ? parseAge(field.v.replace(/años|years?( old)?/gi, ""), lang) : null;
        if (base === null) continue;
        const expected = base + Math.floor(Math.max(0, tx.t ?? 0) / 365);
        if (n !== expected) issues.push({ kind: "age", entry: owner.id, expected, found: n, file: tx.file, sample: sentence.trim() });
      }
    }
  }
  return issues;
}
