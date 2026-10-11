import { Extension, InputRule, Mark, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { QuoteStyle } from "../types";

export interface TypographyOptions {
  quotes: QuoteStyle;
  dialogueDash: boolean;
}

/** Tipografía de oficio al teclear: raya de diálogo, comillas, puntos suspensivos. */
export const WriterTypography = Extension.create<TypographyOptions>({
  name: "writerTypography",
  addOptions() {
    return { quotes: "latin", dialogueDash: true };
  },
  addInputRules() {
    const rules: InputRule[] = [];
    if (this.options.dialogueDash) {
      rules.push(
        new InputRule({
          find: /--$/,
          handler: ({ state, range }) => {
            state.tr.insertText("—", range.from, range.to);
          },
        }),
      );
    }
    rules.push(
      new InputRule({
        find: /\.\.\.$/,
        handler: ({ state, range }) => {
          state.tr.insertText("…", range.from, range.to);
        },
      }),
    );
    const q = this.options.quotes;
    if (q !== "none") {
      const [open, close] = q === "latin" ? ["«", "»"] : ["“", "”"];
      rules.push(
        new InputRule({
          find: /"$/,
          handler: ({ state, range }) => {
            const before = state.doc.textBetween(Math.max(0, range.from - 1), range.from, "\n", "\n");
            const opening = before === "" || /[\s([{—–«“-]/.test(before);
            state.tr.insertText(opening ? open : close, range.from, range.to);
          },
        }),
      );
    }
    return rules;
  },
});

const currentKey = new PluginKey("currentBlock");

/** Marca con la clase `is-current` el bloque donde está el cursor (para Retiro). */
export const CurrentBlock = Extension.create({
  name: "currentBlock",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: currentKey,
        props: {
          decorations(state) {
            const { $from } = state.selection;
            if ($from.depth < 1) return null;
            const pos = $from.before(1);
            const node = state.doc.nodeAt(pos);
            if (!node) return null;
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: "is-current" })]);
          },
        },
      }),
    ];
  },
});

/** Marginalia: el texto comentado lleva una marca con el id del comentario. */
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment"),
        renderHTML: (a) => ({ "data-comment": a.id }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "comment-mark" }), 0];
  },
});

// ---------------- búsqueda de texto dentro del documento ----------------

/** Texto de cada bloque con la posición de cada carácter en el documento. */
export function textblocks(doc: PMNode): { text: string; map: number[] }[] {
  const out: { text: string; map: number[] }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        const t = child.text!;
        for (let i = 0; i < t.length; i++) map.push(pos + 1 + offset + i);
        text += t;
      } else {
        map.push(pos + 1 + offset);
        text += "\n";
      }
    });
    out.push({ text, map });
    return false;
  });
  return out;
}

export interface Range {
  from: number;
  to: number;
}

export function findAll(doc: PMNode, re: RegExp): (Range & { match: string })[] {
  const out: (Range & { match: string })[] = [];
  for (const b of textblocks(doc)) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b.text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      out.push({ from: b.map[m.index], to: b.map[m.index + m[0].length - 1] + 1, match: m[0] });
    }
  }
  return out;
}

const L = "[\\p{L}\\p{N}_]";

export function searchRegex(q: { query: string; regex: boolean; case: boolean; word: boolean }): RegExp | null {
  if (!q.query) return null;
  let src = q.regex ? q.query : q.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (q.word) src = `(?<!${L})(?:${src})(?!${L})`;
  try {
    return new RegExp(src, q.case ? "gu" : "giu");
  } catch {
    return null;
  }
}

export const searchKey = new PluginKey<DecorationSet>("searchHighlight");

/** Resalta las coincidencias de la búsqueda del proyecto en el texto abierto. */
export const SearchHighlight = Extension.create<{ getRegex: () => RegExp | null; getCurrent: () => number }>({
  name: "searchHighlight",
  addOptions() {
    return { getRegex: () => null, getCurrent: () => -1 };
  },
  addProseMirrorPlugins() {
    const { getRegex, getCurrent } = this.options;
    const build = (state: EditorState) => {
      const re = getRegex();
      if (!re) return DecorationSet.empty;
      const cur = getCurrent();
      return DecorationSet.create(
        state.doc,
        findAll(state.doc, re).map((r, i) => Decoration.inline(r.from, r.to, { class: i === cur ? "search-hit current" : "search-hit" })),
      );
    };
    return [
      new Plugin({
        key: searchKey,
        state: {
          init: (_, state) => build(state),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(searchKey) ? build(state) : old),
        },
        props: { decorations: (state) => searchKey.getState(state) },
      }),
    ];
  },
});

// ---------------- Ecos: menciones del Códice ----------------

export interface MentionTerm {
  id: string;
  names: string[];
  color: string;
}

export const mentionsKey = new PluginKey<DecorationSet>("mentions");

export function mentionRegex(terms: MentionTerm[]): { re: RegExp; byName: Map<string, MentionTerm> } | null {
  const byName = new Map<string, MentionTerm>();
  for (const t of terms) for (const n of t.names) if (n.trim().length >= 2) byName.set(n.trim().toLocaleLowerCase(), t);
  if (!byName.size) return null;
  // Los nombres largos primero: "la vieja Amparo" antes que "Amparo".
  const alts = [...byName.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return { re: new RegExp(`(?<!${L})(?:${alts.join("|")})(?!${L})`, "giu"), byName };
}

/** Ids de las fichas que aparecen en un texto. */
export function mentionedIn(text: string, terms: MentionTerm[]): string[] {
  const r = mentionRegex(terms);
  if (!r) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(r.re)) {
    const t = r.byName.get(m[0].toLocaleLowerCase());
    if (t) found.add(t.id);
  }
  return [...found];
}

export const Mentions = Extension.create<{ getTerms: () => MentionTerm[] }>({
  name: "mentions",
  addOptions() {
    return { getTerms: () => [] };
  },
  addProseMirrorPlugins() {
    const { getTerms } = this.options;
    const build = (state: EditorState) => {
      const r = mentionRegex(getTerms());
      if (!r) return DecorationSet.empty;
      const decos = findAll(state.doc, r.re).flatMap((hit) => {
        const t = r.byName.get(hit.match.toLocaleLowerCase());
        return t ? [Decoration.inline(hit.from, hit.to, { class: "mention", "data-entry": t.id, style: `--mc:${t.color}` })] : [];
      });
      return DecorationSet.create(state.doc, decos);
    };
    return [
      new Plugin({
        key: mentionsKey,
        state: {
          init: (_, state) => build(state),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(mentionsKey) ? build(state) : old),
        },
        props: { decorations: (state) => mentionsKey.getState(state) },
      }),
    ];
  },
});
