import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { stripTodos, todoNote, TODO_SEARCH, sceneIssues } from "./todos";
import { candidates, lookupIn, matchCase, parseThesaurus } from "./thesaurus";
import { checkContinuity, levenshtein, parseAge } from "./continuity";
import { dialogueLines, voiceStats } from "./voices";
import { anchorNote, betaHtml, parseBetaFile } from "./beta";
import { webChapters } from "./web";
import { applyStyle, parseStyleFile, styleFile, styleFrom } from "./pressStyles";
import { parseThemeFile } from "./themes";
import { parseHeader, GALLERY } from "./plugins";
import { comboOf } from "./shortcuts";
import { sampleProject } from "./sample";
import { nextVariantId, variantFile } from "./variants";
import { matchesFilter, emptyFilter } from "./collections";
import { lastSentence } from "./nonet";
import { bookTypst, dropCapText, proofTypst } from "./typst";
import { collectPieces } from "./compile";
import { buildProject } from "./templates";
import { normalizeManifest } from "./model";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { CodexEntry } from "../types";

const FIX = "src-tauri/target/typst-fixtures";

describe("Pendientes", () => {
  it("se quitan al exportar, con y sin corchetes", () => {
    const md = "Abrió el sobre. \\[TODO: la fecha\\] Dentro había una hoja.\n\nREVISAR: suena falso\n\nLa letra era la de su padre. OJO falta el nombre";
    expect(stripTodos(md)).toBe("Abrió el sobre. Dentro había una hoja.\n\nLa letra era la de su padre.");
    expect(stripTodos("Sin notas.")).toBe("Sin notas.");
  });
  it("se reconocen en los archivos y se lee su nota", () => {
    const re = new RegExp(TODO_SEARCH, "g");
    expect("x \\[TODO: comprobar\\] y".match(re)![0]).toBe("\\[TODO: comprobar\\]");
    expect(todoNote("\\[TODO: comprobar\\]")).toEqual({ word: "TODO", note: "comprobar" });
    expect(todoNote("REVISAR: el diálogo")).toEqual({ word: "REVISAR", note: "el diálogo" });
    // En minúsculas es texto normal.
    expect("todo el mundo".match(re)).toBeNull();
  });
  it("avisa de escenas sin sinopsis", () => {
    const m = buildProject("novel", "es", "F", "A").manifest;
    expect(sceneIssues(m).some((x) => x.kind === "noSynopsis")).toBe(true);
  });
});

describe("Sinónimos", () => {
  it("el tesauro incluido tiene palabras corrientes", () => {
    for (const [lang, word] of [["es", "casa"], ["en", "house"]] as const) {
      const map = parseThesaurus(gunzipSync(readFileSync(`public/thes/${lang}.txt.gz`)).toString("utf8"));
      const e = lookupIn(map, word, lang);
      expect(e?.senses.flat().length).toBeGreaterThan(3);
    }
  });
  it("prueba singular y masculino y respeta la mayúscula", () => {
    const map = parseThesaurus("rápido\tveloz|raudo\t!lento\n");
    expect(lookupIn(map, "rápidas", "es")?.word).toBe("rápido");
    expect(lookupIn(map, "rápido", "es")?.antonyms).toEqual(["lento"]);
    expect(candidates("luces", "es")).toContain("luz");
    expect(candidates("subido", "es")).toContain("subir");
    expect(candidates("caminando", "es")).toContain("caminar");
    expect(matchCase("Casa", "hogar")).toBe("Hogar");
    expect(matchCase("CASA", "hogar")).toBe("HOGAR");
  });
});

const entry = (id: string, name: string, fields: [string, string][] = [], aliases: string[] = []): CodexEntry => ({ id, kind: "character", name, aliases, color: "#000", file: `codice/${id}.md`, fields: fields.map(([k, v]) => ({ k, v })), mentions: true });

describe("Continuidad", () => {
  it("encuentra grafías dobles, ojos de otro color y edades que no cuadran", () => {
    const m = buildProject("novel", "es", "F", "A").manifest;
    m.codex = [entry("e", "Elena Ruiz", [["Ojos", "verdes"], ["Edad", "34"]], ["Elena"]), entry("t", "Tomás", [], [])];
    const texts = [
      { file: "texto/a.md", title: "A", t: 0, text: "Tomas llegó tarde. Elena lo miró con sus ojos azules." },
      { file: "texto/b.md", title: "B", t: 400, text: "Elena tenía treinta y cuatro años y ninguna prisa." },
    ];
    const issues = checkContinuity(m, texts, "es");
    expect(issues.find((x) => x.kind === "spelling")).toMatchObject({ variant: "Tomas", name: "Tomás" });
    expect(issues.find((x) => x.kind === "field")).toMatchObject({ entry: "e", found: "azules" });
    // Al cabo de 400 días tiene 35.
    expect(issues.find((x) => x.kind === "age")).toMatchObject({ expected: 35, found: 34 });
  });
  it("lee edades escritas con letra", () => {
    expect(parseAge("treinta y cuatro", "es")).toBe(34);
    expect(parseAge("thirty-four", "en")).toBe(34);
    expect(parseAge("12", "es")).toBe(12);
    expect(levenshtein("Elena", "Elana")).toBe(1);
  });
});

