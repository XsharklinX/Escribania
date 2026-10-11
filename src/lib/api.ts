import { invoke } from "@tauri-apps/api/core";
import type { AppInfo, Manifest, Opened } from "../types";
import type { SearchQuery } from "../store";
import { markOwn } from "./ownWrites";

export interface NewText {
  id: string;
  file: string;
  title: string;
  body: string;
}

export interface Hit {
  index: number;
  before: string;
  matched: string;
  after: string;
}

export interface FileHits {
  file: string;
  count: number;
  hits: Hit[];
}

export interface HistoryVersion {
  source: "snapshot" | "backup";
  key: string;
  when: string;
  label: string;
  words: number;
}

export interface Snapshot {
  stamp: string;
  name: string;
  words: number;
}

export interface Imported {
  rel: string;
  name: string;
  mime: string;
  size: number;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  settingsLoad: () => invoke<unknown>("settings_load"),
  settingsSave: (settings: unknown) => invoke<void>("settings_save", { settings }),
  projectCreate: (dir: string, name: string, manifest: Manifest, texts: NewText[]) =>
    invoke<string>("project_create", { dir, name, manifest, texts }),
  projectOpen: (path: string) => invoke<Opened>("project_open", { path }),
  projectSave: async (path: string, manifest: Manifest) => {
    markOwn("@manifest");
    await invoke<void>("project_save", { path, manifest });
    markOwn("@manifest");
  },
  textRead: (root: string, file: string) => invoke<string>("text_read", { root, file }),
  textWrite: async (root: string, file: string, id: string, title: string, body: string) => {
    markOwn(file);
    const n = await invoke<number>("text_write", { root, file, id, title, body });
    markOwn(file);
    return n;
  },
  textDelete: (root: string, file: string) => invoke<void>("text_delete", { root, file }),
  fileWriteText: (path: string, text: string) => invoke<void>("file_write_text", { path, text }),
  fileWriteBytes: (path: string, bytes: Uint8Array) => invoke<void>("file_write_bytes", { path, bytes: Array.from(bytes) }),
  projectBackup: (root: string, keep: number) => invoke<string>("project_backup", { root, keep }),

  search: (root: string, files: string[], q: SearchQuery) => invoke<FileHits[]>("project_search", { root, files, q }),
  replace: (root: string, files: string[], q: SearchQuery, withText: string) =>
    invoke<Record<string, number>>("project_replace", { root, files, q, with: withText }),
  mentions: (root: string, files: string[], terms: { id: string; names: string[] }[]) =>
    invoke<Record<string, Record<string, number>>>("codex_mentions", { root, files, terms }),

  snapshotCreate: (root: string, id: string, name: string, body: string) => invoke<Snapshot>("snapshot_create", { root, id, name, body }),
  snapshotList: (root: string, id: string) => invoke<Snapshot[]>("snapshot_list", { root, id }),
  fileReadText: (path: string) => invoke<string>("file_read_text", { path }),
  textHistory: (root: string, id: string, file: string) => invoke<HistoryVersion[]>("text_history", { root, id, file }),
  textHistoryRead: (root: string, id: string, file: string, source: string, key: string) => invoke<string>("text_history_read", { root, id, file, source, key }),
  snapshotRead: (root: string, id: string, stamp: string) => invoke<string>("snapshot_read", { root, id, stamp }),
  snapshotDelete: (root: string, id: string, stamp: string) => invoke<void>("snapshot_delete", { root, id, stamp }),

  assetImport: (root: string, src: string, dir: "recursos" | "investigacion") => invoke<Imported>("asset_import", { root, src, dir }),
  assetRead: (root: string, rel: string) => invoke<string>("asset_read", { root, rel }),
  assetReadText: (root: string, rel: string) => invoke<string>("asset_read_text", { root, rel }),
  assetWriteText: (root: string, dir: "recursos" | "investigacion", stem: string, ext: string, text: string) =>
    invoke<string>("asset_write_text", { root, dir, stem, ext, text }),
  assetDelete: (root: string, rel: string) => invoke<void>("asset_delete", { root, rel }),
  webFetch: (url: string) => invoke<{ title: string; html: string; url: string }>("web_fetch", { url }),
  projectJsonRead: (root: string, name: string) => invoke<unknown>("project_json_read", { root, name }),
  projectJsonWrite: (root: string, name: string, value: unknown) => invoke<void>("project_json_write", { root, name, value }),
  appJsonRead: (name: string) => invoke<unknown>("app_json_read", { name }),
  appJsonWrite: (name: string, value: unknown) => invoke<void>("app_json_write", { name, value }),

  typeset: (root: string, source: string, files: Record<string, string>, out: string | null) =>
    invoke<{ pages: number; warnings: string[]; bytes: number }>("typeset", { root, source, files, out }),
  typesetLast: () => invoke<ArrayBuffer>("typeset_last"),
  typesetPage: (index: number, scale: number) => invoke<ArrayBuffer>("typeset_page", { index, scale }),
  typesetFonts: (root: string | null) => invoke<string[]>("typeset_fonts", { root }),
  epubBuild: (root: string, book: unknown, out: string) => invoke<number>("epub_build", { root, book, out }),
  importProject: (kind: ImportKind, path: string) => invoke<Imported>("import_project", { kind, path }),
  docxReview: (path: string) => invoke<Imported>("docx_review", { path }),
  textsStats: (root: string, files: string[]) => invoke<Record<string, TextStats>>("texts_stats", { root, files }),
};

export type ImportKind = "scrivener" | "manuskript" | "docx" | "markdown";

export interface ImpComment {
  id: string;
  author: string;
  date: string;
  text: string;
}

export interface ImpNode {
  kind: "folder" | "text" | "file";
  title: string;
  body: string;
  synopsis: string;
  notes: string;
  include: boolean;
  children: ImpNode[];
  comments: ImpComment[];
  src: string;
}

export interface Imported {
  title: string;
  author: string;
  manuscript: ImpNode[];
  research: ImpNode[];
  notes: ImpNode[];
  codex: { kind: string; name: string; description: string; fields: [string, string][] }[];
  warnings: string[];
}

export interface TextStats {
  words: number;
  dialogue: number;
  sentences: number;
  paragraphs: number;
  longest: number;
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
