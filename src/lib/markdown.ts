/**
 * Markdown ⇄ editor.
 *
 * Los textos se guardan en Markdown para que se lean con cualquier programa.
 * Al abrir: Markdown → HTML (markdown-it) → editor. Al guardar: el documento del
 * editor (JSON de ProseMirror) se escribe a Markdown con el serializador de aquí.
 *
 * Solo se usa lo que un manuscrito necesita: párrafos, títulos, citas, listas,
 * separador de escena, saltos de línea, negrita, cursiva, tachado y comentarios
 * de Marginalia, que se guardan como `{{c:id}}texto comentado{{/c}}`.
 */
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
md.disable(["code", "fence", "table", "image", "link", "autolink", "html_inline", "html_block", "reference", "backticks"]);

/** `{{c:id}}` abre un comentario y `{{/c}}` lo cierra. */
type InlineRule = Parameters<typeof md.inline.ruler.before>[2];

const commentRule: InlineRule = (state, silent) => {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x7b || src.charCodeAt(pos + 1) !== 0x7b) return false;
  if (src.startsWith("{{/c}}", pos)) {
    if (!silent) state.push("comment_close", "span", -1);
    state.pos += 6;
    return true;
  }
  const m = /^\{\{c:([a-z0-9]{1,20})\}\}/.exec(src.slice(pos, pos + 30));
  if (!m) return false;
  if (!silent) {
    const t = state.push("comment_open", "span", 1);
    t.attrSet("data-comment", m[1]);
  }
  state.pos += m[0].length;
  return true;
};
md.inline.ruler.before("text", "comment", commentRule);
md.renderer.rules.comment_open = (tokens, i) => `<span data-comment="${tokens[i].attrGet("data-comment")}">`;
md.renderer.rules.comment_close = () => "</span>";

/** Lápiz rojo (CriticMarkup): `{++añadido++}` y `{--borrado--}`. */
const TRACK: [string, string][] = [
  ["{++", "ins_open"],
  ["++}", "ins_close"],
  ["{--", "del_open"],
  ["--}", "del_close"],
];
const trackRule: InlineRule = (state, silent) => {
  for (const [mark, type] of TRACK) {
    if (state.src.startsWith(mark, state.pos)) {
      if (!silent) state.push(type, type.startsWith("ins") ? "ins" : "del", type.endsWith("open") ? 1 : -1);
      state.pos += 3;
      return true;
    }
  }
  return false;
};
md.inline.ruler.before("text", "track", trackRule);
md.renderer.rules.ins_open = () => "<ins>";
md.renderer.rules.ins_close = () => "</ins>";
md.renderer.rules.del_open = () => "<del>";
md.renderer.rules.del_close = () => "</del>";

/** Acepta todos los cambios: lo borrado desaparece y lo añadido se queda. */
export function acceptChanges(source: string): string {
  return source.replace(/\{--[\s\S]*?--\}/g, "").replace(/\{\+\+([\s\S]*?)\+\+\}/g, "$1").replace(/ {2,}/g, " ");
}

export function markdownToHtml(source: string): string {
  return md.render(source);
}

export function markdownTokens(source: string) {
  return md.parse(source, {});
}

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Orden fijo de las marcas para que se abran y cierren siempre igual. */
const SIMPLE: [string, string][] = [
  ["bold", "**"],
  ["italic", "*"],
  ["strike", "~~"],
];

function openOf(key: string): string {
  if (key.startsWith("comment:")) return `{{c:${key.slice(8)}}}`;
  if (key === "insertion") return "{++";
  if (key === "deletion") return "{--";
  return SIMPLE.find(([n]) => n === key)![1];
}

function closeOf(key: string): string {
  if (key.startsWith("comment:")) return "{{/c}}";
  if (key === "insertion") return "++}";
  if (key === "deletion") return "--}";
  return SIMPLE.find(([n]) => n === key)![1];
}

function keysOf(marks: PMNode["marks"]): string[] {
  const out: string[] = [];
  const c = marks?.find((m) => m.type === "comment" && m.attrs?.id);
  if (c) out.push(`comment:${c.attrs!.id}`);
  if (marks?.some((m) => m.type === "insertion")) out.push("insertion");
  else if (marks?.some((m) => m.type === "deletion")) out.push("deletion");
  for (const [name] of SIMPLE) if (marks?.some((m) => m.type === name)) out.push(name);
  return out;
}

