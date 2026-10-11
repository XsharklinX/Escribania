/**
 * Compilar el libro: recorre el Manuscrito en orden (solo lo marcado "Incluir")
 * y lo convierte en una lista de piezas que luego se escriben a cada formato.
 */
import type { Paragraph as DocxParagraph } from "docx";
import type { CompileOptions, Manifest, TreeNode } from "../types";
import { stripTodos } from "./todos";
import { acceptChanges, escapeInline, markdownToHtml, markdownToPlain, markdownTokens, stripComments } from "./markdown";

export type Piece =
  | { kind: "heading"; level: number; text: string; chapterStart: boolean; back?: boolean }
  | { kind: "text"; md: string; screenplay?: boolean; id?: string }
  | { kind: "break" };

/**
 * `keepReview`: conservar comentarios y control de cambios (para Word en revisión).
 * Si no, los comentarios se quitan y los cambios se dan por aceptados.
 */
export async function collectPieces(
  m: Manifest,
  opts: CompileOptions,
  read: (file: string) => Promise<string>,
  glossaryTitle = "Glosario",
  keepReview = false,
): Promise<{ pieces: Piece[]; texts: number }> {
  const pieces: Piece[] = [];
  let texts = 0;
  const visit = async (list: TreeNode[], depth: number) => {
    let prevText = false;
    for (const n of list) {
      if (!n.include) continue;
      if (n.type === "folder") {
        if (opts.folderTitles) pieces.push({ kind: "heading", level: Math.min(depth + 1, 3), text: n.title, chapterStart: true });
        await visit(n.children ?? [], opts.folderTitles ? depth + 1 : depth);
        prevText = false;
      } else if (n.type === "text" && n.file) {
        // Los comentarios de Marginalia nunca salen en el libro y los cambios se aceptan.
        const raw = (await read(n.file)).trim();
        // Los pendientes (TODO, REVISAR…) son notas del autor: tampoco salen.
        const md = keepReview ? raw : stripTodos(acceptChanges(stripComments(raw))).trim();
        if (opts.textTitles) {
          pieces.push({ kind: "heading", level: Math.min(depth + 1, 3), text: n.title, chapterStart: !opts.folderTitles || depth === 0 });
        } else if (prevText && opts.separator.trim()) {
          pieces.push({ kind: "break" });
        }
        if (md) pieces.push({ kind: "text", md, screenplay: n.screenplay, id: n.id });
        texts++;
        prevText = true;
      }
    }
  };
  await visit(m.sections.manuscript, 0);
  // Glosario al final: los términos del Códice con su definición.
  const terms = (m.codex ?? []).filter((e) => e.kind === "term" && e.name.trim()).sort((a, b) => a.name.localeCompare(b.name));
  if (opts.glossary && terms.length) {
    pieces.push({ kind: "heading", level: 1, text: glossaryTitle, chapterStart: true, back: true });
    const lines: string[] = [];
    for (const e of terms) {
      const def = (await read(e.file)).trim().replace(/\n+/g, " ");
      lines.push(`**${escapeInline(e.name)}**${def ? ". " + def : ""}`);
    }
    pieces.push({ kind: "text", md: lines.join("\n\n") });
  }
  return { pieces, texts };
}

// ---------------- Markdown / texto / HTML ----------------

export function toMarkdown(m: Manifest, opts: CompileOptions, pieces: Piece[]): string {
  const out: string[] = [];
  if (opts.titlePage) out.push(`# ${m.title}`, m.author ? `*${m.author}*` : "");
  for (const p of pieces) {
    if (p.kind === "heading") out.push("#".repeat(p.level + (opts.titlePage ? 1 : 0)) + " " + p.text);
    else if (p.kind === "break") out.push(opts.separator);
    else out.push(p.md);
  }
  return out.filter((s) => s !== "").join("\n\n") + "\n";
}

