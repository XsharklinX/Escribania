import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { diffWords } from "diff";
import { ClipboardCopy, CornerDownLeft, History, RotateCcw, X } from "lucide-react";
import { useStore } from "../store";
import { tNow, useT } from "../lib/i18n";
import { api, errorText, type HistoryVersion } from "../lib/api";
import { acceptChanges, markdownToHtml, markdownToPlain as rawPlain, stripComments } from "../lib/markdown";

/** Texto plano tal como se leería: comentarios fuera y cambios aceptados. */
const markdownToPlain = (md: string) => rawPlain(acceptChanges(stripComments(md)));
import { flushTexts } from "../lib/saver";
import { countWords, formatNumber } from "../lib/words";
import { locate } from "../lib/tree";
import { activeEditor } from "../lib/activeEditor";

/**
 * Máquina del tiempo: un control deslizante recorre las capas y las copias de
 * seguridad de un texto. Se puede restaurar un párrafo suelto o la versión entera.
 */
export default function TimeMachine({ id }: { id: string }) {
  const t = useT();
  const root = useStore((s) => s.project!.root);
  const node = useStore((s) => locate(s.project!.manifest, id)?.node);
  const lang = useStore((s) => s.settings.lang);
  const toast = useStore((s) => s.toast);
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [now, setNow] = useState("");
  const [i, setI] = useState(0);
  const [cache, setCache] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState(true);
  const close = () => useStore.setState({ timeMachine: null });

  useEffect(() => {
    if (!node?.file) return;
    void (async () => {
      await flushTexts();
      const [list, current] = await Promise.all([api.textHistory(root, node.id, node.file!).catch(() => []), api.textRead(root, node.file!)]);
      setVersions(list);
      setNow(current);
      setI(Math.max(0, list.length - 1));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      if (e.key === "ArrowRight") setI((n) => Math.min((versions?.length ?? 1) - 1, n + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [versions]);

  const v = versions?.[i];
  const key = v ? `${v.source}:${v.key}` : "";
  useEffect(() => {
    if (!v || !node?.file || cache[key] !== undefined) return;
    void api
      .textHistoryRead(root, node.id, node.file, v.source, v.key)
      .then((body) => setCache((c) => ({ ...c, [key]: body })))
      .catch((e) => toast(errorText(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const body = cache[key];
  const paragraphs = useMemo(() => (body ?? "").split(/\n{2,}/).filter((p) => p.trim()), [body]);
  const parts = useMemo(() => (diff && body !== undefined ? diffWords(markdownToPlain(body), markdownToPlain(now)) : []), [diff, body, now]);

  if (!node) return null;

  const insertParagraph = (md: string) => {
    const ed = activeEditor();
    if (!ed) {
      void navigator.clipboard.writeText(markdownToPlain(md));
      toast(t("tm.copied"));
      return;
    }
    ed.chain().focus().insertContentAt(ed.state.selection.to, markdownToHtml(md)).run();
    toast(t("tm.inserted"));
  };

  const restoreAll = async () => {
    if (body === undefined || !node.file) return;
    if (!(await ask(tNow("tm.restoreAsk", { d: v!.when }), { kind: "warning" }))) return;
    try {
      await flushTexts();
      const current = await api.textRead(root, node.file);
      await api.snapshotCreate(root, node.id, tNow("layers.beforeRestore"), current);
      await api.textWrite(root, node.file, node.id, node.title, body);
      useStore.getState().setWords(node.file, countWords(markdownToPlain(body)));
      useStore.setState({ reload: useStore.getState().reload + 1, timeMachine: null });
      toast(t("tm.restored", { d: v!.when }));
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const fmt = (when: string) => {
    const d = new Date(when.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? when : d.toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="time-machine" role="dialog" aria-label={t("tm.title")}>
        <header>
          <History size={18} />
          <h2>
            {t("tm.title")} · {node.title}
          </h2>
          <label className="check">
            <input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> {t("tm.diff")}
          </label>
          <button className="icon-btn" onClick={close} aria-label={t("set.close")}>
            <X size={16} />
          </button>
        </header>
        {versions === null && <p className="muted pad">{t("spell.looking")}</p>}
        {versions?.length === 0 && <p className="muted pad">{t("tm.empty")}</p>}
        {v && (
          <>
            <div className="tm-slider">
              <input type="range" min={0} max={versions!.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label={t("tm.title")} />
              <div className="tm-ticks">
                {versions!.map((x, j) => (
                  <button key={j} className={`${x.source} ${j === i ? "on" : ""}`} style={{ left: `${versions!.length > 1 ? (j / (versions!.length - 1)) * 100 : 50}%` }} title={fmt(x.when)} onClick={() => setI(j)} />
                ))}
              </div>
              <div className="tm-meta">
                <b>{fmt(v.when)}</b>
                <span className={`badge ${v.source}`}>{v.source === "snapshot" ? t("tm.layer") : t("tm.backup")}</span>
                {v.label && <span>«{v.label}»</span>}
                <span className="muted">
                  {formatNumber(v.words, lang)} {t("ed.words")} · {t("tm.now", { n: formatNumber(countWords(markdownToPlain(now)), lang) })}
                </span>
                <span className="spacer" />
                <button className="btn" onClick={() => void restoreAll()} disabled={body === undefined}>
                  <RotateCcw size={14} /> {t("tm.restoreAll")}
                </button>
              </div>
            </div>
            <div className="tm-body">
              {body === undefined && <p className="muted">{t("spell.looking")}</p>}
              {body !== undefined && diff && (
                <div className="tm-diff">
                  {parts.map((p, j) => (p.added ? <ins key={j}>{p.value}</ins> : p.removed ? <del key={j}>{p.value}</del> : <span key={j}>{p.value}</span>))}
                  <p className="muted tm-legend">{t("tm.legend")}</p>
                </div>
              )}
              {body !== undefined &&
                !diff &&
                paragraphs.map((p, j) => (
                  <div className="tm-para" key={j}>
                    <div dangerouslySetInnerHTML={{ __html: markdownToHtml(p) }} />
                    <div className="tm-para-acts">
                      <button className="mini" title={t("tm.insert")} onClick={() => insertParagraph(p)}>
                        <CornerDownLeft size={13} />
                      </button>
                      <button
                        className="mini"
                        title={t("tm.copy")}
                        onClick={() => {
                          void navigator.clipboard.writeText(markdownToPlain(p));
                          toast(t("tm.copied"));
                        }}
                      >
                        <ClipboardCopy size={13} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
