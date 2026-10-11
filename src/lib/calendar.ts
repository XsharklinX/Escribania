/** Cronos: días de la historia ↔ fechas, en calendario real o inventado. */
import type { Calendar, Manifest, TreeNode } from "../types";
import { walk } from "./tree";

export function dayLabel(cal: Calendar, t: number, lang: string, short = false): string {
  if (cal.kind === "real" || !cal.months.length) {
    const d = new Date((cal.start || "2000-01-01") + "T12:00:00");
    d.setDate(d.getDate() + t);
    return d.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", short ? { day: "numeric", month: "short" } : { day: "numeric", month: "long", year: "numeric" });
  }
  const year = cal.months.reduce((a, mo) => a + Math.max(1, mo.days), 0);
  let rest = ((t % year) + year) % year;
  const y = cal.firstYear + Math.floor(t / year);
  for (const mo of cal.months) {
    const len = Math.max(1, mo.days);
    if (rest < len) return short ? `${rest + 1} ${mo.name.slice(0, 4)}` : `${rest + 1} ${lang === "es" ? "de" : "of"} ${mo.name}, ${cal.yearName} ${y}`;
    rest -= len;
  }
  return String(t);
}

export interface Conflict {
  t: number;
  who: string;
  places: string[];
}

/** Personajes que estarían en dos lugares el mismo día (por POV o por aparecer en el texto). */
export function conflicts(m: Manifest, mentions: Record<string, Record<string, number>>): Conflict[] {
  const texts: TreeNode[] = [];
  walk(m.sections.manuscript, (n) => {
    if (n.type === "text" && n.t != null && n.place) texts.push(n);
  });
  const out: Conflict[] = [];
  const characters = m.codex.filter((e) => e.kind === "character");
  const days = new Set<number>();
  for (const x of texts) for (let d = 0; d < Math.max(1, x.span ?? 1); d++) days.add(x.t! + d);
  for (const day of [...days].sort((a, b) => a - b)) {
    for (const c of characters) {
      const places = new Set<string>();
      for (const x of texts) {
        const inDay = day >= x.t! && day < x.t! + Math.max(1, x.span ?? 1);
        const present = x.pov === c.id || (x.file && (mentions[c.id]?.[x.file] ?? 0) > 0);
        if (inDay && present) places.add(x.place!);
      }
      if (places.size > 1) out.push({ t: day, who: c.id, places: [...places] });
    }
  }
  return out;
}
