import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { CaseSensitive, Regex, WholeWord, X } from "lucide-react";
import { useStore, type SearchQuery } from "../store";
import type { Manifest } from "../types";
import { tNow, useT } from "../lib/i18n";
import { api, errorText, type FileHits } from "../lib/api";
import { escapeInline } from "../lib/markdown";
import { flushTexts } from "../lib/saver";
import { allTexts } from "../lib/tree";
import { countWords } from "../lib/words";

type Scope = "all" | "manuscript" | "notes" | "research" | "codex";

interface Target {
  file: string;
  title: string;
  kind: "text" | "codex";
  id: string;
}

function targets(m: Manifest, scope: Scope): Target[] {
  const texts = (sections: ("manuscript" | "research" | "notes")[]) =>
    allTexts(m, sections).map((n) => ({ file: n.file!, title: n.title, kind: "text" as const, id: n.id }));
  const codex = m.codex.map((e) => ({ file: e.file, title: e.name, kind: "codex" as const, id: e.id }));
  if (scope === "manuscript" || scope === "notes" || scope === "research") return texts([scope]);
  if (scope === "codex") return codex;
  return [...texts(["manuscript", "research", "notes"]), ...codex];
}

/** La consulta tal como está escrita en disco (el Markdown escapa * _ ~ [ ] { }). */
function onDisk(q: SearchQuery): SearchQuery {
  return q.regex ? q : { ...q, query: escapeInline(q.query) };
}

export default function SearchPanel() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const root = useStore((s) => s.project!.root);
  const q = useStore((s) => s.search);
  const [scope, setScope] = useState<Scope>("all");
  const [replace, setReplace] = useState("");
  const [results, setResults] = useState<FileHits[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const list = useMemo(() => targets(m, scope), [m, scope]);
  const byFile = useMemo(() => new Map(list.map((x) => [x.file, x])), [list]);
  const setQ = (patch: Partial<SearchQuery>) => useStore.setState({ search: { ...useStore.getState().search, ...patch } });

  const run = async () => {
    const my = ++seq.current;
    if (!q.query) {
      setResults([]);
      setError("");
      return;
    }
    try {
      await flushTexts();
      const r = await api.search(root, list.map((x) => x.file), onDisk(q));
      if (my === seq.current) {
        setResults(r);
        setError("");
      }
    } catch (e) {
      if (my === seq.current) setError(errorText(e));
    }
  };

  useEffect(() => {
    const id = setTimeout(() => void run(), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, list]);

  // Al cerrar el panel se quita el resaltado del editor.
  useEffect(() => () => useStore.setState({ search: { ...useStore.getState().search, query: "" } }), []);

  const total = results.reduce((s, r) => s + r.count, 0);

  const open = (file: string, index: number) => {
    const target = byFile.get(file);
    if (!target) return;
    if (target.kind === "codex") useStore.setState({ view: "codice", codexSelected: target.id });
    else useStore.setState({ selected: target.id, view: "hoja", jump: { file, index } });
  };

  const replaceAll = async () => {
    if (!total) return;
    if (!(await ask(tNow("search.replaceAsk", { n: total, f: results.length }), { title: tNow("search.replaceAll"), kind: "warning" }))) return;
    setBusy(true);
    try {
      await flushTexts();
      const files = results.map((r) => r.file);
      // Una capa de cada texto antes de tocarlo: el reemplazo se puede deshacer.
      for (const f of files) {
        const target = byFile.get(f);
        if (target?.kind !== "text") continue;
        const body = await api.textRead(root, f);
        await api.snapshotCreate(root, target.id, tNow("search.snapName", { q: q.query }), body);
      }
      const replacement = q.regex ? replace : escapeInline(replace);
      const done = await api.replace(root, files, onDisk(q), replacement);
      const st = useStore.getState();
      for (const f of Object.keys(done)) st.setWords(f, countWords(await api.textRead(root, f)));
      useStore.setState({ reload: st.reload + 1 });
      st.toast(tNow("search.replaced", { n: Object.values(done).reduce((a, b) => a + b, 0) }));
      await run();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="binder search-panel">
      <div className="search-head">
        <b>{t("search.title")}</b>
        <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={() => useStore.setState({ leftPanel: "binder" })} title={t("set.close")}>
          <X size={15} />
        </button>
      </div>
      <div className="search-form">
        <div className="search-input">
          <input id="search-query" className="input" autoFocus placeholder={t("search.placeholder")} value={q.query} onChange={(e) => setQ({ query: e.target.value })} />
          <button className={`tog ${q.case ? "on" : ""}`} title={t("search.case")} onClick={() => setQ({ case: !q.case })}>
            <CaseSensitive size={15} />
          </button>
          <button className={`tog ${q.word ? "on" : ""}`} title={t("search.word")} onClick={() => setQ({ word: !q.word })}>
            <WholeWord size={15} />
          </button>
          <button className={`tog ${q.regex ? "on" : ""}`} title={t("search.regex")} onClick={() => setQ({ regex: !q.regex })}>
            <Regex size={15} />
          </button>
        </div>
        <div className="search-input">
          <input id="search-replace" className="input" placeholder={t("search.replacePh")} value={replace} onChange={(e) => setReplace(e.target.value)} />
          <button className="btn" disabled={!total || busy} onClick={() => void replaceAll()} title={t("search.replaceAll")}>
            {t("search.replaceAll")}
          </button>
        </div>
        <select id="search-scope" className="select" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="all">{t("search.scope.all")}</option>
          <option value="manuscript">{t("sec.manuscript")}</option>
          <option value="research">{t("sec.research")}</option>
          <option value="notes">{t("sec.notes")}</option>
          <option value="codex">{t("view.codice")}</option>
        </select>
        {q.query && !error && <span className="muted">{t("search.count", { n: total, f: results.length })}</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
      <div className="binder-scroll search-results">
        {results.map((r) => (
          <div key={r.file} className="sr-file">
            <div className="sr-title">
              {byFile.get(r.file)?.title ?? r.file}
              <span className="n">{r.count}</span>
            </div>
            {r.hits.map((h) => (
              <button key={h.index} className="sr-hit" onClick={() => open(r.file, h.index)}>
                {h.before}
                <mark>{h.matched}</mark>
                {h.after}
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
