export type Status = "idea" | "draft" | "revised" | "final";
export type SectionId = "manuscript" | "research" | "notes" | "trash";
export type ThemeId = "algodon" | "tinta" | "olivetti" | "pizarra";
export type Lang = "es" | "en";
export type FontId = "literata" | "source-serif" | "courier-prime" | "system";
export type QuoteStyle = "latin" | "english" | "none";
export type NodeType = "folder" | "text" | "file" | "link";

export interface Comment {
  id: string;
  text: string;
  author: string;
  created: string;
  resolved: boolean;
}

export interface TreeNode {
  id: string;
  type: NodeType;
  title: string;
  /** Textos: ruta relativa al proyecto ("texto/la-carta-k3f9.md"). */
  file?: string;
  status: Status;
  /** Entra en la compilación del libro. */
  include: boolean;
  synopsis: string;
  notes: string;
  /** Meta de palabras del texto (0 = sin meta). */
  target: number;
  open?: boolean;
  children?: TreeNode[];
  /** Al ir a la papelera se recuerda de dónde venía. */
  trashedFrom?: SectionId;
  /** Ficha del Códice del personaje que narra (POV). */
  pov?: string;
  /** Día o fecha interna de la historia, texto libre ("Día 3", "Mes de Brumas 4"). */
  day?: string;
  /** Comentarios de Marginalia anclados en el texto. */
  comments?: Comment[];
  /** Investigación: archivo copiado en el proyecto ("investigacion/x.pdf"). */
  asset?: string;
  mime?: string;
  /** Investigación: dirección de una página web. */
  url?: string;
  /** Pulso: tensión de la escena (1-10). */
  tension?: number;
  /** Cronos: día de la historia (0 = primer día) y duración en días. */
  t?: number | null;
  span?: number;
  /** Cronos: lugar (ficha del Códice) donde ocurre. */
  place?: string;
  /** Modo guion (Fountain) en este texto. */
  screenplay?: boolean;
  /** Variantes de la escena: la activa vive en `file`; el resto, en sus archivos. */
  variants?: Variant[];
  variantActive?: string;
  /** Etiquetas libres (flashback, por revisar…). */
  tags?: string[];
  /** Corcho libre: posición de la ficha. */
  cork?: { x: number; y: number; color?: string };
}

export interface Variant {
  id: string;
  name: string;
  /** Copia guardada ("texto/variantes/la-carta-k3f9~b.md"); la activa está desfasada hasta que se cambia. */
  file: string;
  words?: number;
}

export interface Plotline {
  id: string;
  name: string;
  color: string;
}

export interface TimelineEvent {
  id: string;
  title: string;
  t: number;
  span: number;
  /** Ficha del Códice (personaje) en cuya pista aparece; vacío = pista general. */
  lane: string;
  color: string;
  note: string;
}

export interface Calendar {
  /** "real": fechas del calendario normal desde `start`. "custom": meses inventados. */
  kind: "real" | "custom";
  start: string;
  months: { name: string; days: number }[];
  yearName: string;
  firstYear: number;
}

export interface MapPin {
  id: string;
  x: number;
  y: number;
  label: string;
  entry?: string;
  color: string;
}

export interface MapDef {
  id: string;
  name: string;
  image: string;
  pins: MapPin[];
  routes: { id: string; color: string; points: [number, number][] }[];
}

export interface PublishOptions {
  trim: string;
  font: string;
  fontSize: number;
  leading: number;
  style: "classic" | "modern" | "romantic";
  dropCaps: boolean;
  smallCaps: boolean;
  headers: boolean;
  recto: boolean;
  toc: boolean;
  halfTitle: boolean;
  copyright: string;
  isbn: string;
  publisher: string;
  dedication: string;
  epigraph: string;
  epigraphSource: string;
  acknowledgments: string;
  aboutAuthor: string;
  description: string;
  cover: string;
}

export interface Kit {
  logline: string;
  shortSynopsis: string;
  longSynopsis: string;
  query: string;
  bio: string;
  comps: string;
}

export interface Submission {
  id: string;
  to: string;
  kind: "agent" | "publisher" | "contest" | "other";
  sent: string;
  status: "draft" | "sent" | "partial" | "full" | "rejected" | "offer" | "silent";
  reply: string;
  notes: string;
}

export interface CoverDesign {
  paper: "white" | "cream" | "color";
  pages: number;
  front: string;
  back: string;
  bg: string;
  fg: string;
  titleSize: number;
  blurb: string;
  showSpine: boolean;
}

export interface Snowflake {
  step: number;
  sentence: string;
  paragraph: string;
  characters: { name: string; storyline: string; motivation: string; goal: string; conflict: string; epiphany: string }[];
  page: string;
  synopsis: string;
  scenes: { title: string; pov: string; synopsis: string }[];
}

export type CodexKind = "character" | "place" | "object" | "faction" | "lore" | "term";

export interface CodexField {
  k: string;
  v: string;
}

export interface CodexEntry {
  id: string;
  kind: CodexKind;
  name: string;
  aliases: string[];
  color: string;
  /** Retrato o imagen ("recursos/elena-x1.jpg"). */
  image?: string;
  /** Descripción en Markdown ("codice/elena-ruiz-k3f9.md"). */
  file: string;
  fields: CodexField[];
  /** Ecos: subrayar sus menciones en el texto. */
  mentions: boolean;
  /** Posición en la Telaraña. */
  pos?: { x: number; y: number };
  /** Compartida con los demás libros de la saga. */
  shared?: boolean;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  label: string;
  /** Árbol de linajes: from es padre/madre de to, o pareja de to. */
  kind?: "parent" | "spouse" | "other";
}

