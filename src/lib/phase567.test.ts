import { describe, expect, it } from "vitest";
import { Editor, generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { mkdirSync, writeFileSync } from "node:fs";
import { acceptChanges, docToMarkdown, markdownToHtml } from "./markdown";
import { Deletion, Insertion, TrackChanges, changes, resolveAll } from "./track";
import { analyze, readability, syllablesEs } from "./style";
import { classify, toFountain } from "./screenplay";
import { bookTypst, coverTypst, esc, manuscriptTypst, screenplayTypst } from "./typst";
import { epubChapters } from "./epub";
import { dayLabel, conflicts } from "./calendar";
import { familyLayout } from "../components/LinajesView";
import { buildProject } from "./templates";
import { collectPieces } from "./compile";
import { DEFAULT_SETTINGS } from "../store";
import type { Calendar } from "../types";

const ext = [StarterKit.configure({ code: false, codeBlock: false, link: false, underline: false }), Insertion, Deletion];

describe("Lápiz rojo", () => {
  it("guarda inserciones y borrados como CriticMarkup", () => {
    const md = "Elena {--abrió--}{++rasgó++} el sobre con **el {++pulgar++}**.\n";
    expect(markdownToHtml(md)).toContain("<del>abrió</del><ins>rasgó</ins>");
    // Al guardar, las marcas de revisión van por fuera de la negrita (forma canónica).
    const saved = docToMarkdown(generateJSON(markdownToHtml(md), ext) as never);
    expect(saved).toBe("Elena {--abrió--}{++rasgó++} el sobre con **el** {++**pulgar**++}.\n");
    expect(docToMarkdown(generateJSON(markdownToHtml(saved), ext) as never)).toBe(saved);
    expect(acceptChanges(md)).toBe("Elena rasgó el sobre con **el pulgar**.\n");
  });

  it("al escribir y borrar con la revisión activada se marca, no se pierde", () => {
    let on = true;
    const editor = new Editor({ extensions: [...ext, TrackChanges.configure({ isOn: () => on })], content: "<p>Hola mundo</p>" });
    const view = editor.view;
    const end = editor.state.doc.content.size - 1;
    view.someProp("handleTextInput", (f) => f(view, end, end, "!", () => editor.state.tr));
    expect(changes(editor.state.doc)).toEqual([{ type: "ins", from: 11, to: 12, text: "!" }]);
    // Borrar "mundo" seleccionándolo: queda tachado.
    editor.commands.setTextSelection({ from: 6, to: 11 });
    view.someProp("handleKeyDown", (f) => f(view, new KeyboardEvent("keydown", { key: "Backspace" })));
    expect(changes(editor.state.doc).map((c) => [c.type, c.text])).toEqual([
      ["del", "mundo"],
      ["ins", "!"],
    ]);
    // Borrar lo añadido en la revisión lo elimina de verdad.
    editor.commands.setTextSelection(12);
    view.someProp("handleKeyDown", (f) => f(view, new KeyboardEvent("keydown", { key: "Backspace" })));
    expect(editor.state.doc.textContent).toBe("Hola mundo");
    view.dispatch(resolveAll(editor.state, true));
    expect(editor.state.doc.textContent).toBe("Hola ");
    on = false;
    editor.destroy();
  });
});

describe("Lupa de estilo", () => {
  it("cuenta sílabas en español", () => {
    expect(syllablesEs("murciélago")).toBe(4);
    expect(syllablesEs("ciudad")).toBe(2);
    expect(syllablesEs("poeta")).toBe(3);
    expect(syllablesEs("ahora")).toBe(3);
  });

  it("encuentra adverbios, repeticiones, frases largas y pasiva", () => {
    const long = Array.from({ length: 45 }, (_, i) => "zq" + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) + "x").join(" ");
    const editor = new Editor({
      extensions: ext,
      content: `<p>Elena abrió rápidamente la carta. La carta fue escrita por su padre.</p><p>${long}.</p>`,
    });
    const r = analyze(editor.state.doc, "es", 40, ["de repente"]);
    expect(r.counts.adv).toBe(1);
    expect(r.counts.rep).toBe(2);
    expect(r.counts.passive).toBe(1);
    expect(r.counts.long).toBe(1);
    expect(r.readability).toBeGreaterThan(0);
    expect(Math.round(readability("es", 100, 10, 200))).toBe(77);
    editor.destroy();
  });
});

describe("Modo guion", () => {
  it("reconoce cada elemento de Fountain", () => {
    const lines = ["INT. FARO - NOCHE", "Elena sube la escalera.", "ELENA", "(en voz baja)", "¿Hay alguien?", "CORTE A:"];
    expect(classify(lines)).toEqual(["scene", "action", "character", "paren", "dialogue", "transition"]);
    expect(toFountain("Faro", "Ana", lines)).toBe("Title: Faro\nAuthor: Ana\n\nINT. FARO - NOCHE\n\nElena sube la escalera.\n\nELENA\n(en voz baja)\n¿Hay alguien?\n\nCORTE A:\n");
  });
});

// Documentos Typst generados por la interfaz: un test de Rust los compila de verdad.
const FIX = "src-tauri/target/typst-fixtures";

