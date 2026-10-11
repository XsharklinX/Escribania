import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";

/**
 * Vista de pliegos: las páginas como en el libro abierto (la 1 sola a la
 * derecha, luego 2-3, 4-5…) y una tira de miniaturas para saltar.
 * `version` cambia con cada composición para volver a pedir las imágenes.
 */
export default function Spreads({ pages, version }: { pages: number; version: string }) {
  const t = useT();
  const [spread, setSpread] = useState(0);
  const cache = useRef(new Map<string, string>());
  const [, force] = useState(0);
  const spreads = Math.floor(pages / 2) + 1;
  // Pliego k: páginas (2k-1, 2k) en numeración 1…; la 0 es solo la 1.
  const pair = (k: number): [number | null, number | null] => (k === 0 ? [null, 0] : [2 * k - 1 < pages ? 2 * k - 1 : null, 2 * k < pages ? 2 * k : null]);

  useEffect(() => {
    cache.current.forEach((u) => URL.revokeObjectURL(u));
    cache.current.clear();
    setSpread((s) => Math.min(s, Math.floor(pages / 2)));
    force((n) => n + 1);
  }, [version, pages]);
  useEffect(() => () => cache.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const want = (i: number, scale: number) => {
    const key = `${version}:${i}:${scale}`;
    if (cache.current.has(key)) return cache.current.get(key)!;
    cache.current.set(key, "");
    void api.typesetPage(i, scale).then((buf) => {
      cache.current.set(key, URL.createObjectURL(new Blob([buf], { type: "image/png" })));
      force((n) => n + 1);
    }, () => {});
    return "";
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") setSpread((s) => Math.min(spreads - 1, s + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setSpread((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spreads]);

  const [l, r] = pair(spread);
  const page = (i: number | null, side: "l" | "r") =>
    i === null ? <div className={`sp-page empty ${side}`} /> : <div className={`sp-page ${side}`}>{want(i, 1.6) ? <img src={want(i, 1.6)} alt={String(i + 1)} /> : null}<span>{i + 1}</span></div>;

  return (
    <div className="spreads">
      <div className="sp-stage">
        <button className="icon-btn" disabled={spread === 0} onClick={() => setSpread(spread - 1)} aria-label={t("sp.prev")}>
          <ChevronLeft size={18} />
        </button>
        <div className="sp-book">
          {page(l, "l")}
          {page(r, "r")}
        </div>
        <button className="icon-btn" disabled={spread >= spreads - 1} onClick={() => setSpread(spread + 1)} aria-label={t("sp.next")}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="sp-thumbs">
        {Array.from({ length: spreads }, (_, k) => {
          const [a, b] = pair(k);
          return (
            <button key={k} className={k === spread ? "on" : ""} onClick={() => setSpread(k)} title={[a, b].filter((x) => x !== null).map((x) => x! + 1).join("–")}>
              {[a, b].map((x, j) => (x === null ? <i key={j} className="blank" /> : <img key={j} src={want(x, 0.25) || undefined} alt="" />))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
