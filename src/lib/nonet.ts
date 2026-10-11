/**
 * Escritura sin red: si dejas de escribir unos segundos, la última frase
 * empieza a desvanecerse y, si no sigues, se borra (una sola, y se puede
 * deshacer). Solo en Retiro y solo si se activa a mano.
 */
import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const noNetKey = new PluginKey<{ from: number; to: number } | null>("nonet");

/** La última frase antes del cursor, dentro del párrafo. */
export function lastSentence(state: EditorState): { from: number; to: number } | null {
  const $h = state.selection.$head;
  if (!$h.parent.isTextblock) return null;
  const before = $h.parent.textBetween(0, $h.parentOffset, undefined, "￼");
  const trimmed = before.replace(/\s+$/, "");
  if (!trimmed) return null;
  const re = /[.!?…]["»”’)]*\s+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) {
    if (m.index + m[0].length < trimmed.length) start = m.index + m[0].length;
  }
  return { from: $h.start() + start, to: $h.start() + before.length };
}

export const NoNet = Extension.create<{ isOn: () => boolean; fadeAfter: number; eraseAfter: number }>({
  name: "noNet",
  addOptions() {
    return { isOn: () => false, fadeAfter: 5000, eraseAfter: 5000 };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        key: noNetKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(noNetKey);
            if (meta !== undefined) return meta;
            return tr.docChanged ? null : value;
          },
        },
        props: {
          decorations(state) {
            const r = noNetKey.getState(state);
            return r && r.to > r.from ? DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: "nonet-fade" })]) : null;
          },
        },
        view(view) {
          let fade: ReturnType<typeof setTimeout> | undefined;
          let erase: ReturnType<typeof setTimeout> | undefined;
          let erasing = false;
          const clear = () => {
            clearTimeout(fade);
            clearTimeout(erase);
          };
          const arm = () => {
            clear();
            if (!opts.isOn()) return;
            fade = setTimeout(() => {
              const range = opts.isOn() && view.hasFocus() ? lastSentence(view.state) : null;
              if (!range) return;
              view.dispatch(view.state.tr.setMeta(noNetKey, range));
              erase = setTimeout(() => {
                const r = noNetKey.getState(view.state);
                if (!r || !opts.isOn()) return;
                erasing = true;
                view.dispatch(view.state.tr.delete(r.from, r.to).setMeta(noNetKey, null));
              }, opts.eraseAfter);
            }, opts.fadeAfter);
          };
          return {
            update(v, prev) {
              if (v.state.doc === prev.doc) return;
              // Tras borrar se espera a que vuelvas a escribir: no se come el texto frase a frase.
              if (erasing) {
                erasing = false;
                clear();
                return;
              }
              arm();
            },
            destroy: clear,
          };
        },
      }),
    ];
  },
});

/** Preguntas para arrancar cuando el Cuaderno de ideas está vacío. */
export const STARTERS: Record<"es" | "en", string[]> = {
  es: [
    "¿Qué es lo primero que ve tu personaje al abrir los ojos?",
    "Empieza por un ruido que nadie más ha oído.",
    "Alguien miente en la primera frase. ¿Quién?",
    "Describe el lugar como si fuera la última vez que lo ves.",
    "¿Qué lleva tu personaje en los bolsillos hoy?",
    "Una carta llega con un día de retraso.",
    "Escribe la conversación que tu personaje lleva años evitando.",
    "Empieza en mitad de una discusión, sin explicar nada.",
    "¿Qué huele distinto esta mañana?",
    "Algo pequeño se rompe. Cuenta qué pasa justo después.",
  ],
  en: [
    "What's the first thing your character sees on opening their eyes?",
    "Start with a sound nobody else has heard.",
    "Someone lies in the first sentence. Who?",
    "Describe the place as if it were the last time you'll see it.",
    "What's in your character's pockets today?",
    "A letter arrives a day late.",
    "Write the conversation your character has avoided for years.",
    "Start in the middle of an argument, explaining nothing.",
    "What smells different this morning?",
    "Something small breaks. Tell what happens right after.",
  ],
};