export function escapeInline(text: string): string {
  return text.replace(/([\\*_~`[\]{}])/g, "\\$1");
}

/** Evita que un párrafo que empieza por "# ", "> ", "- " o "1. " se lea como otra cosa. */
function escapeLineStart(line: string): string {
  if (/^#{1,6}(\s|$)/.test(line) || /^>/.test(line) || /^[-+](\s|$)/.test(line)) return "\\" + line;
  const m = /^(\d+)([.)])(\s|$)/.exec(line);
  if (m) return m[1] + "\\" + line.slice(m[1].length);
  return line;
}

function inline(nodes: PMNode[] | undefined): string {
  if (!nodes) return "";
  let out = "";
  let active: string[] = [];
  let pendingWs = "";

  const closeTo = (k: number) => {
    for (let i = active.length - 1; i >= k; i--) out += closeOf(active[i]);
    active = active.slice(0, k);
  };

  for (const n of nodes) {
    if (n.type === "hardBreak") {
      out += pendingWs + "\\\n";
      pendingWs = "";
      continue;
    }
    if (n.type !== "text" || !n.text) continue;
    const desired = keysOf(n.marks);
    const lead = /^\s*/.exec(n.text)![0];
    const trail = /\s*$/.exec(n.text)![0];
    const core = n.text.slice(lead.length, n.text.length - trail.length);
    if (!core) {
      pendingWs += n.text;
      continue;
    }
    let k = 0;
    while (k < active.length && k < desired.length && active[k] === desired[k]) k++;
    if (k < active.length) closeTo(k);
    out += pendingWs + lead;
    pendingWs = "";
    for (const key of desired.slice(k)) out += openOf(key);
    active = desired;
    out += escapeInline(core);
    pendingWs = trail;
  }
  closeTo(0);
  out += pendingWs;
  return out.split("\\\n").map(escapeLineStart).join("\\\n").trim();
}

function block(node: PMNode): string | null {
  switch (node.type) {
    case "paragraph": {
      const t = inline(node.content);
      return t ? t : null;
    }
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return "#".repeat(level) + " " + inline(node.content).replace(/^\\(?=#)/, "");
    }
    case "horizontalRule":
      return "* * *";
    case "blockquote": {
      const inner = blocks(node.content);
      return inner
        .split("\n")
        .map((l) => (l ? "> " + l : ">"))
        .join("\n");
    }
    case "bulletList":
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? [])
        .map((item, i) => {
          const bullet = node.type === "bulletList" ? "- " : `${start + i}. `;
          const body = blocks(item.content);
          const pad = " ".repeat(bullet.length);
          return bullet + body.split("\n").map((l, j) => (j === 0 || !l ? l : pad + l)).join("\n");
        })
        .join("\n");
    }
    default:
      return node.content ? blocks(node.content) : null;
  }
}

function blocks(nodes: PMNode[] | undefined): string {
  return (nodes ?? [])
    .map(block)
    .filter((b): b is string => b !== null && b !== "")
    .join("\n\n");
}

export function docToMarkdown(doc: PMNode): string {
  const s = blocks(doc.content);
  return s ? s + "\n" : "";
}

/** Quita las marcas de comentario (para exportar el libro sin ellas). */
export function stripComments(source: string): string {
  return source.replace(/\{\{c:[a-z0-9]{1,20}\}\}|\{\{\/c\}\}/g, "");
}

/** Texto plano desde Markdown (para .txt y recuentos). */
export function markdownToPlain(source: string): string {
  const div = typeof document !== "undefined" ? document.createElement("div") : null;
  const html = markdownToHtml(source);
  if (!div) return html.replace(/<[^>]+>/g, "");
  div.innerHTML = html.replace(/<\/(p|h\d|li|blockquote)>/g, "</$1>\n\n").replace(/<hr\s*\/?>/g, "* * *\n\n").replace(/<br\s*\/?>/g, "\n");
  return (div.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
