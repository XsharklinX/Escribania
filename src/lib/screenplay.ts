/**
 * Modo guion: cada párrafo es un elemento de Fountain y se reconoce solo:
 * encabezado de escena (INT./EXT.), personaje (en mayúsculas), acotación
 * (entre paréntesis), diálogo, transición (CORTE A:) o acción.
 * Tab cambia el tipo del párrafo vacío o actual.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type SpType = "scene" | "action" | "character" | "paren" | "dialogue" | "transition" | "center";

const SCENE = /^(\.(?!\.)|(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s])/i;
const TRANSITION = /^(>(?!.*<$)|[A-ZÁÉÍÓÚÑ ]+(TO|A):$|(FUNDIDO|CORTE|DISOLVENCIA|ENCADENADO|FADE)\b.*[:.]$)/;

/** Tipo de cada párrafo según Fountain (el anterior importa: personaje → diálogo). */
export function classify(lines: string[]): SpType[] {
  const out: SpType[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const prev = out[i - 1];
    let type: SpType = "action";
    if (!t) type = "action";
    else if (/^>.*<$/.test(t)) type = "center";
    else if (SCENE.test(t)) type = "scene";
    else if (TRANSITION.test(t)) type = "transition";
    else if (/^\(.*\)$/.test(t) && (prev === "character" || prev === "dialogue" || prev === "paren")) type = "paren";
    else if (prev === "character" || prev === "paren") type = "dialogue";
    else if (t.startsWith("@") || (t.length < 45 && /\p{Lu}/u.test(t) && t === t.toLocaleUpperCase() && !/[.!?]$/.test(t.replace(/\s*\(.*\)$/, "")))) type = "character";
    out.push(type);
  }
  return out;
}

const CYCLE: SpType[] = ["action", "scene", "character", "paren", "dialogue", "transition"];

function convert(text: string, to: SpType): string {
  const bare = text.replace(/^(INT\.|EXT\.|\.|@|>)\s*/i, "").replace(/^\((.*)\)$/, "$1").replace(/(:)$/, "");
  switch (to) {
    case "scene":
      return /^(INT|EXT)/i.test(text) ? text.toUpperCase() : `INT. ${bare.toUpperCase()}`;
    case "character":
      return bare.toLocaleUpperCase();
    case "paren":
      return `(${bare})`;
    case "transition":
      return `${bare.toLocaleUpperCase() || "CORTE A"}:`;
    default:
      return bare;
  }
}

const spKey = new PluginKey("screenplay");

function decorations(doc: PMNode): DecorationSet {
  const blocks: { pos: number; size: number; text: string }[] = [];
  doc.forEach((node, pos) => {
    if (node.isTextblock) blocks.push({ pos, size: node.nodeSize, text: node.textContent });
  });
  const types = classify(blocks.map((b) => b.text));
  return DecorationSet.create(
    doc,
    blocks.map((b, i) => Decoration.node(b.pos, b.pos + b.size, { class: `sp sp-${types[i]}` })),
  );
}

export const Screenplay = Extension.create<{ isOn: () => boolean }>({
  name: "screenplay",
  addOptions() {
    return { isOn: () => false };
  },
  addProseMirrorPlugins() {
    const { isOn } = this.options;
    return [
      new Plugin({
        key: spKey,
        props: {
          decorations: (state) => (isOn() ? decorations(state.doc) : null),
          handleKeyDown(view, event) {
            if (!isOn() || event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return false;
            event.preventDefault();
            const { state } = view;
            const $from = state.selection.$from;
            const block = $from.parent;
            if (!block.isTextblock) return true;
            const start = $from.start();
            const lines: string[] = [];
            let index = 0;
            state.doc.forEach((n, pos) => {
              if (n.isTextblock) {
                if (pos + 1 === start) index = lines.length;
                lines.push(n.textContent);
              }
            });
            const current = classify(lines)[index] ?? "action";
            const next = CYCLE[(CYCLE.indexOf(current) + (event.shiftKey ? CYCLE.length - 1 : 1)) % CYCLE.length];
            const text = convert(block.textContent, next);
            const tr = state.tr.insertText(text, start, start + block.content.size);
            const caret = next === "paren" ? start + text.length - 1 : start + text.length;
            tr.setSelection(TextSelection.create(tr.doc, caret));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

/** Párrafos de texto plano → .fountain (personaje, acotación y diálogo van juntos). */
export function toFountain(title: string, author: string, paragraphs: string[]): string {
  const types = classify(paragraphs);
  let out = `Title: ${title}\nAuthor: ${author}\n\n`;
  paragraphs.forEach((p, i) => {
    const glued = types[i] === "paren" || types[i] === "dialogue";
    out += (glued ? "\n" : "\n\n") + p.trim();
  });
  return out.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