describe("Imprenta", () => {
  it("escapa el marcado de Typst", () => {
    expect(esc("#1 *hola* _x_ [a] $5 <b> @c // d")).toBe("\\#1 \\*hola\\* \\_x\\_ \\[a\\] \\$5 \\<b\\> \\@c \\/\\/ d");
  });

  it("genera libro, manuscrito, guion, portada y EPUB", async () => {
    const m = buildProject("novel", "es", "La casa del faro", "Ana Lema").manifest;
    const chapter = m.sections.manuscript[0].children![0];
    chapter.children!.push({ ...chapter.children![0], id: "s2", title: "Escena 2", file: "texto/s2.md" });
    m.publish.dedication = "A mi padre";
    m.publish.acknowledgments = "Gracias a #todos* los lectores.";
    m.codex.push({ id: "t1", kind: "term", name: "Brisa", aliases: [], color: "#000", file: "codice/t1.md", fields: [], mentions: true });
    m.compile.glossary = true;
    const files: Record<string, string> = {
      [chapter.children![0].file!]: "La marea había subido. {++Nueva++} frase {--vieja--} con *cursiva*, **negrita** y {{c:ab}}comentario{{/c}}.\n\n* * *\n\n—No puede ser —dijo.",
      "texto/s2.md": "Segunda escena con [corchetes] y #almohadilla.",
      "codice/t1.md": "Barco de Ignacio.",
    };
    const { pieces } = await collectPieces(m, m.compile, async (f) => files[f] ?? "");
    const labels = { toc: "Índice", rights: "Reservados todos los derechos.", acknowledgments: "Agradecimientos", about: "Sobre la autora" };
    const book = bookTypst(m, pieces, "es", labels).source;
    expect(book).toContain("#set page(width: 6in, height: 9in");
    expect(book).toContain("\n= Parte I");
    expect(book).toContain("\n== Capítulo 1");
    expect(book).not.toContain("vieja");
    expect(book).not.toContain("{{c:");
    expect(book).toContain("\\[corchetes\\]");

    const ms = manuscriptTypst(m, pieces, { ...DEFAULT_SETTINGS, contact: { legalName: "Ana Lema García", address: "Calle Faro 1\nArenales", email: "ana@example.com", phone: "600 000 000" } }, { paper: "a4", font: "Courier New" }, "es", "FIN", "por", "aprox. {n} palabras");
    expect(ms).toContain("García / LA CASA DEL FARO");
    expect(ms).toMatch(/aprox. [1-9][0-9]* palabras/);

    const script = screenplayTypst(m, ["INT. FARO - NOCHE", "ELENA", "¿Hola?"], "por");
    const cover = coverTypst(m, {}).source;
    const chapters = epubChapters(m, pieces, labels);
    expect(chapters.some((c) => c.kind.includes("dedication"))).toBe(true);
    expect(chapters.find((c) => c.title === "Parte I")!.body).toContain('<p class="sep">* * *</p>');

    mkdirSync(FIX, { recursive: true });
    writeFileSync(`${FIX}/book.typ`, book);
    writeFileSync(`${FIX}/manuscript.typ`, ms);
    writeFileSync(`${FIX}/screenplay.typ`, script);
    writeFileSync(`${FIX}/cover.typ`, cover);
    for (const style of ["modern", "romantic"] as const) {
      m.publish.style = style;
      m.publish.headers = style === "modern";
      writeFileSync(`${FIX}/book-${style}.typ`, bookTypst(m, pieces, "es", labels).source);
    }
  });
});

describe("Tiempo y espacio", () => {
  it("calendario inventado y conflictos de lugar", () => {
    const cal: Calendar = { kind: "custom", start: "", months: [{ name: "Brumas", days: 30 }, { name: "Mareas", days: 20 }], yearName: "año", firstYear: 3 };
    expect(dayLabel(cal, 0, "es")).toBe("1 de Brumas, año 3");
    expect(dayLabel(cal, 35, "es")).toBe("6 de Mareas, año 3");
    expect(dayLabel(cal, 50, "es")).toBe("1 de Brumas, año 4");
    const real: Calendar = { ...cal, kind: "real", start: "2026-10-10" };
    expect(dayLabel(real, 1, "es")).toContain("11");

    const m = buildProject("novel", "es", "F", "A").manifest;
    const scene = m.sections.manuscript[0].children![0].children![0];
    Object.assign(scene, { t: 2, place: "faro", pov: "elena" });
    m.sections.manuscript.push({ ...scene, id: "x2", file: "texto/x2.md", place: "lonja", pov: undefined });
    m.codex.push({ id: "elena", kind: "character", name: "Elena", aliases: [], color: "#000", file: "c.md", fields: [], mentions: true });
    const c = conflicts(m, { elena: { "texto/x2.md": 3 } });
    expect(c).toEqual([{ t: 2, who: "elena", places: ["faro", "lonja"] }]);
  });

  it("árbol de linajes por generaciones", () => {
    const m = buildProject("blank", "es", "F", "A").manifest;
    m.relations = [
      { id: "1", from: "abuelo", to: "padre", label: "", kind: "parent" },
      { id: "2", from: "padre", to: "hija", label: "", kind: "parent" },
      { id: "3", from: "madre", to: "hija", label: "", kind: "parent" },
      { id: "4", from: "padre", to: "madre", label: "", kind: "spouse" },
    ];
    const placed = familyLayout(m, ["abuelo", "padre", "madre", "hija"]);
    const gen = Object.fromEntries(placed.map((p) => [p.id, p.gen]));
    expect(gen).toEqual({ abuelo: 0, padre: 1, madre: 1, hija: 2 });
    const x = Object.fromEntries(placed.map((p) => [p.id, p.x]));
    expect(Math.abs(x.padre - x.madre)).toBe(190);
  });
});
