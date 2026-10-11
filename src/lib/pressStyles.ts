/**
 * Estilos de imprenta propios: los ajustes de maquetación de un libro guardados
 * con nombre para reutilizarlos en otros proyectos. Viven en la carpeta de
 * datos (`estilos.json`) y se pueden compartir como archivo `.json`.
 */
import type { CompileOptions, PublishOptions } from "../types";
import { api } from "./api";
import { newId } from "./ids";

export const PUBLISH_KEYS = ["trim", "font", "fontSize", "leading", "style", "dropCaps", "smallCaps", "headers", "recto", "toc", "halfTitle"] as const;
export const COMPILE_KEYS = ["separator", "folderTitles", "textTitles", "chapterPageBreak"] as const;

export interface PressStyle {
  id: string;
  name: string;
  publish: Partial<Pick<PublishOptions, (typeof PUBLISH_KEYS)[number]>>;
  compile: Partial<Pick<CompileOptions, (typeof COMPILE_KEYS)[number]>>;
  created: string;
}

const FILE = "estilos.json";

export async function loadStyles(): Promise<PressStyle[]> {
  try {
    const raw = (await api.appJsonRead(FILE)) as { styles?: PressStyle[] } | null;
    return raw?.styles ?? [];
  } catch {
    return [];
  }
}

export async function saveStyles(styles: PressStyle[]) {
  await api.appJsonWrite(FILE, { styles });
}

export function styleFrom(name: string, publish: PublishOptions, compile: CompileOptions): PressStyle {
  const p: Record<string, unknown> = {};
  const c: Record<string, unknown> = {};
  for (const k of PUBLISH_KEYS) p[k] = publish[k];
  for (const k of COMPILE_KEYS) c[k] = compile[k];
  return { id: newId(), name, publish: p as PressStyle["publish"], compile: c as PressStyle["compile"], created: new Date().toISOString() };
}

/** Aplica un estilo: solo las claves conocidas y con el tipo correcto (los archivos de fuera pueden traer cualquier cosa). */
export function applyStyle(style: PressStyle, publish: PublishOptions, compile: CompileOptions) {
  for (const k of PUBLISH_KEYS) {
    const v = style.publish?.[k];
    if (v !== undefined && typeof v === typeof publish[k]) (publish as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of COMPILE_KEYS) {
    const v = style.compile?.[k];
    if (v !== undefined && typeof v === typeof compile[k]) (compile as unknown as Record<string, unknown>)[k] = v;
  }
}

/** Lee un estilo compartido. Lanza un error si el archivo no lo es. */
export function parseStyleFile(text: string): PressStyle {
  const raw = JSON.parse(text) as Partial<PressStyle> & { app?: string };
  if (raw.app !== "escribania-estilo" || typeof raw.name !== "string" || typeof raw.publish !== "object") throw new Error("not a style");
  return { id: newId(), name: raw.name.slice(0, 80), publish: raw.publish ?? {}, compile: raw.compile ?? {}, created: new Date().toISOString() };
}

export function styleFile(style: PressStyle): string {
  return JSON.stringify({ app: "escribania-estilo", version: 1, name: style.name, publish: style.publish, compile: style.compile }, null, 2);
}
