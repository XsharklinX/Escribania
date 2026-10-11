/** Fichas, tableros, moldes y la puesta al día de proyectos antiguos. */
import type { Board, Calendar, CodexEntry, CodexKind, CoverDesign, Kit, Lang, Manifest, PublishOptions, Snowflake, TreeNode } from "../types";
import { newId, slugify } from "./ids";

export const DEFAULT_PUBLISH: PublishOptions = {
  trim: "6x9",
  font: "Libertinus Serif",
  fontSize: 11,
  leading: 1.35,
  style: "classic",
  dropCaps: true,
  smallCaps: true,
  headers: true,
  recto: true,
  toc: true,
  halfTitle: true,
  copyright: "",
  isbn: "",
  publisher: "",
  dedication: "",
  epigraph: "",
  epigraphSource: "",
  acknowledgments: "",
  aboutAuthor: "",
  description: "",
  cover: "",
};

export const DEFAULT_COVER: CoverDesign = {
  paper: "cream",
  pages: 0,
  front: "",
  back: "",
  bg: "#1D2B3A",
  fg: "#F3EBDB",
  titleSize: 44,
  blurb: "",
  showSpine: true,
};

/** Tamaños de libro (pulgadas) habituales en Amazon KDP, IngramSpark y España. */
export const TRIMS: { id: string; label: string; w: number; h: number }[] = [
  { id: "5x8", label: "5 × 8″ (12,7 × 20,3 cm)", w: 5, h: 8 },
  { id: "5.25x8", label: "5,25 × 8″ (13,3 × 20,3 cm)", w: 5.25, h: 8 },
  { id: "5.5x8.5", label: "5,5 × 8,5″ (14 × 21,6 cm)", w: 5.5, h: 8.5 },
  { id: "6x9", label: "6 × 9″ (15,2 × 22,9 cm)", w: 6, h: 9 },
  { id: "a5", label: "A5 (14,8 × 21 cm)", w: 5.83, h: 8.27 },
  { id: "15x21", label: "15 × 21 cm (bolsillo grande)", w: 5.91, h: 8.27 },
  { id: "13x20", label: "13 × 20 cm (rústica española)", w: 5.12, h: 7.87 },
];

/** Grosor de cada página según el papel (pulgadas, tabla de Amazon KDP). */
export const PAPER_THICKNESS = { white: 0.002252, cream: 0.0025, color: 0.002347 };

export function spineWidth(pages: number, paper: CoverDesign["paper"]): number {
  return Math.max(0, pages) * PAPER_THICKNESS[paper];
}

/** Proyectos creados con versiones anteriores: se rellenan los campos nuevos. */
export function normalizeManifest(m: Manifest): Manifest {
  m.sections = m.sections ?? ({} as Manifest["sections"]);
  for (const k of ["manuscript", "research", "notes", "trash"] as const) m.sections[k] = m.sections[k] ?? [];
  m.codex = m.codex ?? [];
  m.relations = m.relations ?? [];
  m.boards = m.boards ?? [];
  m.structure = m.structure ?? { template: null, beats: {} };
  m.structure.beats = m.structure.beats ?? {};
  m.target = { words: 0, deadline: null, restDays: [], ...((m.target ?? {}) as Partial<Manifest["target"]>) };
  m.target.restDays = m.target.restDays ?? [];
  m.prefs = { quotes: "latin", dialogueDash: true, trackChanges: false, ...((m.prefs ?? {}) as Partial<Manifest["prefs"]>) };
  m.publish = { ...DEFAULT_PUBLISH, ...((m.publish ?? {}) as Partial<PublishOptions>) };
  m.kit = { logline: "", shortSynopsis: "", longSynopsis: "", query: "", bio: "", comps: "", ...((m.kit ?? {}) as Partial<Kit>) };
  m.submissions = m.submissions ?? [];
  m.cover = { ...DEFAULT_COVER, ...((m.cover ?? {}) as Partial<CoverDesign>) };
  m.plotlines = m.plotlines ?? [];
  m.plotgrid = m.plotgrid ?? {};
  m.events = m.events ?? [];
  m.calendar = { kind: "real", start: new Date().toISOString().slice(0, 10), months: [], yearName: "año", firstYear: 1, ...((m.calendar ?? {}) as Partial<Calendar>) };
  m.maps = m.maps ?? [];
  m.agenda = m.agenda ?? [];
  m.collections = m.collections ?? [];
  m.corkLinks = m.corkLinks ?? [];
  m.snowflake = { step: 0, sentence: "", paragraph: "", characters: [], page: "", synopsis: "", scenes: [], ...((m.snowflake ?? {}) as Partial<Snowflake>) };
  m.compile = {
    titlePage: true,
    folderTitles: true,
    textTitles: false,
    separator: "* * *",
    chapterPageBreak: true,
    font: "Times New Roman",
    manuscriptFormat: false,
    glossary: false,
    ...((m.compile ?? {}) as Partial<Manifest["compile"]>),
  };
  for (const e of m.codex) {
    e.aliases = e.aliases ?? [];
    e.fields = e.fields ?? [];
    e.mentions = e.mentions ?? true;
  }
  return m;
}

