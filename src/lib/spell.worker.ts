/// <reference lib="webworker" />
/** Corrector local: Hunspell (nspell) en un hilo aparte para no frenar la escritura. */
import nspell from "nspell";

let speller: ReturnType<typeof nspell> | null = null;

type Msg =
  | { type: "init"; id: number; aff: string; dic: string; extra: string[] }
  | { type: "check"; id: number; words: string[] }
  | { type: "suggest"; id: number; word: string }
  | { type: "add"; id: number; words: string[] };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      const [aff, dic] = await Promise.all([fetch(m.aff).then((r) => r.text()), fetch(m.dic).then((r) => r.text())]);
      speller = nspell(aff, dic);
      for (const w of m.extra) speller.add(w);
      postMessage({ id: m.id, ok: true });
    } else if (!speller) {
      postMessage({ id: m.id, error: "sin diccionario" });
    } else if (m.type === "check") {
      postMessage({ id: m.id, bad: m.words.filter((w) => !speller!.correct(w)) });
    } else if (m.type === "suggest") {
      postMessage({ id: m.id, suggestions: speller.suggest(m.word).slice(0, 7) });
    } else if (m.type === "add") {
      for (const w of m.words) speller.add(w);
      postMessage({ id: m.id, ok: true });
    }
  } catch (err) {
    postMessage({ id: m.id, error: String(err) });
  }
};
