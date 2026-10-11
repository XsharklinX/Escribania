import { describe, expect, it } from "vitest";
import { generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { docToMarkdown, markdownToHtml, markdownToPlain } from "./markdown";
import { countWords } from "./words";

const ext = [StarterKit.configure({ code: false, codeBlock: false, link: false, underline: false })];

/** Markdown → editor → Markdown, como al abrir y guardar un texto. */
const roundTrip = (md: string) => docToMarkdown(generateJSON(markdownToHtml(md), ext) as never);

describe("markdown", () => {
  it("conserva un texto de novela", () => {
    const md = [
      "La marea había subido **antes de lo previsto**, y con ella llegó el olor a *gasoil y a algas*.",
      "—No puede ser —dijo en voz alta.",
      "* * *",
      "## Capítulo 2",
      "> Una cita en dos líneas",
      "- uno\n- dos",
      "1. primero\n2. segundo",
      "Una línea\\\nsegunda línea con ~~tachado~~.",
    ].join("\n\n") + "\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("escapa lo que se confundiría con formato", () => {
    const md = roundTrip("\\# no es título\n\n1\\. no es lista\n\nun \\*asterisco\\* suelto\n");
    expect(md).toBe("\\# no es título\n\n1\\. no es lista\n\nun \\*asterisco\\* suelto\n");
    expect(markdownToHtml(md)).not.toContain("<h1>");
  });

  it("no deja espacios dentro de las marcas", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Dijo " },
            { type: "text", text: "muy bajo ", marks: [{ type: "italic" }] },
            { type: "text", text: "que ", marks: [{ type: "italic" }, { type: "bold" }] },
            { type: "text", text: "no." },
          ],
        },
      ],
    };
    expect(docToMarkdown(doc)).toBe("Dijo *muy bajo* ***que*** no.\n");
  });

  it("documento vacío", () => {
    expect(roundTrip("")).toBe("");
  });

  it("texto plano y palabras", () => {
    expect(markdownToPlain("Hola **mundo**\n\n* * *\n\nAdiós")).toBe("Hola mundo\n\n* * *\n\nAdiós");
    expect(countWords("—No puede ser —dijo en voz alta.")).toBe(7);
    expect(countWords("* * *  \n ")).toBe(0);
  });
});
