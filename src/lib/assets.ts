/** Imágenes y documentos del proyecto, leídos una vez y guardados en memoria. */
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import { api, errorText, type Imported } from "./api";

const cache = new Map<string, Promise<string>>();

export function assetUrl(rel: string): Promise<string> {
  const root = useStore.getState().project?.root;
  if (!root) return Promise.reject(new Error("Sin proyecto"));
  const key = root + "|" + rel;
  let p = cache.get(key);
  if (!p) {
    p = api.assetRead(root, rel);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export function forgetAsset(rel: string) {
  const root = useStore.getState().project?.root;
  if (root) cache.delete(root + "|" + rel);
}

export function useAsset(rel: string | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (rel) void assetUrl(rel).then((u) => alive && setUrl(u), () => {});
    return () => {
      alive = false;
    };
  }, [rel]);
  return url;
}

/** `data:` URL → Blob URL (el visor de PDF del navegador no abre data: grandes). */
export function useBlobUrl(dataUrl: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!dataUrl) return setUrl(null);
    const [head, b64] = dataUrl.split(",", 2);
    const mime = /data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [dataUrl]);
  return url;
}

export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

/** Pide archivos al usuario y los copia en el proyecto. */
export async function importFiles(dir: "recursos" | "investigacion", extensions: string[], multiple = true): Promise<Imported[]> {
  const st = useStore.getState();
  const root = st.project?.root;
  if (!root) return [];
  const picked = await open({ multiple, directory: false, filters: [{ name: "Archivos", extensions }] });
  const list = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  const out: Imported[] = [];
  for (const src of list) {
    try {
      out.push(await api.assetImport(root, src, dir));
    } catch (e) {
      st.toast(errorText(e), "error");
    }
  }
  return out;
}
