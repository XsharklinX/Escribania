import { useEffect, useState } from "react";
import { BookPlus } from "lucide-react";
import { useT } from "../lib/i18n";
import { addToDictionary, suggest } from "../lib/spell";

/** Menú del corrector: sugerencias y "Añadir al diccionario". */
export default function SpellMenu(p: { x: number; y: number; word: string; onReplace: (w: string) => void; onClose: () => void }) {
  const t = useT();
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    void suggest(p.word).then(setList, () => setList([]));
  }, [p.word]);
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
  return (
    <div className="menu" style={{ left: Math.min(p.x, window.innerWidth - 230), top: Math.min(p.y, window.innerHeight - 260) }}>
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
    </div>
  );
}