describe("Voces", () => {
  it("atribuye los diálogos por el inciso y por turnos", () => {
    const people = [entry("e", "Elena"), entry("t", "Tomás")];
    const text = "Llovía.\n—¿Vienes? —preguntó Elena.\n—No —dijo Tomás—. Hoy no puedo.\n—¿Y mañana?\nSe hizo el silencio.";
    const lines = dialogueLines(text, people, "es");
    expect(lines.map((l) => l.speaker)).toEqual(["e", "t", "e"]);
    expect(lines[1].text).toBe("No Hoy no puedo.");
    const stats = voiceStats(lines, "es");
    expect(stats.find((s) => s.speaker === "e")!.questions).toBe(1);
  });
});

describe("Lectores beta", () => {
  it("genera la página y ancla las notas en su frase", () => {
    const m = buildProject("novel", "es", "Faro", "Ana").manifest;
    const html = betaHtml(m, [{ kind: "text", md: "Hola </script> mundo", id: "s1" }], "es", { intro: "i", name: "n", namePh: "p", comment: "c", save: "s", cancel: "x", download: "d", notes: "N", empty: "e", remove: "r", placeholder: "p", saved: "ok" });
    expect(html).toContain('data-scene="s1"');
    expect(html.split("</script>").length).toBe(2); // el texto no cierra el programa
    const file = parseBetaFile(JSON.stringify({ app: "escribania-beta", project: m.id, title: "Faro", reader: "Lucía", notes: [] }));
    expect(file.reader).toBe("Lucía");
    const r = anchorNote("Abrió el sobre con el pulgar.", { scene: "s1", quote: "el sobre", comment: "¡Bien!", created: "" }, "Lucía");
    expect(r.exact).toBe(true);
    expect(r.md).toMatch(/^Abrió \{\{c:[\w-]+\}\}el sobre\{\{\/c\}\} con el pulgar\.$/);
    const loose = anchorNote("Texto distinto.", { scene: "s1", quote: "no está", comment: "x", created: "" }, "L");
    expect(loose.exact).toBe(false);
    expect(loose.comment.text).toContain("«no está»");
  });
});

describe("Para la web", () => {
  it("un archivo por capítulo", async () => {
    const m = buildProject("novel", "es", "Faro", "Ana").manifest;
    const ch = m.sections.manuscript[0].children![0];
    ch.children!.push({ ...ch.children![0], id: "s2", file: "texto/s2.md" });
    m.sections.manuscript[0].children!.push({ ...ch, id: "c2", title: "Capítulo 2", children: [{ ...ch.children![0], id: "s3", file: "texto/s3.md" }] });
    const { pieces } = await collectPieces(m, m.compile, async () => "Texto.");
    const chapters = webChapters(m, pieces, "* * *");
    expect(chapters.map((c) => c.title)).toEqual(["Capítulo 1", "Capítulo 2"]);
    expect(chapters[0].file).toBe("01-capitulo-1");
    expect(chapters[0].html).toContain("* * *");
  });
});

