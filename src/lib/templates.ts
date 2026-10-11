import type { CompileOptions, Lang, Manifest, TreeNode } from "../types";
import type { NewText } from "./api";
import { translate, type TKey } from "./i18n";
import { newId, textFileFor } from "./ids";
import { normalizeManifest } from "./model";

export const TEMPLATES = ["novel", "stories", "essay", "poetry", "script", "blank"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export function folder(title: string, children: TreeNode[] = []): TreeNode {
  return { id: newId(), type: "folder", title, status: "draft", include: true, synopsis: "", notes: "", target: 0, open: true, children };
}

export function text(title: string): TreeNode {
  const id = newId();
  return { id, type: "text", title, file: textFileFor(title, id), status: "idea", include: true, synopsis: "", notes: "", target: 0 };
}

const COMPILE: CompileOptions = {
  titlePage: true,
  folderTitles: true,
  textTitles: false,
  separator: "* * *",
  chapterPageBreak: true,
  font: "Times New Roman",
  manuscriptFormat: false,
  glossary: false,
};

export function buildProject(tpl: TemplateId, lang: Lang, title: string, author: string): { manifest: Manifest; texts: NewText[] } {
  const t = (k: TKey) => translate(lang, k);
  let manuscript: TreeNode[];
  const compile = { ...COMPILE };
  switch (tpl) {
    case "novel":
      manuscript = [folder(t("tpl.part"), [folder(t("tpl.chapter"), [text(t("tpl.scene"))])])];
      break;
    case "stories":
      manuscript = [text(t("tpl.story1")), text(t("tpl.story2"))];
      compile.textTitles = true;
      break;
    case "essay":
      manuscript = [text(t("tpl.intro")), text(t("tpl.chapter")), text(t("tpl.conclusion"))];
      compile.textTitles = true;
      compile.separator = "";
      break;
    case "poetry":
      manuscript = [folder(t("tpl.section"), [text(t("tpl.poem"))])];
      compile.textTitles = true;
      compile.separator = "";
      break;
    case "script":
      manuscript = [folder(t("tpl.act"), [{ ...text(t("tpl.scene")), screenplay: true }])];
      compile.font = "Courier New";
      break;
    default:
      manuscript = [text(t("tpl.untitled"))];
      compile.titlePage = false;
  }
  const ideas = text(t("tpl.ideas"));
  ideas.include = false;
  const now = new Date().toISOString();
  const manifest = {
    app: "escribania",
    format: 1,
    id: newId(10),
    title,
    author,
    template: tpl,
    created: now,
    modified: now,
    target: { words: tpl === "novel" ? 80000 : 0, deadline: null, restDays: [] },
    prefs: { quotes: lang === "es" ? "latin" : "english", dialogueDash: true, trackChanges: false },
    compile,
    sections: { manuscript, research: [], notes: [ideas], trash: [] },
    codex: [],
    relations: [],
    boards: [],
    structure: { template: null, beats: {} },
  } as unknown as Manifest;
  normalizeManifest(manifest);
  const texts: NewText[] = [];
  const collect = (list: TreeNode[]) =>
    list.forEach((n) => {
      if (n.file) texts.push({ id: n.id, file: n.file, title: n.title, body: n === ideas ? t("tpl.ideasBody") : "" });
      if (n.children) collect(n.children);
    });
  collect(manuscript);
  collect([ideas]);
  return { manifest, texts };
}
