/**
 * Temas propios: paletas hechas por el usuario o importadas de otra persona.
 * Se guardan en la carpeta de datos (`temas.json`) y se comparten como .json.
 * Un tema propio parte de uno claro u oscuro y sustituye sus colores.
 */
import { create } from "zustand";
import { api } from "./api";
import { newId } from "./ids";

export const THEME_VARS = ["bg", "panel", "paper", "text", "sub", "line", "acc", "acc-text", "sel", "hover", "danger", "ok"] as const;
export type ThemeVar = (typeof THEME_VARS)[number];

export interface CustomTheme {
  id: string;
  name: string;
  dark: boolean;
  colors: Record<ThemeVar, string>;
}

const FILE = "temas.json";

export async function loadThemes(): Promise<CustomTheme[]> {
  try {
    const raw = (await api.appJsonRead(FILE)) as { themes?: CustomTheme[] } | null;
    return raw?.themes ?? [];
  } catch {
    return [];
  }
}

export async function saveThemes(themes: CustomTheme[]) {
  await api.appJsonWrite(FILE, { themes });
}

/** Colores del tema que se ve ahora (para empezar uno nuevo desde ahí). */
export function currentColors(): Record<ThemeVar, string> {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(THEME_VARS.map((v) => [v, toHex(cs.getPropertyValue(`--${v}`).trim())])) as Record<ThemeVar, string>;
}

function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + [...c.slice(1)].map((x) => x + x).join("");
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("") : "#888888";
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Pone (o quita, con null) los colores de un tema propio en la raíz. */
export function applyCustomTheme(t: CustomTheme | null) {
  const r = document.documentElement;
  for (const v of THEME_VARS) r.style.removeProperty(`--${v}`);
  if (!t) return;
  for (const v of THEME_VARS) if (HEX.test(t.colors[v] ?? "")) r.style.setProperty(`--${v}`, t.colors[v]);
  r.style.colorScheme = t.dark ? "dark" : "light";
}

export function themeFile(t: CustomTheme): string {
  return JSON.stringify({ app: "escribania-tema", version: 1, name: t.name, dark: t.dark, colors: t.colors }, null, 2);
}

/** Lee un tema compartido; solo acepta colores #rrggbb. */
export function parseThemeFile(text: string): CustomTheme {
  const raw = JSON.parse(text) as { app?: string; name?: unknown; dark?: unknown; colors?: Record<string, unknown> };
  if (raw.app !== "escribania-tema" || typeof raw.name !== "string" || !raw.colors) throw new Error("not a theme");
  const colors = {} as Record<ThemeVar, string>;
  for (const v of THEME_VARS) {
    const c = raw.colors[v];
    colors[v] = typeof c === "string" && HEX.test(c) ? c : "#888888";
  }
  return { id: newId(), name: raw.name.slice(0, 60), dark: Boolean(raw.dark), colors };
}

export const useThemes = create<{ themes: CustomTheme[] }>(() => ({ themes: [] }));

export async function initThemes() {
  useThemes.setState({ themes: await loadThemes() });
}
