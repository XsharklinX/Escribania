/**
 * Pendientes: notas que el autor deja en el texto para sí mismo.
 *
 *   [TODO: comprobar la fecha]       entre corchetes: solo esa nota
 *   REVISAR: el diálogo suena falso   suelta: desde la marca hasta el final del párrafo
 *
 * Marcas reconocidas (en mayúsculas): TODO, REVISAR, PENDIENTE, FIXME, OJO.
 * Se resaltan en la Hoja, se listan en Repaso y nunca salen al exportar.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Manifest, TreeNode } from "../types";
import { walk } from "./tree";

export const TODO_WORDS = ["TODO", "REVISAR", "PENDIENTE", "FIXME", "OJO"];
const W = TODO_WORDS.join("|");
/** Para buscar en los archivos (motor de Rust: sin lookbehind). */
/** Los corchetes pueden venir escapados en el Markdown guardado («\[TODO: x\]»). */
const BRACKET = `\\\\?\\[(?:${W})\\b[^\\]\\n]*?\\\\?\\]`;
export const TODO_SEARCH = `${BRACKET}|\\b(?:${W})\\b[^\\n]*`;

/** Quita las notas de un texto en Markdown antes de exportarlo. */
export function stripTodos(md: string): string {
  return (
    md
      .replace(new RegExp(`\\s?${BRACKET}`, "g"), "")
      // Párrafo que empieza por la marca: fuera entero.
      .replace(new RegExp(`(^|\\n)(?:${W})\\b[^\\n]*(?=\\n|$)`, "g"), "$1")
      // Marca en mitad del párrafo: desde ella hasta el final del párrafo.
      .replace(new RegExp(`[ \\t]*\\b(?:${W})\\b:?[^\\n]*`, "g"), "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Texto de la nota sin la marca: «[TODO: la fecha]» → «la fecha». */
export function todoNote(matched: string): { word: string; note: string } {
  const m = new RegExp(`^\\\\?\\[?(${W})\\b:?\\s*(.*?)\\\\?\\]?$`).exec(matched.trim());
  return m ? { word: m[1], note: m[2].trim() } : { word: "TODO", note: matched };
}

export const todoKey = new PluginKey("todos");

/** Resalta las notas en la Hoja. */
export const TodoHighlight = Extension.create({
  name: "todoHighlight",
  addProseMirrorPlugins() {
    const re = new RegExp(TODO_SEARCH, "g");
    const build = (doc: import("@tiptap/pm/model").Node) => {
      const decos: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        const text = node.textBetween(0, node.content.size, undefined, "￼");
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          if (!m[0]) {
            re.lastIndex++;
            continue;
          }
          decos.push(Decoration.inline(pos + 1 + m.index, pos + 1 + m.index + m[0].length, { class: "todo-mark" }));
        }
        return false;
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: todoKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return todoKey.getState(state);
          },
        },
      }),
    ];
  },
});

export interface SceneIssue {
  id: string;
  title: string;
  kind: "noSynopsis" | "noPov" | "noStatus";
}

/** Escenas del Manuscrito a las que les falta algo (sinopsis, POV). */
export function sceneIssues(m: Manifest): SceneIssue[] {
  const out: SceneIssue[] = [];
  const hasCharacters = m.codex.some((e) => e.kind === "character");
  walk(m.sections.manuscript, (n: TreeNode) => {
    if (n.type !== "text" || !n.include) return;
    if (!n.synopsis.trim()) out.push({ id: n.id, title: n.title, kind: "noSynopsis" });
    if (hasCharacters && !n.pov) out.push({ id: n.id, title: n.title, kind: "noPov" });
    if (n.status === "idea") out.push({ id: n.id, title: n.title, kind: "noStatus" });
  });
  return out;
}
