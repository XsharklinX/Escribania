/**
 * Extensiones: pequeños programas en JavaScript que añaden órdenes a la paleta
 * (Ctrl+K). Cada una se ejecuta en un Web Worker aislado: no ve la ventana,
 * ni los archivos, ni la red (la política de seguridad de la app la corta).
 * Solo recibe el texto de la escena abierta y devuelve lo que quiere hacer.
 *
 * Una extensión es un archivo .js con una cabecera y llamadas a `escribania.command`:
 *
 *   // @name Quitar dobles espacios
 *   // @description Deja un solo espacio entre palabras.
 *   // @version 1.0
 *   // @author Ana
 *   escribania.command("Quitar dobles espacios", (scene) => ({ replace: scene.text.replace(/ {2,}/g, " ") }));
 *
 * La función recibe { title, text, selection } y devuelve (o promete) un objeto con
 * `replace` (sustituye el texto de la escena), `insert` (en el cursor) y/o `message`.
 */
import { create } from "zustand";
import { api } from "./api";
import { newId } from "./ids";

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  code: string;
  enabled: boolean;
}

export interface PluginResult {
  replace?: string;
  insert?: string;
  message?: string;
}

const FILE = "extensiones.json";

export function parseHeader(code: string): Omit<Plugin, "id" | "code" | "enabled"> {
  const get = (k: string) => new RegExp(`^\\s*//\\s*@${k}\\s+(.+)$`, "m").exec(code)?.[1].trim() ?? "";
  return { name: get("name") || "Extensión", description: get("description"), version: get("version") || "1.0", author: get("author") };
}

export function makePlugin(code: string): Plugin {
  return { id: newId(), ...parseHeader(code), code, enabled: true };
}

export async function loadPlugins(): Promise<Plugin[]> {
  try {
    const raw = (await api.appJsonRead(FILE)) as { plugins?: Plugin[] } | null;
    return raw?.plugins ?? [];
  } catch {
    return [];
  }
}

export async function savePlugins(list: Plugin[]) {
  await api.appJsonWrite(FILE, { plugins: list });
  await startPlugins(list);
}

/** Lo que se ejecuta dentro del Worker antes del código de la extensión. */
const PRELUDE = `
const __cmds = {};
self.escribania = { command(name, fn) { if (typeof name === "string" && typeof fn === "function") __cmds[name] = fn; } };
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "list") { self.postMessage({ type: "list", commands: Object.keys(__cmds) }); return; }
  if (m.type === "run") {
    try {
      const r = await __cmds[m.command]?.(m.scene);
      const out = {};
      if (r && typeof r.replace === "string") out.replace = r.replace;
      if (r && typeof r.insert === "string") out.insert = r.insert;
      if (r && r.message != null) out.message = String(r.message);
      self.postMessage({ type: "done", id: m.id, result: out });
    } catch (err) { self.postMessage({ type: "done", id: m.id, error: String(err && err.message || err) }); }
  }
};
`;

interface Running {
  plugin: Plugin;
  worker: Worker;
  commands: string[];
}

export const usePlugins = create<{ running: Running[]; errors: Record<string, string> }>(() => ({ running: [], errors: {} }));

function spawn(p: Plugin): Promise<Running | string> {
  return new Promise((resolve) => {
    let url = "";
    try {
      url = URL.createObjectURL(new Blob([PRELUDE, "\n;\n", p.code], { type: "text/javascript" }));
      const worker = new Worker(url);
      const timer = setTimeout(() => {
        worker.terminate();
        resolve("No responde");
      }, 3000);
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(e.message || "Error al cargar");
      };
      worker.onmessage = (e) => {
        if (e.data?.type !== "list") return;
        clearTimeout(timer);
        resolve({ plugin: p, worker, commands: e.data.commands });
      };
      worker.postMessage({ type: "list" });
    } catch (e) {
      resolve(String(e));
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  });
}

export async function startPlugins(list?: Plugin[]) {
  for (const r of usePlugins.getState().running) r.worker.terminate();
  const plugins = (list ?? (await loadPlugins())).filter((p) => p.enabled);
  const running: Running[] = [];
  const errors: Record<string, string> = {};
  for (const p of plugins) {
    const r = await spawn(p);
    if (typeof r === "string") errors[p.id] = r;
    else running.push(r);
  }
  usePlugins.setState({ running, errors });
}

export function runCommand(pluginId: string, command: string, scene: { title: string; text: string; selection: string }): Promise<PluginResult> {
  const r = usePlugins.getState().running.find((x) => x.plugin.id === pluginId);
  if (!r) return Promise.reject(new Error("La extensión no está activa"));
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      r.worker.removeEventListener("message", onMsg);
      reject(new Error("La extensión tardó demasiado"));
    }, 15000);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "done" || e.data.id !== id) return;
      clearTimeout(timer);
      r.worker.removeEventListener("message", onMsg);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result as PluginResult);
    };
    r.worker.addEventListener("message", onMsg);
    r.worker.postMessage({ type: "run", id, command, scene });
  });
}

/** Galería: extensiones de ejemplo que vienen con la app. */
export const GALLERY: string[] = [
  `// @name Quitar dobles espacios
// @description Deja un solo espacio entre palabras y quita los espacios antes de la puntuación.
// @version 1.0
// @author Escribanía
escribania.command("Quitar dobles espacios", (scene) => ({
  replace: scene.text.replace(/[ \\t]{2,}/g, " ").replace(/ +([,.;:!?…»”])/g, "$1"),
  message: "Espacios revisados.",
}));`,
  `// @name Contar adverbios en -mente
// @description Cuenta los adverbios terminados en -mente de la escena y dice cuáles se repiten.
// @version 1.0
// @author Escribanía
escribania.command("Contar adverbios en -mente", (scene) => {
  const words = (scene.text.toLowerCase().match(/\\b\\p{L}+mente\\b/gu) || []);
  const count = {};
  for (const w of words) count[w] = (count[w] || 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w, n]) => w + " (" + n + ")").join(", ");
  return { message: words.length ? words.length + " adverbios en -mente: " + top : "Ningún adverbio en -mente." };
});`,
  `// @name Rayas de diálogo
// @description Cambia los guiones al principio de párrafo («- Hola») por rayas de diálogo («—Hola»).
// @version 1.0
// @author Escribanía
escribania.command("Convertir guiones en rayas de diálogo", (scene) => ({
  replace: scene.text.replace(/^[-–]\\s*/gm, "—").replace(/\\s[-–]\\s?(?=\\p{Ll})/gu, " —"),
  message: "Guiones convertidos en rayas.",
}));`,
  `// @name Fecha de hoy
// @description Escribe la fecha de hoy en el cursor (útil para diarios y notas).
// @version 1.0
// @author Escribanía
escribania.command("Insertar la fecha de hoy", () => ({
  insert: new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
}));`,
];
