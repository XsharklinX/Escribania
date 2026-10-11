/**
 * Lápiz rojo: control de cambios en el editor.
 *
 * Con la revisión activada, lo que se escribe lleva la marca `insertion` y lo
 * que se borra no desaparece: recibe la marca `deletion` y se ve tachado.
 * Borrar algo que se había añadido en la revisión sí lo elimina de verdad.
 * Los cambios de estructura (Intro para partir un párrafo) no se registran.
 */
import { Extension, Mark } from "@tiptap/core";
import type { Node as PMNode, MarkType } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const Insertion = Mark.create({
  name: "insertion",
  priority: 1001,
  inclusive: true,
  excludes: "deletion",
  parseHTML: () => [{ tag: "ins" }],
  renderHTML: () => ["ins", { class: "track-ins" }, 0],
});

export const Deletion = Mark.create({
  name: "deletion",
  // Antes que el tachado normal, que también lee <del>.
  priority: 1001,
  inclusive: false,
  excludes: "insertion",
  parseHTML: () => [{ tag: "del" }],
  renderHTML: () => ["del", { class: "track-del" }, 0],
});

export interface Change {
  type: "ins" | "del";
  from: number;
  to: number;
  text: string;
}

/** Lista de cambios del documento, uniendo trozos contiguos del mismo tipo. */
export function changes(doc: PMNode): Change[] {
  const out: Change[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const type = node.marks.some((m) => m.type.name === "insertion") ? "ins" : node.marks.some((m) => m.type.name === "deletion") ? "del" : null;
    if (!type) return false;
    const last = out[out.length - 1];
    if (last && last.type === type && last.to === pos) {
      last.to = pos + node.nodeSize;
      last.text += node.text;
    } else out.push({ type, from: pos, to: pos + node.nodeSize, text: node.text ?? "" });
    return false;
  });
  return out;
}

/** Marca un rango como borrado; lo que era una inserción se elimina de verdad. */
function markDeleted(tr: Transaction, from: number, to: number, ins: MarkType, del: MarkType) {
  const pieces: { from: number; to: number; inserted: boolean }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    if (a < b) pieces.push({ from: a, to: b, inserted: node.marks.some((m) => m.type === ins) });
    return false;
  });
  for (const p of pieces.reverse()) {
    if (p.inserted) tr.delete(p.from, p.to);
    else tr.addMark(p.from, p.to, del.create());
  }
}

const trackKey = new PluginKey("trackChanges");

export const TrackChanges = Extension.create<{ isOn: () => boolean }>({
  name: "trackChanges",
  addOptions() {
    return { isOn: () => false };
  },
  addProseMirrorPlugins() {
    const { isOn } = this.options;
    const types = (state: EditorState) => ({ ins: state.schema.marks.insertion, del: state.schema.marks.deletion });
    const sameBlock = (state: EditorState, a: number, b: number) => state.doc.resolve(a).parent === state.doc.resolve(b).parent;

    const insertTracked = (view: EditorView, from: number, to: number, text: string) => {
      const { state } = view;
      const { ins, del } = types(state);
      const tr = state.tr;
      let at = to;
      if (from < to) {
        markDeleted(tr, from, to, ins, del);
        at = tr.mapping.map(to);
      }
      const marks = (state.storedMarks ?? state.doc.resolve(from).marks()).filter((m) => m.type !== del && m.type !== ins);
      tr.insert(at, state.schema.text(text, [...marks, ins.create()]));
      tr.setSelection(TextSelection.create(tr.doc, at + text.length));
      view.dispatch(tr.scrollIntoView());
    };

    return [
      new Plugin({
        key: trackKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (!isOn() || !sameBlock(view.state, from, to)) return false;
            insertTracked(view, from, to, text);
            return true;
          },
          handleKeyDown(view, event) {
            if (!isOn() || (event.key !== "Backspace" && event.key !== "Delete") || event.ctrlKey || event.metaKey || event.altKey) return false;
            const { state } = view;
            const { from, to, empty } = state.selection;
            let a = from;
            let b = to;
            if (empty) {
              if (event.key === "Backspace") a = from - 1;
              else b = to + 1;
            }
            if (a < 0 || b > state.doc.content.size || !sameBlock(state, a, b) || state.doc.resolve(a).parentOffset < 0) return false;
            // En el borde de un párrafo se deja el comportamiento normal (unir párrafos).
            const $a = state.doc.resolve(a);
            const $b = state.doc.resolve(b);
            if (!$a.parent.isTextblock || $a.pos < $a.start() || $b.pos > $b.end()) return false;
            const { ins, del } = types(state);
            const tr = state.tr;
            markDeleted(tr, a, b, ins, del);
            const cursor = event.key === "Backspace" ? tr.mapping.map(a, -1) : tr.mapping.map(b);
            tr.setSelection(TextSelection.create(tr.doc, cursor));
            view.dispatch(tr.scrollIntoView());
            return true;
          },
          handlePaste(view, event) {
            if (!isOn()) return false;
            const text = event.clipboardData?.getData("text/plain");
            const { from, to } = view.state.selection;
            if (!text || text.includes("\n") || !sameBlock(view.state, from, to)) return false;
            insertTracked(view, from, to, text);
            return true;
          },
          handleDOMEvents: {
            cut(view, event) {
              if (!isOn()) return false;
              const { from, to, empty } = view.state.selection;
              if (empty || !sameBlock(view.state, from, to)) return false;
              event.clipboardData?.setData("text/plain", view.state.doc.textBetween(from, to, "\n"));
              event.preventDefault();
              const { ins, del } = types(view.state);
              const tr = view.state.tr;
              markDeleted(tr, from, to, ins, del);
              tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from)));
              view.dispatch(tr);
              return true;
            },
          },
        },
      }),
    ];
  },
});

/** Aceptar o rechazar un cambio (o todos). */
export function resolveChange(state: EditorState, c: Change, accept: boolean): Transaction {
  const { insertion, deletion } = state.schema.marks;
  const tr = state.tr;
  const remove = (c.type === "ins" && !accept) || (c.type === "del" && accept);
  if (remove) tr.delete(c.from, c.to);
  else tr.removeMark(c.from, c.to, c.type === "ins" ? insertion : deletion);
  return tr;
}

export function resolveAll(state: EditorState, accept: boolean): Transaction {
  const { insertion, deletion } = state.schema.marks;
  const tr = state.tr;
  for (const c of changes(state.doc).reverse()) {
    const remove = (c.type === "ins" && !accept) || (c.type === "del" && accept);
    if (remove) tr.delete(c.from, c.to);
    else tr.removeMark(c.from, c.to, c.type === "ins" ? insertion : deletion);
  }
  return tr;
}
