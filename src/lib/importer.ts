/** Puentes: vuelca lo importado (Scrivener, Manuskript, Word, Markdown) en el proyecto abierto. */
import { useStore } from "../store";
import type { CodexEntry, CodexKind, TreeNode } from "../types";
import { api, type Imported, type ImpNode } from "./api";
import { folder, text } from "./templates";
import { newCodexEntry, CODEX_KINDS } from "./model";
import { newId } from "./ids";
import { tNow } from "./i18n";

async function convert(n: ImpNode, root: string, warnings: string[]): Promise<TreeNode | null> {
  if (n.kind === "folder") {
    const f = folder(n.title || tNow("tpl.untitled"));
    f.include = n.include;
    f.synopsis = n.synopsis;
    f.notes = n.notes;
    f.open = false;
    for (const c of n.children) {
      const x = await convert(c, root, warnings);
      if (x) f.children!.push(x);
    }
    return f;
  }
  if (n.kind === "file") {
    try {
      const a = await api.assetImport(root, n.src, "investigacion");
      return { id: newId(), type: "file", title: n.title, asset: a.rel, mime: a.mime, status: "draft", include: false, synopsis: n.synopsis, notes: n.notes, target: 0 };
    } catch (e) {
      warnings.push(String(e));
      return null;
    }
  }
  const t = text(n.title || tNow("tpl.untitled"));
  t.include = n.include;
  t.synopsis = n.synopsis;
  t.notes = n.notes;
  t.status = "draft";
  if (n.comments.length)
    t.comments = n.comments.map((c) => ({ id: c.id, text: c.text, author: c.author, created: c.date || new Date().toISOString(), resolved: false }));
  await api.textWrite(root, t.file!, t.id, t.title, n.body);
  return t;
}

/** `replace`: el manuscrito importado sustituye al actual (proyecto recién creado). */
export async function applyImport(imp: Imported, source: string, replace: boolean): Promise<{ texts: number; warnings: string[] }> {
  const st = useStore.getState();
  const p = st.project!;
  const warnings = [...imp.warnings];
  let count = 0;
  const all = async (list: ImpNode[]) => {
    const out: TreeNode[] = [];
    for (const n of list) {
      const x = await convert(n, p.root, warnings);
      if (x) out.push(x);
    }
    return out;
  };
  const countTexts = (l: ImpNode[]): number => l.reduce((s, n) => s + (n.kind === "text" ? 1 : 0) + countTexts(n.children), 0);
  count = countTexts(imp.manuscript) + countTexts(imp.research) + countTexts(imp.notes);

  const manuscript = await all(imp.manuscript);
  const research = await all(imp.research);
  const notes = await all(imp.notes);
  const entries: CodexEntry[] = [];
  for (const c of imp.codex) {
    const kind = (CODEX_KINDS as string[]).includes(c.kind) ? (c.kind as CodexKind) : "lore";
    const e = newCodexEntry(kind, c.name, st.settings.lang, [...p.manifest.codex, ...entries]);
    e.fields = c.fields.map(([k, v]) => ({ k, v }));
    await api.textWrite(p.root, e.file, e.id, e.name, c.description);
    entries.push(e);
  }

  st.editManifest((m) => {
    if (replace) {
      m.sections.manuscript = manuscript;
      if (imp.title) m.title = imp.title;
      if (imp.author && !m.author) m.author = imp.author;
    } else if (manuscript.length) {
      const f = folder(tNow("imp.folder", { s: source }), manuscript);
      f.include = false;
      m.sections.manuscript.push(f);
    }
    if (research.length) m.sections.research.push(...(replace ? research : [folder(tNow("imp.folder", { s: source }), research)]));
    if (notes.length) m.sections.notes.push(folder(tNow("imp.folder", { s: source }), notes));
    m.codex.push(...entries);
  });
  // Recontar palabras de lo importado.
  const o = await api.projectOpen(p.path).catch(() => null);
  if (o) useStore.setState({ words: { ...useStore.getState().words, ...o.words } });
  return { texts: count, warnings };
}
