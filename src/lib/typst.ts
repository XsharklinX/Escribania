/**
 * Imprenta: documentos en lenguaje Typst para el motor de composición de la app.
 * - Libro de imprenta (tamaño de página, márgenes espejo, capítulos, cabeceras…).
 * - Manuscrito estándar (formato Shunn) para agentes y concursos.
 * - Guion con formato de industria.
 * - Portada completa (contracubierta, lomo y cubierta) con sangrado.
 */
import type { Manifest, Settings } from "../types";
import { markdownBlocks, type Piece, type Run } from "./compile";
import { markdownToPlain } from "./markdown";
import { classify } from "./screenplay";
import { spineWidth, TRIMS } from "./model";
import { countWords } from "./words";

/** Escapa texto para el modo de marcado de Typst. */
export function esc(s: string): string {
  return s.replace(/[\\#*_`$<>@[\]~=\-+/"'{}]/g, (c) => "\\" + c);
}

/** Cadena para el modo código de Typst ("…"). */
export function str(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}

function runs(rs: Run[]): string {
  return rs
    .map((r) => {
      if (r.br) return "#linebreak()";
      let t = esc(r.text);
      if (r.strike) t = `#strike[${t}]`;
      if (r.italics) t = `#emph[${t}]`;
      if (r.bold) t = `#strong[${t}]`;
      return t;
    })
    .join("");
}

/** Bloques de Markdown → párrafos Typst. `leadIn`: versalitas en las primeras palabras. */
function body(md: string, sep: string, leadIn: { smallCaps: boolean; bigInitial: boolean } | null): string {
  const out: string[] = [];
  let first = leadIn;
  for (const b of markdownBlocks(md)) {
    if (b.type === "hr") {
      out.push(sep);
      continue;
    }
    if (b.type === "h") {
      out.push(`#align(center)[#emph[${runs(b.runs)}]]`);
      continue;
    }
    let content = runs(b.runs);
    if (first && b.type === "p" && b.runs.length && !b.runs[0].br) {
      content = leadInText(b.runs, first);
      first = null;
    }
    if (b.type === "quote") out.push(`#pad(x: 2em)[#emph[${content}]]`);
    else if (b.type === "li") out.push(`- ${content}`);
    else out.push(content);
  }
  return out.join("\n\n");
}

function leadInText(rs: Run[], o: { smallCaps: boolean; bigInitial: boolean }): string {
  const firstRun = rs[0];
  const text = firstRun.text;
  const m = /^(\s*[«“"¿¡—–-]*)(\p{L})/u.exec(text);
  if (!m) return runs(rs);
  let rest = text.slice(m[0].length);
  let initial = esc(m[1]) + (o.bigInitial ? `#text(size: 2.6em, baseline: 0.22em)[${esc(m[2])}]` : esc(m[2]));
  let caps = "";
  if (o.smallCaps) {
    const words = /^(\S*(?:\s+\S+){0,3})/u.exec(rest)?.[1] ?? "";
    const cut = words.search(/[,;:.!?]/);
    const lead = cut >= 0 ? words.slice(0, cut) : words;
    caps = lead ? `#smallcaps[${esc(lead)}]` : "";
    rest = rest.slice(lead.length);
  }
  if (!o.bigInitial && o.smallCaps) initial = `#smallcaps[${initial}]`;
  return initial + caps + runs([{ ...firstRun, text: rest }, ...rs.slice(1)]);
}

const STYLE_SEP = { classic: "⁂", modern: "•  •  •", romantic: "❦" };

export interface BookLabels {
  toc: string;
  rights: string;
  acknowledgments: string;
  about: string;
}

export function bookTypst(m: Manifest, pieces: Piece[], lang: string, labels: BookLabels): { source: string; files: Record<string, string> } {
  const p = m.publish;
  const trim = TRIMS.find((t) => t.id === p.trim) ?? TRIMS[3];
  const small = trim.w < 5.5;
  const sepText = m.compile.separator.trim() && m.compile.separator.trim() !== "* * *" ? m.compile.separator.trim() : STYLE_SEP[p.style];
  const sep = `#align(center)[#v(0.4em)${esc(sepText)}#v(0.4em)]`;
  const hasParts = pieces.some((x) => x.kind === "heading" && x.level >= 2);
  const year = new Date().getFullYear();

  const chapterTitle =
    p.style === "modern"
      ? `#text(size: 1.7em, weight: "bold")[#it.body]`
      : p.style === "romantic"
        ? `#text(size: 1.6em, style: "italic")[#it.body] \\ #v(0.3em) #text(size: 1.2em)[❧]`
        : `#text(size: 1.55em, tracking: 0.04em)[#smallcaps(it.body)] \\ #v(0.2em) #line(length: 18%, stroke: 0.5pt)`;

  const head: string[] = [
    `#set document(title: ${str(m.title)}, author: ${str(m.author || " ")})`,
    `#set text(font: (${str(p.font)}, "Libertinus Serif"), size: ${p.fontSize}pt, lang: ${str(lang)}, hyphenate: true)`,
    `#set par(justify: true, leading: ${(p.leading - 1 + 0.35).toFixed(2)}em, spacing: ${(p.leading - 1 + 0.35).toFixed(2)}em, first-line-indent: 1.3em)`,
    `#set page(width: ${trim.w}in, height: ${trim.h}in, margin: (inside: ${small ? 0.7 : 0.8}in, outside: ${small ? 0.5 : 0.6}in, top: 0.7in, bottom: 0.75in))`,
    `#let running = state("running", "")`,
    `#show heading: set text(weight: "regular")`,
    `#show heading.where(level: ${hasParts ? 2 : 1}): it => {
  pagebreak(weak: true${p.recto ? `, to: "odd"` : ""})
  running.update(it.body)
  v(18%)
  align(center, block(width: 100%)[${chapterTitle}])
  v(2.2em)
}`,
  ];
  if (hasParts)
    head.push(`#show heading.where(level: 1): it => {
  pagebreak(weak: true, to: "odd")
  v(30%)
  align(center)[#text(size: 2em, tracking: 0.06em)[#smallcaps(it.body)]]
}`);
  head.push(`#show heading.where(level: 3): it => align(center, block(above: 1.4em, below: 1em)[#emph(it.body)])`);

  const front: string[] = [`#set page(header: none, footer: none)`];
  if (p.halfTitle) front.push(`#v(28%)\n#align(center)[#text(size: 1.4em)[${esc(m.title)}]]\n#pagebreak()\n#pagebreak()`);
  front.push(
    `#v(22%)\n#align(center)[#text(size: 2.3em)[${esc(m.title)}]\n#v(1.4em)\n#text(size: 1.2em)[${esc(m.author)}]]${p.publisher ? `\n#place(bottom + center)[#text(size: 0.9em, tracking: 0.1em)[#smallcaps[${esc(p.publisher)}]]]` : ""}\n#pagebreak()`,
  );
  // Página de créditos (verso de la portada).
  const rights: string[] = [`© ${year} ${m.author}`];
  if (p.copyright.trim()) rights.push(p.copyright.trim());
  else rights.push(labels.rights);
  if (p.publisher.trim()) rights.push(p.publisher.trim());
  if (p.isbn.trim()) rights.push(`ISBN: ${p.isbn.trim()}`);
  front.push(`#align(bottom)[#set text(size: 0.8em)\n#set par(justify: false, first-line-indent: 0em)\n${rights.map(esc).join("\n\n")}]\n#pagebreak()`);
  if (p.dedication.trim())
    front.push(`#pagebreak(weak: true, to: "odd")\n#v(25%)\n#align(right)[#emph[${esc(p.dedication.trim())}]]\n#pagebreak()`);
  if (p.epigraph.trim())
    front.push(
      `#pagebreak(weak: true, to: "odd")\n#v(25%)\n#align(right)[#block(width: 70%)[#set par(justify: false)\n#align(left)[#emph[${esc(p.epigraph.trim())}]]\n${p.epigraphSource.trim() ? `#align(right)[— ${esc(p.epigraphSource.trim())}]` : ""}]]\n#pagebreak()`,
    );
  if (p.toc)
    front.push(
      `#pagebreak(weak: true, to: "odd")\n#v(12%)\n#align(center)[#text(size: 1.4em, tracking: 0.05em)[#smallcaps[${esc(labels.toc)}]]]\n#v(2em)\n#outline(title: none, depth: ${hasParts ? 2 : 1}, indent: auto)\n#pagebreak()`,
    );

  // La última página de cortesía no fuerza otra en blanco: el cuerpo empieza en impar.
  front[front.length - 1] = front[front.length - 1].replace(/\n#pagebreak\(\)$/, "");
  const bodyHead = [
    `#pagebreak(to: "odd")`,
    // Página en blanco: la siguiente abre capítulo y en esta no termina ninguno.
    `#let page-info() = {
  let pg = here().page()
  let hs = query(heading).filter(h => h.level <= ${hasParts ? 2 : 1})
  let starts = hs.filter(h => h.location().page() == pg).len() > 0
  let next = hs.filter(h => h.location().page() == pg + 1).len() > 0
  let ends = query(<chend>).filter(e => e.location().page() == pg).len() > 0
  (starts: starts, blank: next and not ends and not starts)
}`,
    `#set page(${p.headers
      ? `header: context {
  let info = page-info()
  if not info.starts and not info.blank {
    set text(size: 0.78em, tracking: 0.08em)
    if calc.even(here().page()) { align(left, smallcaps(${str(m.author || m.title)})) } else { align(right, smallcaps(running.get())) }
  }
},
`
      : "header: none,\n"}footer: context { if not page-info().blank { align(center, text(size: 0.85em, counter(page).display())) } })`,
    `#counter(page).update(1)`,
  ];
  const END = `#metadata(none) <chend>`;

  const parts: string[] = [];
  let lead = true;
  for (const x of pieces) {
    if (x.kind === "heading") {
      // El glosario y lo que va detrás son capítulos aunque el libro tenga partes.
      const level = x.back && hasParts ? 2 : Math.min(3, x.level);
      if (level <= (hasParts ? 2 : 1)) parts.push(END);
      parts.push(`${"=".repeat(level)} ${esc(x.text)}`);
      lead = level <= (hasParts ? 2 : 1);
    } else if (x.kind === "break") {
      parts.push(sep);
      lead = false;
    } else {
      parts.push(body(x.md, sep, lead && (p.dropCaps || p.smallCaps) ? { smallCaps: p.smallCaps, bigInitial: p.dropCaps } : null));
      lead = false;
    }
  }
  const back: string[] = [];
  if (p.acknowledgments.trim()) back.push(`${END}\n\n${hasParts ? "==" : "="} ${esc(labels.acknowledgments)}\n\n${esc(p.acknowledgments.trim()).replace(/\n\n+/g, "\n\n")}`);
  if (p.aboutAuthor.trim()) back.push(`${END}\n\n${hasParts ? "==" : "="} ${esc(labels.about)}\n\n${esc(p.aboutAuthor.trim()).replace(/\n\n+/g, "\n\n")}`);

  return { source: [...head, ...front, ...bodyHead, ...parts, ...back, END].join("\n\n") + "\n", files: {} };
}

/** Manuscrito estándar (Shunn): Courier 12, doble espacio, datos de contacto y cabecera. */
export function manuscriptTypst(m: Manifest, pieces: Piece[], s: Settings, opts: { paper: "a4" | "us-letter"; font: string }, lang: string, end: string, by: string, words: string): string {
  const total = pieces.reduce((n, x) => n + (x.kind === "text" ? countWords(markdownToPlain(x.md)) : 0), 0);
  const rounded = total < 100 ? total : total < 20000 ? Math.round(total / 100) * 100 : Math.round(total / 1000) * 1000;
  const surname = (s.contact.legalName || m.author).trim().split(/\s+/).slice(-1)[0] || m.author;
  const shortTitle = m.title.split(/\s+/).slice(0, 4).join(" ").toUpperCase();
  const contact = [s.contact.legalName || m.author, ...s.contact.address.split("\n"), s.contact.email, s.contact.phone].filter((x) => x && x.trim());
  const out: string[] = [
    `#set document(title: ${str(m.title)}, author: ${str(m.author || " ")})`,
    `#set page(paper: ${str(opts.paper)}, margin: 1in, header: context { if here().page() > 1 { align(right, text(size: 12pt)[${esc(surname)} / ${esc(shortTitle)} / #counter(page).display()]) } })`,
    `#set text(font: (${str(opts.font)}, "Courier New", "DejaVu Sans Mono"), size: 12pt, lang: ${str(lang)}, hyphenate: false)`,
    `#set par(justify: false, leading: 1.15em, spacing: 1.15em, first-line-indent: 0.5in)`,
    `#show heading: it => { pagebreak(weak: true); v(2.5in); align(center, text(size: 12pt, weight: "regular", upper(it.body))); v(1em) }`,
    `#grid(columns: (1fr, auto), [${contact.map(esc).join(" \\\n")}], [${esc(words.replace("{n}", rounded.toLocaleString(lang === "es" ? "es-ES" : "en-US")))}])`,
    `#v(2.6in)\n#align(center)[${esc(m.title.toUpperCase())} \\ #v(1em) ${esc(by)} ${esc(m.author)}]\n#v(1.5em)`,
  ];
  let first = true;
  for (const x of pieces) {
    if (x.kind === "heading") {
      out.push(first ? `#align(center)[${esc(x.text.toUpperCase())}]\n#v(1em)` : `= ${esc(x.text)}`);
    } else if (x.kind === "break") out.push(`#align(center)[\\#]`);
    else out.push(body(x.md, `#align(center)[\\#]`, null));
    first = false;
  }
  out.push(`#v(1em)\n#align(center)[${esc(end)}]`);
  return out.join("\n\n") + "\n";
}

/** Guion: Courier 12, márgenes de industria y cada elemento en su sitio. */
export function screenplayTypst(m: Manifest, paragraphs: string[], by: string): string {
  const types = classify(paragraphs);
  const out: string[] = [
    `#set document(title: ${str(m.title)}, author: ${str(m.author || " ")})`,
    `#set page(paper: "us-letter", margin: (left: 1.5in, right: 1in, top: 1in, bottom: 1in), header: context { if here().page() > 1 { align(right)[#counter(page).display().] } })`,
    `#set text(font: ("Courier New", "Courier Prime", "DejaVu Sans Mono"), size: 12pt, hyphenate: false)`,
    `#set par(justify: false, leading: 0.65em, spacing: 1em, first-line-indent: 0em)`,
    `#v(3in)\n#align(center)[#upper[${esc(m.title)}] \\ #v(1em) ${esc(by)} \\ ${esc(m.author)}]\n#pagebreak()`,
  ];
  paragraphs.forEach((raw, i) => {
    const t = raw.trim();
    if (!t) return;
    const e = esc(t.replace(/^[.@>]\s*/, "").replace(/<$/, ""));
    switch (types[i]) {
      case "scene":
        out.push(`#block(above: 1.6em, below: 1em, sticky: true)[#strong[#upper[${e}]]]`);
        break;
      case "character":
        out.push(`#block(above: 1em, below: 0em, sticky: true)[#pad(left: 2.2in)[#upper[${e}]]]`);
        break;
      case "paren":
        out.push(`#block(above: 0em, below: 0em, sticky: true)[#pad(left: 1.6in, right: 1.9in)[${e}]]`);
        break;
      case "dialogue":
        out.push(`#block(above: 0em)[#pad(left: 1in, right: 1.5in)[${e}]]`);
        break;
      case "transition":
        out.push(`#align(right)[#upper[${e}]]`);
        break;
      case "center":
        out.push(`#align(center)[${e}]`);
        break;
      default:
        out.push(e);
    }
  });
  return out.join("\n\n") + "\n";
}

/** Portada completa para imprenta: contracubierta + lomo + cubierta, con 0,125″ de sangrado. */
export function coverTypst(m: Manifest, files: { front?: string; back?: string }): { source: string; spine: number; width: number; height: number } {
  const c = m.cover;
  const trim = TRIMS.find((t) => t.id === m.publish.trim) ?? TRIMS[3];
  const bleed = 0.125;
  const spine = spineWidth(c.pages, c.paper);
  const width = trim.w * 2 + spine + bleed * 2;
  const height = trim.h + bleed * 2;
  const panel = (x: number, w: number, content: string) => `#place(top + left, dx: ${x.toFixed(4)}in, dy: 0in, block(width: ${w.toFixed(4)}in, height: ${height}in)[${content}])`;
  const img = (name: string) => `#image(${str(name)}, width: 100%, height: 100%, fit: "cover")`;
  const out: string[] = [
    `#set page(width: ${width.toFixed(4)}in, height: ${height}in, margin: 0in, fill: rgb(${str(c.bg)}))`,
    `#set text(font: (${str(m.publish.font)}, "Libertinus Serif"), fill: rgb(${str(c.fg)}))`,
  ];
  // Contracubierta.
  out.push(panel(0, bleed + trim.w, files.back ? img("back") : ""));
  out.push(
    panel(
      bleed + 0.6,
      trim.w - 1.2,
      `#v(1.1in)\n#set par(justify: true, leading: 0.7em)\n#text(size: 11pt)[${esc(c.blurb || m.publish.description).replace(/\n\n+/g, "\n\n")}]\n#place(bottom + right, dy: -0.6in)[#rect(width: 2in, height: 1.2in, fill: white, stroke: none)]`,
    ),
  );
  // Lomo: texto girado si hay sitio (a partir de unas 100 páginas).
  if (c.showSpine && spine >= 0.25)
    out.push(
      panel(
        bleed + trim.w,
        spine,
        `#align(center + horizon)[#rotate(90deg, reflow: true)[#text(size: ${Math.min(13, spine * 40).toFixed(1)}pt, tracking: 0.08em)[#smallcaps[${esc(m.title)}]#h(1.4em)${esc(m.author)}]]]`,
      ),
    );
  // Cubierta.
  const fx = bleed + trim.w + spine;
  out.push(panel(fx, trim.w + bleed, files.front ? img("front") : ""));
  out.push(
    panel(
      fx + 0.4,
      trim.w - 0.8,
      `#v(1.2in)\n#align(center)[#text(size: ${c.titleSize}pt, weight: "bold")[${esc(m.title)}]]\n#place(bottom + center, dy: -0.9in)[#text(size: 18pt, tracking: 0.12em)[#upper[${esc(m.author)}]]]`,
    ),
  );
  return { source: out.join("\n") + "\n", spine, width, height };
}
