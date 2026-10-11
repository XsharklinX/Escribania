const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function newId(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** "La carta (II)" → "la-carta-ii". Sin acentos, para nombres de archivo portables. */
export function slugify(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "texto";
}

export function textFileFor(title: string, id: string): string {
  return `texto/${slugify(title)}-${id}.md`;
}