export const CODEX_KINDS: CodexKind[] = ["character", "place", "object", "faction", "lore", "term"];

export const KIND_COLORS: Record<CodexKind, string> = {
  character: "#3B6FD8",
  place: "#2E9A73",
  object: "#C77A1E",
  faction: "#8C4FC2",
  lore: "#7A808C",
  term: "#B3434F",
};

/** Colores para distinguir personajes (POV) en Corcho, Escaleta y Telaraña. */
export const PALETTE = ["#3B6FD8", "#D2803A", "#8C4FC2", "#2E9A73", "#C2416B", "#1F8FA3", "#9A7B1E", "#5B6B7F", "#D24F3A", "#6A8F2A"];

const FIELDS: Record<Lang, Record<CodexKind, string[]>> = {
  es: {
    character: ["Edad", "Rol", "Aspecto", "Personalidad", "Quiere", "Secreto"],
    place: ["Tipo", "Ubicación", "Ambiente"],
    object: ["Origen", "Quién lo tiene"],
    faction: ["Líder", "Objetivo"],
    lore: ["Categoría"],
    term: ["Idioma"],
  },
  en: {
    character: ["Age", "Role", "Looks", "Personality", "Wants", "Secret"],
    place: ["Type", "Location", "Mood"],
    object: ["Origin", "Held by"],
    faction: ["Leader", "Goal"],
    lore: ["Category"],
    term: ["Language"],
  },
};

export function newCodexEntry(kind: CodexKind, name: string, lang: Lang, existing: CodexEntry[]): CodexEntry {
  const id = newId();
  const used = new Set(existing.map((e) => e.color));
  const color = kind === "character" ? PALETTE.find((c) => !used.has(c)) ?? PALETTE[existing.length % PALETTE.length] : KIND_COLORS[kind];
  return {
    id,
    kind,
    name,
    aliases: [],
    color,
    file: `codice/${slugify(name)}-${id}.md`,
    fields: FIELDS[lang][kind].map((k) => ({ k, v: "" })),
    mentions: kind !== "lore",
  };
}

export function newBoard(name: string): Board {
  return { id: newId(), name, items: [] };
}

/** Color con el que se pinta un texto: el de su POV, si tiene. */
export function povColor(m: Manifest, node: TreeNode): string | null {
  if (!node.pov) return null;
  return m.codex.find((e) => e.id === node.pov)?.color ?? null;
}

export function codexById(m: Manifest, id: string | null | undefined): CodexEntry | undefined {
  return id ? m.codex.find((e) => e.id === id) : undefined;
}

// ---------------- Moldes de estructura ----------------

export interface Beat {
  id: string;
  pct: number;
  es: string;
  en: string;
}

export interface Mold {
  id: string;
  es: string;
  en: string;
  beats: Beat[];
}