export function toPlainText(m: Manifest, opts: CompileOptions, pieces: Piece[]): string {
  const out: string[] = [];
  if (opts.titlePage) out.push(m.title.toUpperCase(), m.author, "", "");
  for (const p of pieces) {
    if (p.kind === "heading") out.push("", p.text, "");
    else if (p.kind === "break") out.push(opts.separator);
    else out.push(markdownToPlain(p.md));
  }
  return out.join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function toHtml(m: Manifest, opts: CompileOptions, pieces: Piece[]): string {
  const body: string[] = [];
  if (opts.titlePage) body.push(`<header class="title"><h1>${esc(m.title)}</h1>${m.author ? `<p>${esc(m.author)}</p>` : ""}</header>`);
  for (const p of pieces) {
    if (p.kind === "heading") body.push(`<h${p.level + 1}${p.chapterStart ? ' class="chapter"' : ""}>${esc(p.text)}</h${p.level + 1}>`);
    else if (p.kind === "break") body.push(`<p class="sep">${esc(opts.separator)}</p>`);
    else body.push(markdownToHtml(p.md).replace(/<hr>/g, `<p class="sep">${esc(opts.separator || "* * *")}</p>`));
  }
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title>
<style>
body{max-width:36em;margin:3em auto;padding:0 1.2em;font:1.15rem/1.7 Georgia,"Times New Roman",serif;color:#222;background:#fdfcf8}
header.title{text-align:center;margin:4em 0 6em}header.title h1{font-size:2.4em;font-weight:normal;margin:0}
h2,h3,h4{text-align:center;font-weight:normal;margin:3em 0 1.5em}.chapter{break-before:page}
p{margin:0;text-indent:1.5em;text-align:justify;hyphens:auto}h2+p,h3+p,h4+p,.sep+p{text-indent:0}
.sep{text-align:center;text-indent:0;margin:1.5em 0}blockquote{margin:1em 2em;font-style:italic}
</style></head><body>
${body.join("\n")}
</body></html>
`;
}

// ---------------- Word (.docx) ----------------

export interface Run {
  text: string;
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  br?: boolean;
  ins?: boolean;
  del?: boolean;
  comment?: string;
}

export type Block = { type: "p" | "quote" | "li"; runs: Run[] } | { type: "h"; level: number; runs: Run[] } | { type: "hr" };

/** Markdown → bloques con trozos de texto formateados (para Word). */
export function markdownBlocks(md: string): Block[] {
  const tokens = markdownTokens(md);
  const out: Block[] = [];
  let quote = 0;
  let inItem = false;
  let heading = 0;
  for (const tk of tokens) {
    if (tk.type === "blockquote_open") quote++;
    else if (tk.type === "blockquote_close") quote--;
    else if (tk.type === "list_item_open") inItem = true;
    else if (tk.type === "list_item_close") inItem = false;
    else if (tk.type === "heading_open") heading = Number(tk.tag.slice(1));
    else if (tk.type === "heading_close") heading = 0;
    else if (tk.type === "hr") out.push({ type: "hr" });
    else if (tk.type === "inline") {
      const runs: Run[] = [];
      const st: Omit<Run, "text"> = { bold: false, italics: false, strike: false, ins: false, del: false, comment: undefined };
      for (const c of tk.children ?? []) {
        if (c.type === "ins_open") st.ins = true;
        else if (c.type === "ins_close") st.ins = false;
        else if (c.type === "del_open") st.del = true;
        else if (c.type === "del_close") st.del = false;
        else if (c.type === "comment_open") st.comment = c.attrGet("data-comment") != null ? String(c.attrGet("data-comment")) : undefined;
        else if (c.type === "comment_close") st.comment = undefined;
        else if (c.type === "strong_open") st.bold = true;
        else if (c.type === "strong_close") st.bold = false;
        else if (c.type === "em_open") st.italics = true;
        else if (c.type === "em_close") st.italics = false;
        else if (c.type === "s_open") st.strike = true;
        else if (c.type === "s_close") st.strike = false;
        else if (c.type === "hardbreak") runs.push({ text: "", br: true });
        else if (c.type === "softbreak") runs.push({ text: " " });
        else if (c.type === "text" && c.content) runs.push({ text: c.content, ...st });
      }
      if (heading) out.push({ type: "h", level: heading, runs });
      else out.push({ type: quote ? "quote" : inItem ? "li" : "p", runs });
    }
  }
  return out;
}

export async function toDocx(m: Manifest, opts: CompileOptions, pieces: Piece[]): Promise<Uint8Array> {
  // La librería de Word pesa; se carga solo al exportar.
  const { AlignmentType, Document, HeadingLevel, LineRuleType, Packer, PageBreak, Paragraph, TextRun } = await import("docx");
  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const ms = opts.manuscriptFormat;
  const font = ms ? "Courier New" : opts.font || "Times New Roman";
  const size = 24; // 12 pt
  const line = ms ? 480 : 360; // doble espacio o 1,5
  const children: DocxParagraph[] = [];
  const runs = (rs: Run[]) =>
    rs.map((r) => (r.br ? new TextRun({ text: "", break: 1 }) : new TextRun({ text: r.text, bold: r.bold, italics: r.italics, strike: r.strike })));

  if (opts.titlePage) {
    children.push(new Paragraph({ spacing: { before: 3600 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: m.title, size: 48 })] }));
    if (m.author) children.push(new Paragraph({ spacing: { before: 480 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: m.author, size: 28 })] }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  let firstAfterBreak = true;
  let firstChapter = true;
  for (const p of pieces) {
    if (p.kind === "heading") {
      const pageBreak = opts.chapterPageBreak && p.chapterStart && !firstChapter;
      firstChapter = false;
      children.push(
        new Paragraph({
          heading: HEADINGS[Math.min(p.level, 3) - 1],
          alignment: AlignmentType.CENTER,
          pageBreakBefore: pageBreak,
          spacing: { before: p.level === 1 ? 1440 : 720, after: 480 },
          children: [new TextRun({ text: p.text })],
        }),
      );
      firstAfterBreak = true;
    } else if (p.kind === "break") {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new TextRun(opts.separator)] }));
      firstAfterBreak = true;
    } else {
      for (const b of markdownBlocks(p.md)) {
        if (b.type === "hr") {
          children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new TextRun(opts.separator || "* * *")] }));
          firstAfterBreak = true;
        } else if (b.type === "h") {
          children.push(new Paragraph({ heading: HEADINGS[Math.min(b.level, 3) - 1], children: runs(b.runs) }));
          firstAfterBreak = true;
        } else {
          children.push(
            new Paragraph({
              children: runs(b.runs),
              alignment: ms ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
              indent: b.type === "quote" ? { left: 720, right: 720 } : firstAfterBreak ? undefined : { firstLine: 567 },
              bullet: b.type === "li" ? { level: 0 } : undefined,
            }),
          );
          firstAfterBreak = false;
        }
      }
    }
  }

  const doc = new Document({
    creator: m.author || "Escribanía",
    title: m.title,
    styles: {
      default: {
        document: { run: { font, size }, paragraph: { spacing: { line, lineRule: LineRuleType.AUTO } } },
        heading1: { run: { font, size: 36 } },
        heading2: { run: { font, size: 30 } },
        heading3: { run: { font, size: 26, italics: true } },
      },
    },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
