import { describe, expect, it } from "vitest";
import { buildProject } from "./templates";
import { bookWords, locate, moveNode, restoreNode, trashNode, insertNear } from "./tree";
import { collectPieces, toMarkdown, markdownBlocks } from "./compile";
import { text } from "./templates";

function novel() {
  return buildProject("novel", "es", "Faro", "Ana").manifest;
}

describe("árbol", () => {
  it("la plantilla de novela crea parte, capítulo y escena", () => {
    const { manifest, texts } = buildProject("novel", "es", "Faro", "Ana");
    const part = manifest.sections.manuscript[0];
    expect(part.title).toBe("Parte I");
    expect(part.children![0].children![0].title).toBe("Escena 1");
    expect(texts).toHaveLength(2); // escena + ideas
    expect(texts.every((t) => t.file.startsWith("texto/") && t.file.endsWith(".md"))).toBe(true);
  });

  it("mueve, no deja meter una carpeta dentro de sí misma y usa la papelera", () => {
    const m = novel();
    const part = m.sections.manuscript[0];
    const chapter = part.children![0];
    const scene = chapter.children![0];
    expect(moveNode(m, part.id, chapter.id, "inside")).toBe(false);
    expect(moveNode(m, scene.id, part.id, "before")).toBe(true);
    expect(m.sections.manuscript[0].id).toBe(scene.id);

    expect(trashNode(m, scene.id)).toBe(true);
    expect(locate(m, scene.id)!.section).toBe("trash");
    expect(restoreNode(m, scene.id)).toBe(true);
    expect(locate(m, scene.id)!.section).toBe("manuscript");
  });

  it("inserta detrás del texto seleccionado o dentro de la carpeta", () => {
    const m = novel();
    const chapter = m.sections.manuscript[0].children![0];
    const scene = chapter.children![0];
    const a = text("A");
    insertNear(m, a, scene.id);
    expect(chapter.children!.map((c) => c.id)).toEqual([scene.id, a.id]);
    const b = text("B");
    insertNear(m, b, chapter.id);
    expect(chapter.children!.at(-1)!.id).toBe(b.id);
  });

  it("cuenta solo lo incluido en el libro", () => {
    const m = novel();
    const scene = m.sections.manuscript[0].children![0].children![0];
    const ideas = m.sections.notes[0];
    const words = { [scene.file!]: 120, [ideas.file!]: 50 };
    expect(bookWords(m, words)).toBe(120);
    scene.include = false;
    expect(bookWords(m, words)).toBe(0);
  });
});

describe("compilar", () => {
  it("pone títulos de carpeta y separadores entre escenas", async () => {
    const m = novel();
    const chapter = m.sections.manuscript[0].children![0];
    chapter.children!.push(text("Escena 2"));
    const files: Record<string, string> = {};
    chapter.children!.forEach((c, i) => (files[c.file!] = `Texto ${i + 1}.`));
    const { pieces, texts } = await collectPieces(m, m.compile, async (f) => files[f] ?? "");
    expect(texts).toBe(2);
    const md = toMarkdown(m, m.compile, pieces);
    expect(md).toBe("# Faro\n\n*Ana*\n\n## Parte I\n\n### Capítulo 1\n\nTexto 1.\n\n* * *\n\nTexto 2.\n");
  });

  it("lee formato para Word", () => {
    const b = markdownBlocks("Hola **fuerte** y *suave*\\\notra");
    expect(b).toHaveLength(1);
    const runs = (b[0] as { runs: { text: string; bold?: boolean; italics?: boolean; br?: boolean }[] }).runs;
    expect(runs.find((r) => r.text === "fuerte")!.bold).toBe(true);
    expect(runs.find((r) => r.text === "suave")!.italics).toBe(true);
    expect(runs.some((r) => r.br)).toBe(true);
  });
});
