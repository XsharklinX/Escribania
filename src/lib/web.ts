/**
 * Exportar para la web: un archivo por capítulo en HTML sencillo (lo que
 * aceptan Wattpad, un blog o una newsletter al pegar) o en Markdown, con un
 * índice. Los separadores de escena salen como «* * *» centrado.
 */
import type { Manifest } from "../types";
import type { Piece } from "./compile";
import { markdownToHtml } from "./markdown";
import { slugify } from "./ids";

export interface WebChapter {
  title: string;
  file: string;
  html: string;
  md: string;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Parte las piezas del libro en capítulos (cada encabezado que abre capítulo empieza uno nuevo). */
export function webChapters(m: Manifest, pieces: Piece[], separator: string): WebChapter[] {
  const sep = separator.trim() || "* * *";
  const out: { title: string; html: string[]; md: string[] }[] = [];
  const levels = pieces.flatMap((p) => (p.kind === "heading" ? [p.level] : []));
  const count = (l: number) => levels.filter((x) => x === l).length;
  // Con partes (nivel 1) y capítulos (nivel 2), cada capítulo es un archivo y la parte va de cabecera del primero.
  const top = count(2) > count(1) && count(1) > 0 ? 2 : Math.min(...levels, 9);
  let partTitle = "";
  let cur: { title: string; html: string[]; md: string[] } | null = null;
  const ensure = () => {
    if (!cur) {
      cur = { title: m.title, html: [], md: [] };
      out.push(cur);
    }
    return cur;
  };
  for (const p of pieces) {
    if (p.kind === "heading" && p.level < top) {
      partTitle = p.text;
    } else if (p.kind === "heading" && p.level === top) {
      cur = { title: p.text, html: partTitle ? [`<h2>${escHtml(partTitle)}</h2>`] : [], md: partTitle ? [`## ${partTitle}`] : [] };
      partTitle = "";
      out.push(cur);
    } else if (p.kind === "heading") {
      ensure().html.push(`<h3>${escHtml(p.text)}</h3>`);
      ensure().md.push(`### ${p.text}`);
    } else if (p.kind === "break") {
      ensure().html.push(`<p style="text-align:center">${escHtml(sep)}</p>`);
      ensure().md.push(`<p align="center">${sep}</p>`);
    } else {
      ensure().html.push(markdownToHtml(p.md).trim());
      ensure().md.push(p.md.trim());
    }
  }
  const width = String(out.length).length;
  return out
    .filter((c) => c.html.length)
    .map((c, i) => {
      const n = String(i + 1).padStart(Math.max(2, width), "0");
      return { title: c.title, file: `${n}-${slugify(c.title) || "capitulo"}`, html: c.html.join("\n"), md: `# ${c.title}\n\n${c.md.join("\n\n")}\n` };
    });
}

export function chapterPage(m: Manifest, c: WebChapter, lang: string, nav: { prev?: WebChapter; next?: WebChapter; index: string }): string {
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(c.title)} · ${escHtml(m.title)}</title>
<style>body{max-width:38em;margin:2.5em auto;padding:0 1.2em;font:1.12rem/1.75 Georgia,serif;color:#222;background:#fdfcf8}h1{font-weight:normal;text-align:center;margin:1.5em 0}p{margin:0 0 1em}nav{display:flex;justify-content:space-between;margin:3em 0 1em;font-size:.9em}a{color:#3350d1}</style>
</head><body>
<h1>${escHtml(c.title)}</h1>
${c.html}
<nav>${nav.prev ? `<a href="${nav.prev.file}.html">← ${escHtml(nav.prev.title)}</a>` : "<span></span>"}<a href="index.html">${escHtml(nav.index)}</a>${nav.next ? `<a href="${nav.next.file}.html">${escHtml(nav.next.title)} →</a>` : "<span></span>"}</nav>
</body></html>
`;
}

export function indexPage(m: Manifest, chapters: WebChapter[], lang: string, ext: "html" | "md"): string {
  if (ext === "md") return `# ${m.title}\n\n${m.author ? `*${m.author}*\n\n` : ""}${chapters.map((c) => `1. [${c.title}](${c.file}.md)`).join("\n")}\n`;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(m.title)}</title>
<style>body{max-width:34em;margin:3em auto;padding:0 1.2em;font:1.12rem/1.7 Georgia,serif;color:#222;background:#fdfcf8}h1{font-weight:normal;text-align:center}ol{line-height:2}a{color:#3350d1}</style>
</head><body><h1>${escHtml(m.title)}</h1>${m.author ? `<p style="text-align:center"><em>${escHtml(m.author)}</em></p>` : ""}
<ol>${chapters.map((c) => `<li><a href="${c.file}.html">${escHtml(c.title)}</a></li>`).join("")}</ol></body></html>
`;
}
