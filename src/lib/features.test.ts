import { describe, expect, it } from "vitest";
import { generateJSON, getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { docToMarkdown, escapeInline, markdownToHtml, stripComments } from "./markdown";
import { CommentMark, findAll, mentionedIn, searchRegex } from "./editorExtensions";
import { collectPieces, toMarkdown } from "./compile";
import { buildProject } from "./templates";
import { newCodexEntry, normalizeManifest } from "./model";
import { score } from "../components/CommandPalette";
import { layout } from "./force";

const ext = [StarterKit.configure({ code: false, codeBlock: false, link: false, underline: false }), CommentMark];
const roundTrip = (md: string) => docToMarkdown(generateJSON(markdownToHtml(md), ext) as never);
const docOf = (md: string) => PMNode.fromJSON(getSchema(ext), generateJSON(markdownToHtml(md), ext));

describe("Marginalia en Markdown", () => {
  it("conserva los comentarios, también con formato dentro", () => {
    const md = "Abrió {{c:k3f9ab}}el sobre con **el pulgar**{{/c}} y leyó.\n";
    expect(markdownToHtml(md)).toContain('<span data-comment="k3f9ab">');
    expect(roundTrip(md)).toBe(md);
  });

  it("las llaves del texto se escapan y no se confunden con comentarios", () => {
    expect(escapeInline("{{c:x}}")).toBe("\\{\\{c:x\\}\\}");
    expect(roundTrip("Dijo \\{\\{c:abc\\}\\} en voz alta.\n")).toBe("Dijo \\{\\{c:abc\\}\\} en voz alta.\n");
    expect(markdownToHtml("Dijo \\{\\{c:abc\\}\\}")).not.toContain("data-comment");
  });

  it("al exportar se quitan las marcas", () => {
    expect(stripComments("a {{c:x1}}b{{/c}} c")).toBe("a b c");
  });
});

describe("búsqueda y Ecos en el editor", () => {
  it("encuentra coincidencias con sus posiciones, aunque crucen formato", () => {
    const doc = docOf("Tomás llegó. Luego **To**más se fue.\n");
    const hits = findAll(doc, searchRegex({ query: "tomás", regex: false, case: false, word: true })!);
    expect(hits).toHaveLength(2);
    expect(doc.textBetween(hits[1].from, hits[1].to)).toBe("Tomás");
  });

  it("palabra completa con acentos y regex no válida", () => {
    const re = searchRegex({ query: "ella", regex: false, case: false, word: true })!;
    expect("Ella y ellas".match(re)).toEqual(["Ella"]);
    expect(searchRegex({ query: "(", regex: true, case: false, word: false })).toBeNull();
  });

  it("menciones con alias, el nombre largo gana", () => {
    const terms = [
      { id: "amparo", names: ["Amparo", "la vieja Amparo"], color: "#000" },
      { id: "faro", names: ["Faro de Punta Gris"], color: "#000" },
    ];
    expect(mentionedIn("La vieja Amparo miraba el Faro de Punta Gris.", terms).sort()).toEqual(["amparo", "faro"]);
    expect(mentionedIn("Amparito no cuenta.", terms)).toEqual([]);
  });
});

describe("Códice, glosario y paleta", () => {
  it("fichas nuevas con color propio y archivo de descripción", () => {
    const a = newCodexEntry("character", "Elena Ruiz", "es", []);
    const b = newCodexEntry("character", "Tomás", "es", [a]);
    expect(a.file).toMatch(/^codice\/elena-ruiz-[a-z0-9]{6}\.md$/);
    expect(a.color).not.toBe(b.color);
    expect(a.fields.map((f) => f.k)).toContain("Secreto");
  });

  it("proyectos antiguos se ponen al día", () => {
    const m = buildProject("blank", "es", "F", "A").manifest as unknown as Record<string, unknown>;
    delete m.codex;
    delete m.boards;
    delete (m.sections as Record<string, unknown>).research;
    const n = normalizeManifest(m as never);
    expect(n.codex).toEqual([]);
    expect(n.sections.research).toEqual([]);
    expect(n.target.restDays).toEqual([]);
  });

  it("el glosario va al final del libro", async () => {
    const m = buildProject("blank", "es", "F", "A").manifest;
    m.compile.titlePage = false;
    m.compile.glossary = true;
    const term = newCodexEntry("term", "Brisa", "es", []);
    m.codex.push(term);
    const files: Record<string, string> = { [term.file]: "Barco de Ignacio." };
    files[m.sections.manuscript[0].file!] = "Texto {{c:aa}}con nota{{/c}}.";
    const { pieces } = await collectPieces(m, m.compile, async (f) => files[f] ?? "");
    expect(toMarkdown(m, m.compile, pieces)).toBe("Texto con nota.\n\n# Glosario\n\n**Brisa**. Barco de Ignacio.\n");
  });

  it("la paleta encuentra sin acentos y prioriza el principio", () => {
    expect(score("Nueva carpeta", "carp")).toBeGreaterThan(0);
    expect(score("Telaraña", "telarana")).toBeGreaterThan(0);
    expect(score("Exportar", "zz")).toBe(0);
    expect(score("Escena del faro", "esc")).toBeGreaterThan(score("La escena", "esc"));
  });

  it("la Telaraña coloca los nodos dentro del lienzo", () => {
    const pos = layout(["a", "b", "c"], [["a", "b"]], { c: { x: 100, y: 100 } }, 1000, 680);
    expect(pos.c).toEqual({ x: 100, y: 100 });
    for (const p of Object.values(pos)) {
      expect(p.x).toBeGreaterThanOrEqual(60);
      expect(p.x).toBeLessThanOrEqual(940);
    }
  });
});