describe("Estilos, temas y extensiones", () => {
  it("un estilo se guarda, se comparte y se aplica solo con claves válidas", () => {
    const m = buildProject("novel", "es", "F", "A").manifest;
    m.publish.trim = "5x8";
    const st = parseStyleFile(styleFile(styleFrom("Mío", m.publish, m.compile)));
    const other = buildProject("novel", "es", "G", "B").manifest;
    applyStyle({ ...st, publish: { ...st.publish, fontSize: "grande" as unknown as number } }, other.publish, other.compile);
    expect(other.publish.trim).toBe("5x8");
    expect(other.publish.fontSize).toBe(m.publish.fontSize);
    expect(() => parseStyleFile("{}")).toThrow();
  });
  it("un tema solo acepta colores", () => {
    const th = parseThemeFile(JSON.stringify({ app: "escribania-tema", name: "Mar", dark: true, colors: { bg: "#001122", acc: "red; background:url(x)" } }));
    expect(th.colors.bg).toBe("#001122");
    expect(th.colors.acc).toBe("#888888");
  });
  it("lee la cabecera de una extensión", () => {
    expect(parseHeader(GALLERY[0]).name).toBe("Quitar dobles espacios");
    expect(parseHeader("escribania.command('x', () => ({}))").name).toBe("Extensión");
  });
  it("atajos de teclado", () => {
    expect(comboOf({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Ctrl+K");
    expect(comboOf({ key: "F", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("Ctrl+Shift+F");
    expect(comboOf({ key: "F11", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe("F11");
    expect(comboOf({ key: "Control", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("");
  });
});

describe("Proyecto de ejemplo, variantes y colecciones", () => {
  it("el ejemplo es un proyecto completo y coherente", () => {
    const { manifest, texts } = sampleProject("Ana");
    const m = normalizeManifest(manifest);
    const files = new Set(texts.map((x) => x.file));
    const nodes: string[] = [];
    const walk = (l: typeof m.sections.manuscript) => l.forEach((n) => (n.file && nodes.push(n.file), n.children && walk(n.children)));
    walk(m.sections.manuscript);
    walk(m.sections.notes);
    expect(nodes.length).toBeGreaterThan(5);
    for (const f of nodes) expect(files.has(f)).toBe(true);
    for (const e of m.codex) expect(files.has(e.file)).toBe(true);
    expect(new Set(texts.map((x) => x.file)).size).toBe(texts.length);
  });
  it("nombres de variantes", () => {
    expect(variantFile("texto/la-carta-k3f9.md", "B")).toBe("texto/variantes/la-carta-k3f9~b.md");
    expect(nextVariantId([{ id: "A", name: "A", file: "" }, { id: "C", name: "C", file: "" }])).toBe("B");
  });
  it("filtros de colección", () => {
    const n = { id: "1", type: "text" as const, title: "x", status: "draft" as const, include: true, synopsis: "", notes: "", target: 0, tags: ["misterio", "Elena"], pov: "e" };
    expect(matchesFilter(n, { ...emptyFilter(), tags: ["misterio"] })).toBe(true);
    expect(matchesFilter(n, { ...emptyFilter(), tags: ["misterio", "otro"] })).toBe(false);
    expect(matchesFilter(n, { ...emptyFilter(), status: ["final"] })).toBe(false);
    expect(matchesFilter(n, { ...emptyFilter(), pov: "e" })).toBe(true);
  });
});

describe("Escritura sin red", () => {
  it("la última frase es la que se desvanece", () => {
    const ed = new Editor({ extensions: [StarterKit], content: "<p>Primera frase. Segunda frase sin acabar</p>" });
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    const r = lastSentence(ed.state)!;
    expect(ed.state.doc.textBetween(r.from, r.to)).toBe("Segunda frase sin acabar");
    ed.destroy();
  });
});

describe("Imprenta 0.8", () => {
  it("inicial capitular de verdad y copia para papel", async () => {
    expect(dropCapText([{ text: "—Hola" }], false)).toBeNull();
    const dc = dropCapText([{ text: "La marea " }, { text: "había", italics: true }, { text: " subido." }], true)!;
    expect(dc).toContain('#dropcap("L", (');
    expect(dc).toContain("#smallcaps[a]");
    expect(dc).toContain("#emph[#smallcaps[había]]");

    const { manifest, texts } = sampleProject("Ana Lema");
    const m = normalizeManifest(manifest);
    const files = Object.fromEntries(texts.map((x) => [x.file, x.body]));
    // Un primer párrafo largo para que la letra tenga texto que rodear.
    const first = texts.find((x) => x.title === "Llegada")!;
    files[first.file] = `${first.body.split("\n\n")[0]} ${first.body.split("\n\n")[0]}\n\n${first.body}`;
    const { pieces } = await collectPieces(m, m.compile, async (f) => files[f] ?? "");
    const labels = { toc: "Índice", rights: "Reservados todos los derechos.", acknowledgments: "Agradecimientos", about: "Sobre la autora" };
    m.publish.dropCaps = true;
    m.publish.smallCaps = true;
    const book = bookTypst(m, pieces, "es", labels).source;
    expect(book).toContain("#let dropcap(");
    expect(book).not.toContain("decidir de quién"); // el pendiente no sale
    const titles: Record<string, string> = {};
    const walk = (l: typeof m.sections.manuscript) => l.forEach((n) => ((titles[n.id] = n.title), n.children && walk(n.children)));
    walk(m.sections.manuscript);
    const proof = proofTypst(m, pieces, titles, "es", { scene: "Escena", page: "Página", notes: "Notas →" });
    expect(proof).toContain('#set page(paper: "a4"');
    expect(proof).toContain("Escena 1");
    mkdirSync(FIX, { recursive: true });
    writeFileSync(`${FIX}/dropcap.typ`, book);
    writeFileSync(`${FIX}/proof.typ`, proof);
  });
});