export interface BoardItem {
  id: string;
  kind: "image" | "note" | "swatch";
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  asset?: string;
  caption?: string;
  text?: string;
  color?: string;
  colors?: string[];
}

export interface Board {
  id: string;
  name: string;
  linkedTo?: string;
  items: BoardItem[];
}

export interface CompileOptions {
  titlePage: boolean;
  folderTitles: boolean;
  textTitles: boolean;
  separator: string;
  chapterPageBreak: boolean;
  font: string;
  manuscriptFormat: boolean;
  glossary: boolean;
}

export interface Manifest {
  app: "escribania";
  format: 1;
  id: string;
  title: string;
  author: string;
  template: string;
  created: string;
  modified: string;
  /** restDays: días de la semana sin escribir (0 = domingo). */
  target: { words: number; deadline: string | null; restDays: number[] };
  prefs: { quotes: QuoteStyle; dialogueDash: boolean; trackChanges: boolean };
  compile: CompileOptions;
  sections: Record<SectionId, TreeNode[]>;
  codex: CodexEntry[];
  relations: Relation[];
  boards: Board[];
  /** Moldes: plantilla elegida y a qué texto corresponde cada momento. */
  structure: { template: string | null; beats: Record<string, string> };
  publish: PublishOptions;
  kit: Kit;
  submissions: Submission[];
  cover: CoverDesign;
  plotlines: Plotline[];
  /** Rejilla de tramas: texto → subtrama → nota. */
  plotgrid: Record<string, Record<string, string>>;
  events: TimelineEvent[];
  calendar: Calendar;
  maps: MapDef[];
  snowflake: Snowflake;
  /** Calendario editorial: entregas, revisiones, lectores… */
  agenda: AgendaItem[];
  /** Colecciones del Legajo: a mano o búsquedas guardadas. */
  collections: Collection[];
  /** Corcho libre: flechas entre fichas. */
  corkLinks: { id: string; from: string; to: string }[];
  /** Saga a la que pertenece el libro (ruta relativa a su archivo `.saga.json`). */
  saga?: string;
}

export interface AgendaItem {
  id: string;
  date: string;
  title: string;
  kind: "deadline" | "revision" | "beta" | "submission" | "other";
  done: boolean;
  note?: string;
}

export interface Collection {
  id: string;
  name: string;
  color: string;
  /** "manual": ids elegidos; "smart": se recalcula con el filtro. */
  kind: "manual" | "smart";
  ids: string[];
  filter: { tags: string[]; status: Status[]; pov: string; text: string };
}

export interface Recent {
  path: string;
  title: string;
  opened: string;
}

export interface Settings {
  /** Uno de los cuatro temas o "custom:<id>" (tema propio). */
  theme: ThemeId | `custom:${string}`;
  lang: Lang;
  font: FontId;
  fontSize: number;
  lineWidth: number;
  lineHeight: number;
  paragraph: "indent" | "spaced";
  typewriter: boolean;
  backupKeep: number;
  backupMinutes: number;
  binderOpen: boolean;
  inspectorOpen: boolean;
  ambientVolume: number;
  recent: Recent[];
  /** Nombre con el que se firman los comentarios. */
  authorName: string;
  mentions: boolean;
  showResolved: boolean;
  sprintMinutes: number;
  sprintGoal: number;
  sprintBreak: boolean;
  outlineColumns: string[];
  quickCapture: boolean;
  spell: "app" | "system" | "off";
  lens: boolean;
  lensLong: number;
  crutches: string;
  ttsVoice: string;
  ttsRate: number;
  contact: { legalName: string; address: string; email: string; phone: string };
  /** Canal de actualizaciones; se comprueba una vez al día. */
  updates: "stable" | "beta" | "off";
  updateChecked: string;
  /** Notas de la edición recién instalada, para enseñarlas una vez al arrancar. */
  updateNotes: { version: string; notes: Record<string, ReleaseNotes> } | null;
  /** Accesibilidad. */
  dyslexia: boolean;
  contrast: boolean;
  uiScale: number;
  reduceMotion: boolean;
  /** Atajos cambiados por el usuario (id → combinación; "" = sin atajo). */
  keys: Record<string, string>;
}

export interface ReleaseNotes {
  nuevo: string[];
  mejorado: string[];
  corregido: string[];
}

export interface AppInfo {
  version: string;
  portable: boolean;
  data_dir: string;
  backups_dir: string;
  startup_file: string | null;
  flags: string[];
}

export interface Opened {
  path: string;
  root: string;
  manifest: Manifest;
  words: Record<string, number>;
  orphans: string[];
  missing: string[];
}

export type View =
  | "hoja"
  | "corcho"
  | "escaleta"
  | "estructura"
  | "rejilla"
  | "copo"
  | "codice"
  | "telarana"
  | "cronos"
  | "mapa"
  | "linajes"
  | "mural"
  | "pulso"
  | "imprenta"
  | "termometro"
  | "repaso"
  | "calendario";