const b = (id: string, pct: number, es: string, en: string): Beat => ({ id, pct, es, en });

export const MOLDS: Mold[] = [
  {
    id: "three-acts",
    es: "Tres actos",
    en: "Three acts",
    beats: [
      b("setup", 0, "Planteamiento", "Setup"),
      b("inciting", 12, "Detonante", "Inciting incident"),
      b("turn1", 25, "Primer punto de giro", "First plot point"),
      b("midpoint", 50, "Punto medio", "Midpoint"),
      b("turn2", 75, "Segundo punto de giro", "Second plot point"),
      b("climax", 88, "Clímax", "Climax"),
      b("resolution", 96, "Desenlace", "Resolution"),
    ],
  },
  {
    id: "save-the-cat",
    es: "Save the Cat",
    en: "Save the Cat",
    beats: [
      b("opening", 0, "Imagen inicial", "Opening image"),
      b("theme", 5, "Tema expuesto", "Theme stated"),
      b("setup", 7, "Planteamiento", "Setup"),
      b("catalyst", 10, "Catalizador", "Catalyst"),
      b("debate", 15, "Debate", "Debate"),
      b("break2", 20, "Paso al segundo acto", "Break into two"),
      b("bstory", 22, "Trama B", "B story"),
      b("fun", 30, "Juegos y diversión", "Fun and games"),
      b("midpoint", 50, "Punto medio", "Midpoint"),
      b("badguys", 62, "Los malos estrechan el cerco", "Bad guys close in"),
      b("lost", 75, "Todo está perdido", "All is lost"),
      b("dark", 78, "Noche oscura del alma", "Dark night of the soul"),
      b("break3", 80, "Paso al tercer acto", "Break into three"),
      b("finale", 85, "Final", "Finale"),
      b("final", 99, "Imagen final", "Final image"),
    ],
  },
  {
    id: "hero",
    es: "Viaje del héroe",
    en: "Hero's journey",
    beats: [
      b("ordinary", 0, "Mundo ordinario", "Ordinary world"),
      b("call", 8, "Llamada a la aventura", "Call to adventure"),
      b("refusal", 12, "Rechazo de la llamada", "Refusal of the call"),
      b("mentor", 17, "Encuentro con el mentor", "Meeting the mentor"),
      b("threshold", 25, "Cruce del umbral", "Crossing the threshold"),
      b("tests", 32, "Pruebas, aliados y enemigos", "Tests, allies, enemies"),
      b("approach", 45, "Acercamiento a la caverna", "Approach to the inmost cave"),
      b("ordeal", 50, "La odisea", "The ordeal"),
      b("reward", 58, "La recompensa", "Reward"),
      b("road", 75, "El camino de vuelta", "The road back"),
      b("resurrection", 88, "Resurrección", "Resurrection"),
      b("elixir", 97, "Regreso con el elixir", "Return with the elixir"),
    ],
  },
  {
    id: "seven-points",
    es: "Siete puntos",
    en: "Seven-point structure",
    beats: [
      b("hook", 0, "Gancho", "Hook"),
      b("turn1", 15, "Primer giro", "Plot turn 1"),
      b("pinch1", 33, "Primera presión", "Pinch 1"),
      b("midpoint", 50, "Punto medio", "Midpoint"),
      b("pinch2", 62, "Segunda presión", "Pinch 2"),
      b("turn2", 80, "Segundo giro", "Plot turn 2"),
      b("resolution", 97, "Resolución", "Resolution"),
    ],
  },
  {
    id: "kishotenketsu",
    es: "Kishōtenketsu",
    en: "Kishōtenketsu",
    beats: [
      b("ki", 0, "Ki · introducción", "Ki · introduction"),
      b("sho", 25, "Shō · desarrollo", "Shō · development"),
      b("ten", 50, "Ten · giro", "Ten · twist"),
      b("ketsu", 75, "Ketsu · conclusión", "Ketsu · reconciliation"),
    ],
  },
];
