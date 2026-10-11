/** Palabras: trozos separados por espacios con al menos una letra o número.
 *  Igual que `count_words` en src-tauri/src/project.rs. */
export function countWords(text: string): number {
  let n = 0;
  for (const w of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w)) n++;
  return n;
}

export function formatNumber(n: number, lang: string): string {
  return n.toLocaleString(lang === "es" ? "es-ES" : "en-US");
}
