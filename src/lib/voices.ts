/**
 * Voz de cada personaje: cuánto habla cada uno, con qué longitud de frase y
 * qué palabras le distinguen, para que no hablen todos igual.
 *
 * Diálogo en español: párrafos que empiezan por raya («—»); lo que hay entre
 * rayas son incisos del narrador («—dijo Elena—»), donde se busca quién habla.
 * En inglés: lo que va entre comillas, y el resto del párrafo para el hablante.
 */
import type { CodexEntry, Lang } from "../types";
import { fold } from "./continuity";

export interface Line {
  speaker: string | null;
  text: string;
}

export interface VoiceStats {
  speaker: string | null;
  lines: number;
  words: number;
  avgLine: number;
  avgSentence: number;
  questions: number;
  exclamations: number;
  richness: number;
  top: string[];
}

const STOP: Record<Lang, Set<string>> = {
  es: new Set("a al algo algun alguna ahora asi aun aunque bien como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era eres es esa ese eso esta estaba estas este esto estoy fue fui ha habia han hasta hay la las le les lo los mas me mi mia mio mis muy nada ni no nos nosotros o os otra otro para pero poco por porque que quien se sea si sin sobre solo son soy su sus tambien te tengo ti tiene todo tu tus un una uno unos usted ustedes va vamos voy y ya yo eh oh ah dijo".split(" ")),
  en: new Set("a about after all also am an and any are as at be because been but by can could did do does don't for from get got had has have he her him his how i i'm if in into is it it's its just know like me my no not now of oh on one or our out said she so some than that the their them then there they this to too up us was we well were what when who why will with would yes you your".split(" ")),
};

function speakerIn(text: string, people: CodexEntry[]): string | null {
  let best: { id: string; at: number } | null = null;
  for (const e of people) {
    for (const n of [e.name, ...e.aliases]) {
      const name = n.trim();
      if (name.length < 2) continue;
      const re = new RegExp(`(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u");
      const m = re.exec(text);
      if (m && (!best || m.index < best.at)) best = { id: e.id, at: m.index };
    }
  }
  return best?.id ?? null;
}

/** Líneas de diálogo de un texto (Markdown ya pasado a texto plano). */
export function dialogueLines(plain: string, people: CodexEntry[], lang: Lang): Line[] {
  const out: Line[] = [];
  let last: string | null = null;
  let before: string | null = null;
  for (const para of plain.split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (lang === "es" && /^[—–]/.test(p)) {
      const parts = p.replace(/^[—–]\s*/, "").split(/\s*[—–]\s*/);
      // Tras un inciso, la puntuación que lo cierra («—dijo—.») no es parte de lo dicho.
      const speech = parts
        .filter((_, i) => i % 2 === 0)
        .map((x, i) => (i ? x.replace(/^[.,;:]\s*/, "") : x))
        .filter(Boolean)
        .join(" ")
        .trim();
      const tags = parts.filter((_, i) => i % 2 === 1).join(" ");
      // Quien habla: el del inciso; si no hay, el que alterna con el anterior en la conversación.
      let who = speakerIn(tags, people);
      if (!who && before && last && before !== last) who = before;
      if (speech) out.push({ speaker: who, text: speech });
      before = last;
      last = who;
      continue;
    }
    const quotes = [...p.matchAll(/[“"«]([^”"»]+)[”"»]/g)];
    if (lang === "en" && quotes.length) {
      const outside = p.replace(/[“"«][^”"»]+[”"»]/g, " ");
      const who = speakerIn(outside, people) ?? (before && last && before !== last ? before : null);
      out.push({ speaker: who, text: quotes.map((q) => q[1]).join(" ") });
      before = last;
      last = who;
      continue;
    }
    // Narración: corta la conversación.
    last = null;
    before = null;
  }
  return out;
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];
}

export function voiceStats(lines: Line[], lang: Lang): VoiceStats[] {
  const by = new Map<string | null, Line[]>();
  for (const l of lines) by.set(l.speaker, [...(by.get(l.speaker) ?? []), l]);
  const all = new Map<string, number>();
  let allTotal = 0;
  for (const l of lines)
    for (const w of words(l.text)) {
      all.set(w, (all.get(w) ?? 0) + 1);
      allTotal++;
    }
  const out: VoiceStats[] = [];
  for (const [speaker, ls] of by) {
    const freq = new Map<string, number>();
    let total = 0;
    let sentences = 0;
    let q = 0;
    let ex = 0;
    for (const l of ls) {
      const ws = words(l.text);
      total += ws.length;
      for (const w of ws) freq.set(w, (freq.get(w) ?? 0) + 1);
      sentences += Math.max(1, (l.text.match(/[.!?…]+/g) ?? []).length);
      if (/[?¿]/.test(l.text)) q++;
      if (/[!¡]/.test(l.text)) ex++;
    }
    // Palabras propias: más frecuentes en su boca que en el diálogo de todos (log-odds con suavizado).
    const top = [...freq.entries()]
      .filter(([w, n]) => n >= 2 && w.length > 2 && !STOP[lang].has(fold(w)))
      .map(([w, n]) => {
        const rest = (all.get(w) ?? 0) - n;
        const restTotal = Math.max(1, allTotal - total);
        return [w, Math.log((n + 0.5) / (total + 1)) - Math.log((rest + 0.5) / (restTotal + 1))] as const;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w);
    out.push({
      speaker,
      lines: ls.length,
      words: total,
      avgLine: ls.length ? total / ls.length : 0,
      avgSentence: sentences ? total / sentences : 0,
      questions: ls.length ? q / ls.length : 0,
      exclamations: ls.length ? ex / ls.length : 0,
      richness: total ? freq.size / total : 0,
      top,
    });
  }
  return out.sort((a, b) => (a.speaker === null ? 1 : b.speaker === null ? -1 : b.lines - a.lines));
}
