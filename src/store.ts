import { create } from "zustand";
import type { AppInfo, Lang, Manifest, Recent, Settings, View } from "./types";

function defaultLang(): Lang {
  return typeof navigator !== "undefined" && !navigator.language?.toLowerCase().startsWith("es") ? "en" : "es";
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "algodon",
  lang: defaultLang(),
  font: "literata",
  fontSize: 18,
  lineWidth: 680,
  lineHeight: 1.7,
  paragraph: "indent",
  typewriter: false,
  backupKeep: 20,
  backupMinutes: 15,
  binderOpen: true,
  inspectorOpen: true,
  ambientVolume: 0.5,
  recent: [],
  authorName: "",
  mentions: true,
  showResolved: false,
  sprintMinutes: 25,
  sprintGoal: 500,
  sprintBreak: true,
  outlineColumns: ["synopsis", "pov", "day", "status", "words"],
  quickCapture: true,
  spell: "app",
  lens: false,
  lensLong: 40,
  crutches: "",
  ttsVoice: "",
  ttsRate: 1,
  contact: { legalName: "", address: "", email: "", phone: "" },
  updates: "stable",
  updateChecked: "",
  updateNotes: null,
  dyslexia: false,
  contrast: false,
  uiScale: 1,
  reduceMotion: false,
  keys: {},
};

export type SaveState = "saved" | "pending" | "saving" | "error";

export interface Project {
  path: string;
  root: string;
  manifest: Manifest;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

export interface SearchQuery {
  query: string;
  regex: boolean;
  case: boolean;
  word: boolean;
}

/** Panel lateral derecho de la Hoja partida. */
export type Split = { kind: "text" | "codex" | "research"; id: string } | null;

export interface Sprint {
  start: number;
  minutes: number;
  goal: number;
  /** Palabras escritas en la bitácora al empezar. */
  base: number;
  brave: boolean;
  /** Fin del descanso tras terminar (pomodoro). */
  breakUntil?: number;
  finished?: boolean;
}

interface State {
  info: AppInfo | null;
  settings: Settings;
  settingsLoaded: boolean;
  project: Project | null;
  words: Record<string, number>;
  selected: string | null;
  renaming: string | null;
  sessionStart: number;
  saveState: SaveState;
  retiro: boolean;
  /** Escritura sin red (solo en Retiro, se apaga al salir). */
  noNet: boolean;
  /** Máquina del tiempo abierta sobre este texto. */
  timeMachine: string | null;
  /** Colección elegida en el Legajo (lista plana en lugar del árbol). */
  collection: string | null;
  /** Recorrido guiado: paso actual (null = cerrado). */
  tour: number | null;
  dialog: null | "settings" | "export" | "capture" | "sprint" | "import";
  toasts: Toast[];

  view: View;
  leftPanel: "binder" | "search";
  split: Split;
  codexSelected: string | null;
  palette: boolean;
  search: SearchQuery;
  /** Coincidencia a señalar al abrir un texto desde la búsqueda. */
  jump: { file: string; index: number } | null;
  /** Se incrementa para volver a cargar los editores desde disco. */
  reload: number;
  /** Ficha → archivo → nº de menciones (Ecos). */
  mentions: Record<string, Record<string, number>>;
  sprint: Sprint | null;
  /** Para avisar a la bitácora de cada cambio. */
  journalTick: number;

  setSettings: (patch: Partial<Settings>) => void;
  /** Cambia el manifiesto sobre una copia; el guardado se programa en saver.ts. */
  editManifest: (fn: (m: Manifest) => void) => void;
  setWords: (file: string, n: number) => void;
  select: (id: string | null) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dropToast: (id: number) => void;
  setView: (v: View) => void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  info: null,
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  project: null,
  words: {},
  selected: null,
  renaming: null,
  sessionStart: 0,
  saveState: "saved",
  retiro: false,
  noNet: false,
  timeMachine: null,
  collection: null,
  tour: null,
  dialog: null,
  toasts: [],
  view: "hoja",
  leftPanel: "binder",
  split: null,
  codexSelected: null,
  palette: false,
  search: { query: "", regex: false, case: false, word: false },
  jump: null,
  reload: 0,
  mentions: {},
  sprint: null,
  journalTick: 0,

  setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
  editManifest: (fn) => {
    const p = get().project;
    if (!p) return;
    const m = structuredClone(p.manifest);
    fn(m);
    m.modified = new Date().toISOString();
    set({ project: { ...p, manifest: m } });
  },
  setWords: (file, n) => {
    if (get().words[file] === n) return;
    set({ words: { ...get().words, [file]: n } });
  },
  select: (id) => set({ selected: id }),
  toast: (text, kind = "info") => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dropToast(id), kind === "error" ? 8000 : 4500);
  },
  dropToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setView: (view) => set({ view }),
}));

export function pushRecent(recent: Recent[], path: string, title: string): Recent[] {
  const rest = recent.filter((r) => r.path !== path);
  return [{ path, title, opened: new Date().toISOString() }, ...rest].slice(0, 12);
}
