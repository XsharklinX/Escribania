import { useEffect, useState } from "react";
import { BookPlus } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../lib/i18n";
import { addToDictionary, suggest } from "../lib/spell";
import { lookup, matchCase, type ThesaurusEntry } from "../lib/thesaurus";

/**
 * Menú de una palabra: sugerencias del corrector (si está mal escrita) y
 * sinónimos y antónimos del tesauro.
 */
export default function SpellMenu(p: { x: number; y: number; word: string; misspelled?: boolean; onReplace: (w: string) => void; onClose: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const misspelled = p.misspelled ?? true;
  const [list, setList] = useState<string[] | null>(misspelled ? null : []);
  const [thes, setThes] = useState<ThesaurusEntry | null | undefined>(undefined);
  useEffect(() => {
    if (misspelled) void suggest(p.word).then(setList, () => setList([]));
    else void lookup(p.word, lang).then(setThes, () => setThes(null));
  }, [p.word, misspelled, lang]);
  useEffect(() => {
    const down = (e: MouseEvent) => !(e.target as HTMLElement).closest(".menu") && p.onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [p]);
  const pick = (w: string) => p.onReplace(matchCase(p.word, w));
  return (
    <div className="menu word-menu" style={{ left: Math.min(p.x, window.innerWidth - 300), top: Math.min(p.y, window.innerHeight - 380) }}>
      {misspelled && (
        <>
          {list === null && <div className="muted pad">{t("spell.looking")}</div>}
          {list?.length === 0 && <div className="muted pad">{t("spell.none")}</div>}
          {list?.map((w) => (
            <button key={w} onClick={() => p.onReplace(w)}>
              <b>{w}</b>
            </button>
          ))}
          <hr />
          <button
            onClick={() => {
              void addToDictionary(p.word);
              p.onClose();
            }}
          >
            <BookPlus size={14} /> {t("spell.add", { w: p.word })}
          </button>
        </>
      )}
      {!misspelled && (
        <div className="thes">
          <div className="thes-head">
            {t("thes.title")} · <b>{thes?.word ?? p.word}</b>
          </div>
          {thes === undefined && <div className="muted pad">{t("spell.looking")}</div>}
          {thes === null && <div className="muted pad">{t("thes.none")}</div>}
          {thes?.senses.slice(0, 6).map((sense, i) => (
            <div className="thes-sense" key={i}>
              {sense.slice(0, 8).map((w) => (
                <button key={w} className="chip" onClick={() => pick(w)}>
                  {w}
                </button>
              ))}
            </div>
          ))}
          {thes && thes.antonyms.length > 0 && (
            <>
              <div className="thes-head">{t("thes.antonyms")}</div>
              <div className="thes-sense">
                {thes.antonyms.slice(0, 8).map((w) => (
                  <button key={w} className="chip ant" onClick={() => pick(w)}>
                    {w}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
