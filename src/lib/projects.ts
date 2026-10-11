/** Abrir, crear y cerrar proyectos. */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pushRecent, useStore } from "../store";
import type { Manifest, TreeNode } from "../types";
import { api, errorText } from "./api";
import { tNow } from "./i18n";
import { backupNow, flushAll, startBackups, stopBackups } from "./saver";
import { bookWords, walk } from "./tree";
import { folder } from "./templates";
import { newId } from "./ids";
import { normalizeManifest } from "./model";
import { startJournal, stopJournal } from "./journal";
import { refreshMentions } from "./mentions";
import { stopAllAmbient } from "./ambient";

function firstText(m: Manifest): string | null {
  let id: string | null = null;
  walk(m.sections.manuscript, (n) => {
    if (!id && n.type === "text") id = n.id;
  });
  return id;
}

/** Los textos huérfanos (en texto/ pero no en el árbol) se recuperan en Notas. */
function adoptOrphans(m: Manifest, orphans: string[]) {
  if (!orphans.length) return;
  const nodes: TreeNode[] = orphans.map((file) => ({
    id: newId(),
    type: "text",
    title: file.replace(/^texto\//, "").replace(/\.md$/, ""),
    file,
    status: "draft",
    include: false,
    synopsis: "",
    notes: "",
    target: 0,
  }));
  m.sections.notes.push(folder(tNow("tree.recovered"), nodes));
}

export async function openProject(path: string): Promise<boolean> {
  const st = useStore.getState();
  try {
    const o = await api.projectOpen(path);
    const m = normalizeManifest(o.manifest);
    adoptOrphans(m, o.orphans);
    useStore.setState({
      project: { path: o.path, root: o.root, manifest: m },
      words: o.words,
      selected: firstText(m),
      sessionStart: bookWords(m, o.words),
      saveState: "saved",
      retiro: false,
      dialog: null,
      view: "hoja",
      leftPanel: "binder",
      split: null,
      codexSelected: null,
      jump: null,
      mentions: {},
      sprint: null,
    });
    if (o.orphans.length) {
      await api.projectSave(o.path, m);
      st.toast(tNow("toast.orphans", { n: o.orphans.length }));
    }
    if (o.missing.length) st.toast(tNow("toast.missing", { n: o.missing.length }));
    st.setSettings({ recent: pushRecent(st.settings.recent, o.path, m.title) });
    void api.settingsSave(useStore.getState().settings).catch(() => {});
    void getCurrentWindow().setTitle(`${m.title} — Escribanía`).catch(() => {});
    await startJournal(o.root);
    refreshMentions(300);
    void backupNow(true);
    startBackups();
    return true;
  } catch (e) {
    st.toast(`${tNow("toast.openError")}: ${errorText(e)}`, "error");
    return false;
  }
}

export async function closeProject() {
  await flushAll();
  await stopJournal();
  await backupNow();
  stopBackups();
  stopAllAmbient();
  useStore.setState({ project: null, words: {}, selected: null, retiro: false, dialog: null, split: null, sprint: null, palette: false });
  void getCurrentWindow().setTitle("Escribanía").catch(() => {});
}
