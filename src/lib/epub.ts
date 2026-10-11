/** Imprenta: capítulos XHTML y hoja de estilos para el EPUB 3 que arma el núcleo. */
import MarkdownIt from "markdown-it";
import type { Manifest } from "../types";
import type { Piece } from "./compile";

const xmd = new MarkdownIt({ html: false, xhtmlOut: true, typographer: false });
xmd.disable(["code", "fence", "table", "image", "link", "autolink", "html_inline", "html_block", "reference", "backticks"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface EpubChapter {
  title: string;
  body: string;
  in_toc: boolean;
  kind: string;
}

const CSS: Record<Manifest["publish"]["style"], string> = {
  classic: `h1,h2{font-weight:normal;text-align:center;font-variant:small-caps;letter-spacing:.05em;margin:3em 0 2em}`,
  modern: `h1,h2{font-weight:bold;text-align:left;margin:2.5em 0 1.5em;font-family:sans-serif}`,
  romantic: `h1,h2{font-weight:normal;font-style:italic;text-align:center;margin:3em 0 2em}h1:after,h2:after{content:" ❧";display:block;font-style:normal;margin-top:.4em}`,
};

export function epubCss(m: Manifest): string {
  return `body{font-family:serif;line-height:1.5;margin:0 5%}
p{margin:0;text-indent:1.4em;text-align:justify;hyphens:auto;-webkit-hyphens:auto}
h1+p,h2+p,h3+p,.sep+p,blockquote+p,.first{text-indent:0}
.sep{text-align:center;text-indent:0;margin:1.2em 0}
blockquote{margin:1em 2em;font-style:italic}
h3{font-style:italic;font-weight:normal;text-align:center}
.title{text-align:center;margin-top:30%}.title h1{font-size:2em;margin:0}.title .author{text-indent:0;text-align:center;margin-top:1.5em;font-size:1.2em}
.rights p,.center p{text-indent:0;text-align:center;font-size:.85em}
.dedication{margin-top:30%;text-align:right;font-style:italic}.dedication p{text-indent:0;text-align:right}
.epigraph{margin:30% 0 0 30%;font-style:italic}.epigraph p{text-indent:0;text-align:left}.epigraph .src{text-align:right;font-style:normal}
.cover{text-align:center;margin:0}.cover img{max-width:100%;max-height:100vh}
.lead{font-variant:small-caps;letter-spacing:.04em}
${CSS[m.publish.style]}
`;
}

function paragraphs(md: string, sep: string): string {
  return xmd
    .render(md)
    .replace(/<hr \/>/g, `<p class="sep">${esc(sep)}</p>`);
}

/** Primer párrafo del capítulo sin sangría y con versalitas en las primeras palabras. */
function leadIn(html: string, smallCaps: boolean): string {
  return html.replace(/^<p>([^<]*)/, (_m, text: string) => {
    if (!smallCaps) return `<p class="first">${text}`;
    const words = /^(\S+(?:\s+\S+){0,3})/.exec(text)?.[1] ?? "";
    const cut = words.search(/[,;:.!?]/);
    const lead = cut >= 0 ? words.slice(0, cut) : words;
    return `<p class="first"><span class="lead">${lead}</span>${text.slice(lead.length)}`;
  });
}

export function epubChapters(m: Manifest, pieces: Piece[], labels: { rights: string; acknowledgments: string; about: string }): EpubChapter[] {
  const p = m.publish;
  const sep = m.compile.separator.trim() || "* * *";
  const out: EpubChapter[] = [];
  const year = new Date().getFullYear();
  out.push({
    title: m.title,
    in_toc: false,
    kind: "frontmatter titlepage",
    body: `<section class="title"><h1>${esc(m.title)}</h1><p class="author">${esc(m.author)}</p>${p.publisher ? `<p class="author">${esc(p.publisher)}</p>` : ""}</section>`,
  });
  const rights = [`© ${year} ${m.author}`, p.copyright.trim() || labels.rights, p.publisher.trim(), p.isbn.trim() ? `ISBN: ${p.isbn.trim()}` : ""].filter(Boolean);
  out.push({ title: "©", in_toc: false, kind: "frontmatter copyright-page", body: `<section class="rights">${rights.map((r) => `<p>${esc(r)}</p>`).join("")}</section>` });
  if (p.dedication.trim()) out.push({ title: "", in_toc: false, kind: "frontmatter dedication", body: `<section class="dedication"><p>${esc(p.dedication.trim())}</p></section>` });
  if (p.epigraph.trim())
    out.push({
      title: "",
      in_toc: false,
      kind: "frontmatter epigraph",
      body: `<section class="epigraph"><p>${esc(p.epigraph.trim())}</p>${p.epigraphSource.trim() ? `<p class="src">— ${esc(p.epigraphSource.trim())}</p>` : ""}</section>`,
    });

  // Un archivo por capítulo: se corta en cada título del nivel más alto.
  const top = Math.min(...pieces.filter((x) => x.kind === "heading").map((x) => (x as { level: number }).level), 9);
  let cur: EpubChapter | null = null;
  let lead = false;
  const flush = () => {
    if (cur && cur.body.trim()) out.push(cur);
    cur = null;
  };
  for (const x of pieces) {
    if (x.kind === "heading") {
      const tag = `h${Math.min(3, x.level - top + 1)}`;
      if (x.level === top) {
        flush();
        cur = { title: x.text, in_toc: true, kind: "bodymatter chapter", body: "" };
      }
      cur = cur ?? { title: x.text, in_toc: true, kind: "bodymatter chapter", body: "" };
      cur.body += `<${tag}>${esc(x.text)}</${tag}>\n`;
      lead = true;
    } else if (x.kind === "break") {
      cur = cur ?? { title: m.title, in_toc: false, kind: "bodymatter", body: "" };
      cur.body += `<p class="sep">${esc(sep)}</p>\n`;
      lead = false;
    } else {
      cur = cur ?? { title: m.title, in_toc: false, kind: "bodymatter", body: "" };
      const html = paragraphs(x.md, sep);
      cur.body += (lead ? leadIn(html, p.smallCaps) : html) + "\n";
      lead = false;
    }
  }
  flush();
  const prose = (title: string, text: string, kind: string) => ({
    title,
    in_toc: true,
    kind,
    body: `<h1>${esc(title)}</h1>\n${text
      .trim()
      .split(/\n\n+/)
      .map((t) => `<p>${esc(t)}</p>`)
      .join("\n")}`,
  });
  if (p.acknowledgments.trim()) out.push(prose(labels.acknowledgments, p.acknowledgments, "backmatter acknowledgments"));
  if (p.aboutAuthor.trim()) out.push(prose(labels.about, p.aboutAuthor, "backmatter"));
  return out;
}
