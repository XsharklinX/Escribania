/**
 * Word para el mundo editorial:
 * - Manuscrito estándar (Shunn) con datos de contacto, recuento y cabecera.
 * - Copia de revisión con comentarios de Marginalia y control de cambios del Lápiz rojo.
 * - Kit de envío (sinopsis, carta, biografía).
 */
import type { Comment, Kit, Manifest, Settings } from "../types";
import { markdownBlocks, type Piece, type Run } from "./compile";
import { markdownToPlain } from "./markdown";
import { countWords } from "./words";

async function lib() {
  return import("docx");
}

export async function manuscriptDocx(m: Manifest, pieces: Piece[], s: Settings, l: { by: string; words: string; end: string }, lang: string): Promise<Uint8Array> {
  const d = await lib();
  const font = "Courier New";
  const total = pieces.reduce((n, x) => n + (x.kind === "text" ? countWords(markdownToPlain(x.md)) : 0), 0);
  const rounded = total < 100 ? total : total < 20000 ? Math.round(total / 100) * 100 : Math.round(total / 1000) * 1000;
  const surname = (s.contact.legalName || m.author).trim().split(/\s+/).slice(-1)[0] || m.author;
  const shortTitle = m.title.split(/\s+/).slice(0, 4).join(" ").toUpperCase();
  const contact = [s.contact.legalName || m.author, ...s.contact.address.split("\n"), s.contact.email, s.contact.phone].filter((x) => x && x.trim());
  const P = (opts: ConstructorParameters<typeof d.Paragraph>[0]) => new d.Paragraph(opts);
  const runs = (rs: Run[]) => rs.map((r) => (r.br ? new d.TextRun({ text: "", break: 1 }) : new d.TextRun({ text: r.text, italics: r.italics, bold: r.bold, strike: r.strike })));
  const children: InstanceType<typeof d.Paragraph>[] = [];
  // Primera página: contacto a la izquierda, palabras a la derecha, título a media página.
  contact.forEach((c, i) =>
    children.push(
      P({
        spacing: { line: 240 },
        tabStops: [{ type: d.TabStopType.RIGHT, position: 9360 }],
        children: [new d.TextRun(c), ...(i === 0 ? [new d.TextRun({ text: "\t" + l.words.replace("{n}", rounded.toLocaleString(lang === "es" ? "es-ES" : "en-US")) })] : [])],
      }),
    ),
  );
  children.push(P({ spacing: { before: 4000 }, alignment: d.AlignmentType.CENTER, children: [new d.TextRun(m.title.toUpperCase())] }));
  children.push(P({ alignment: d.AlignmentType.CENTER, spacing: { after: 480 }, children: [new d.TextRun(`${l.by} ${m.author}`)] }));
  let first = true;
  for (const x of pieces) {
    if (x.kind === "heading") {
      children.push(P({ pageBreakBefore: !first, spacing: { before: first ? 240 : 3600, after: 480 }, alignment: d.AlignmentType.CENTER, children: [new d.TextRun(x.text.toUpperCase())] }));
    } else if (x.kind === "break") {
      children.push(P({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun("#")] }));
    } else {
      for (const b of markdownBlocks(x.md)) {
        if (b.type === "hr") children.push(P({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun("#")] }));
        else if (b.type !== "h") children.push(P({ indent: { firstLine: 720 }, children: runs(b.runs) }));
      }
    }
    first = false;
  }
  children.push(P({ alignment: d.AlignmentType.CENTER, spacing: { before: 480 }, children: [new d.TextRun(l.end)] }));

  const doc = new d.Document({
    creator: m.author,
    title: m.title,
    styles: { default: { document: { run: { font, size: 24 }, paragraph: { spacing: { line: 480, lineRule: d.LineRuleType.AUTO } } } } },
    sections: [
      {
        properties: { titlePage: true, page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: {
          first: new d.Header({ children: [] }),
          default: new d.Header({
            children: [P({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun(`${surname} / ${shortTitle} / `), new d.TextRun({ children: [d.PageNumber.CURRENT] })] })],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer());
}

/** Copia para revisar en Word: los comentarios y los cambios siguen vivos. */
export async function reviewDocx(m: Manifest, pieces: Piece[], comments: Record<string, Comment[]>): Promise<Uint8Array> {
  const d = await lib();
  const all = new Map<string, Comment>();
  for (const list of Object.values(comments)) for (const c of list) all.set(c.id, c);
  const numeric = new Map<string, number>();
  const idFor = (cid: string) => {
    if (!numeric.has(cid)) numeric.set(cid, numeric.size + 1);
    return numeric.get(cid)!;
  };
  let changeId = 1;
  const date = new Date().toISOString();
  const children: InstanceType<typeof d.Paragraph>[] = [];
  const paragraph = (rs: Run[], extra: Partial<ConstructorParameters<typeof d.Paragraph>[0] & object> = {}) => {
    const kids: unknown[] = [];
    let open: string | undefined;
    for (const r of rs) {
      if (r.comment !== open) {
        if (open) {
          kids.push(new d.CommentRangeEnd(idFor(open)), new d.TextRun({ children: [new d.CommentReference(idFor(open))] }));
        }
        if (r.comment && all.has(r.comment)) kids.push(new d.CommentRangeStart(idFor(r.comment)));
        open = r.comment && all.has(r.comment) ? r.comment : undefined;
      }
      if (r.br) kids.push(new d.TextRun({ text: "", break: 1 }));
      else if (r.ins) kids.push(new d.InsertedTextRun({ text: r.text, id: changeId++, author: m.author || "Escribanía", date, italics: r.italics, bold: r.bold }));
      else if (r.del) kids.push(new d.DeletedTextRun({ text: r.text, id: changeId++, author: m.author || "Escribanía", date, italics: r.italics, bold: r.bold }));
      else kids.push(new d.TextRun({ text: r.text, italics: r.italics, bold: r.bold, strike: r.strike }));
    }
    if (open) kids.push(new d.CommentRangeEnd(idFor(open)), new d.TextRun({ children: [new d.CommentReference(idFor(open))] }));
    return new d.Paragraph({ ...extra, children: kids as never });
  };
  for (const x of pieces) {
    if (x.kind === "heading") children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun(x.text)] }));
    else if (x.kind === "break") children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun("* * *")] }));
    else
      for (const b of markdownBlocks(x.md)) {
        if (b.type === "hr") children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun("* * *")] }));
        else children.push(paragraph(b.runs, b.type === "h" ? { heading: d.HeadingLevel.HEADING_3 } : { indent: { firstLine: 567 } }));
      }
  }
  const doc = new d.Document({
    creator: m.author,
    title: m.title,
    comments: {
      children: [...numeric.entries()].map(([cid, n]) => {
        const c = all.get(cid)!;
        return { id: n, author: c.author || m.author, date: new Date(c.created), children: [new d.Paragraph({ children: [new d.TextRun(c.text)] })] };
      }),
    },
    styles: { default: { document: { run: { font: "Times New Roman", size: 24 }, paragraph: { spacing: { line: 360 } } } } },
    sections: [{ children }],
  });
  return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer());
}

export async function kitDocx(m: Manifest, kit: Kit, labels: Record<keyof Kit, string>): Promise<Uint8Array> {
  const d = await lib();
  const children: InstanceType<typeof d.Paragraph>[] = [
    new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(m.title)] }),
    new d.Paragraph({ children: [new d.TextRun({ text: m.author, italics: true })] }),
  ];
  for (const k of ["logline", "shortSynopsis", "longSynopsis", "query", "comps", "bio"] as (keyof Kit)[]) {
    if (!kit[k].trim()) continue;
    children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun(labels[k])] }));
    for (const p of kit[k].trim().split(/\n\n+/)) children.push(new d.Paragraph({ spacing: { after: 160 }, children: [new d.TextRun(p.replace(/\n/g, " "))] }));
  }
  const doc = new d.Document({ creator: m.author, title: m.title, styles: { default: { document: { run: { font: "Times New Roman", size: 24 } } } }, sections: [{ children }] });
  return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer());
}
