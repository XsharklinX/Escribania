/**
 * Paneles en otra ventana: el Códice, un mapa, la investigación o una escena
 * en una ventana aparte (para el segundo monitor). Son de solo lectura y se
 * actualizan solos: la ventana principal avisa cada vez que cambia el
 * proyecto o se guarda un texto.
 */
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStore } from "../store";
import type { Manifest } from "../types";

export type PanelKind = "codex" | "map" | "research" | "text";

export const MANIFEST_EVENT = "escribania:manifest";
export const TEXT_EVENT = "escribania:text";

export interface PanelParams {
  kind: PanelKind;
  id: string;
  path: string;
}

export function panelParams(): PanelParams | null {
  const q = new URLSearchParams(window.location.search);
  const kind = q.get("panel") as PanelKind | null;
  const path = q.get("path");
  if (!kind || !path) return null;
  return { kind, id: q.get("id") ?? "", path };
}

export async function openPanel(kind: PanelKind, id: string, title: string) {
  const p = useStore.getState().project;
  if (!p) return;
  const url = `index.html?panel=${kind}&id=${encodeURIComponent(id)}&path=${encodeURIComponent(p.path)}`;
  const w = new WebviewWindow(`panel-${Date.now()}`, { url, title: `${title} · Escribanía`, width: kind === "map" ? 900 : 560, height: 760, minWidth: 320, minHeight: 300 });
  w.once("tauri://error", (e) => useStore.getState().toast(String(e.payload), "error"));
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** En la ventana principal: avisar a los paneles cuando cambia el manifiesto. */
export function broadcastManifest(m: Manifest) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void emit(MANIFEST_EVENT, m).catch(() => {}), 400);
}

export function broadcastText(file: string) {
  void emit(TEXT_EVENT, file).catch(() => {});
}

export function onManifest(fn: (m: Manifest) => void) {
  return listen<Manifest>(MANIFEST_EVENT, (e) => fn(e.payload));
}

export function onText(fn: (file: string) => void) {
  return listen<string>(TEXT_EVENT, (e) => fn(e.payload));
}
