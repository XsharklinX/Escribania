import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, MessageSquareQuote, RefreshCw, Upload } from "lucide-react";
import { useStore } from "../store";
import type { Comment } from "../types";
import { useT } from "../lib/i18n";
import { api, errorText, type FileHits } from "../lib/api";
import { flushAll } from "../lib/saver";
import { markdownToPlain, stripComments } from "../lib/markdown";
import { filesIn, locate, walk } from "../lib/tree";
import { codexById } from "../lib/model";
import { TODO_SEARCH, sceneIssues, todoNote } from "../lib/todos";
import { checkContinuity, textsOf, type Issue } from "../lib/continuity";
import { dialogueLines, voiceStats, type VoiceStats } from "../lib/voices";
import { anchorNote, parseBetaFile } from "../lib/beta";
import { formatNumber } from "../lib/words";

type Tab = "todo" | "continuity" | "voices" | "beta";

/** Abre un texto en la Hoja y señala la coincidencia de una búsqueda. */
function goTo(file: string, query?: { q: string; regex: boolean; index: number }) {
  const st = useStore.getState();
  let id: string | null = null;
  walk(st.project!.manifest.sections.manuscript, (n) => {
    if (n.file === file) id = n.id;
  });
  if (!id) return;
  if (query) useStore.setState({ search: { query: query.q, regex: query.regex, case: true, word: false }, jump: { file, index: query.index } });
  useStore.setState({ view: "hoja", selected: id });
}

/** Lee el texto plano de todos los textos del Manuscrito. */
async function readAll() {
  const p = useStore.getState().project!;
  await flushAll();
  const list = textsOf(p.manifest);
  return Promise.all(list.map(async (x) => ({ ...x, text: markdownToPlain(stripComments(await api.textRead(p.root, x.file).catch(() => ""))) })));
}

export default function RepasoView() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("todo");
  const tabs: [Tab, string][] = [
    ["todo", t("rep.todo")],
    ["continuity", t("rep.continuity")],
    ["voices", t("rep.voices")],
    ["beta", t("rep.beta")],
  ];
  return (
    <div className="view repaso-view">
      <div className="view-head">
        <h2>{t("view.repaso")}</h2>
        <div className="seg">
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="repaso-body">
        {tab === "todo" && <TodoTab />}
        {tab === "continuity" && <ContinuityTab />}
        {tab === "voices" && <VoicesTab />}
        {tab === "beta" && <BetaTab />}
      </div>
    </div>
  );
}

function TodoTab() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const root = useStore((s) => s.project!.root);
  const [hits, setHits] = useState<FileHits[] | null>(null);
  const titles = useMemo(() => {
    const out: Record<string, string> = {};
    walk(m.sections.manuscript, (n) => n.file && (out[n.file] = n.title));
    return out;
  }, [m]);
  const scan = async () => {
    await flushAll();
    setHits(await api.search(root, filesIn(m.sections.manuscript), { query: TODO_SEARCH, regex: true, case: true, word: false }).catch(() => []));
  };
  useEffect(() => void scan(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = sceneIssues(m);
  const total = hits?.reduce((n, h) => n + h.count, 0) ?? 0;
  return (
    <div className="rep-grid">
      <section className="rep-card">
        <header>
          <h3>{t("rep.todoTitle", { n: total })}</h3>
          <button className="icon-btn" title={t("rep.refresh")} onClick={() => void scan()}>
            <RefreshCw size={15} />
          </button>
        </header>
        <p className="muted">{t("rep.todoHint")}</p>
        {hits?.length === 0 && <p className="ok-line"><CheckCircle2 size={15} /> {t("rep.todoNone")}</p>}
        {hits?.map((h) => (
          <div key={h.file} className="rep-group">
            <b>{titles[h.file] ?? h.file}</b>
            {h.hits.map((x) => {
              const n = todoNote(x.matched);
              return (
                <button key={x.index} className="rep-item" onClick={() => goTo(h.file, { q: TODO_SEARCH, regex: true, index: x.index })}>
                  <span className="todo-word">{n.word}</span> {n.note || <span className="muted">…{x.before.slice(-50)}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </section>
      <section className="rep-card">
        <header>
          <h3>{t("rep.scenesTitle", { n: issues.length })}</h3>
        </header>
        {issues.length === 0 && <p className="ok-line"><CheckCircle2 size={15} /> {t("rep.scenesNone")}</p>}
        {issues.map((x, i) => (
          <button key={i} className="rep-item" onClick={() => useStore.setState({ view: "hoja", selected: x.id })}>
            <span className={`tag ${x.kind}`}>{t(`rep.issue.${x.kind}`)}</span> {x.title}
          </button>
        ))}
      </section>
    </div>
  );
}

function ContinuityTab() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const lang = useStore((s) => s.settings.lang);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const run = async () => {
    setIssues(null);
    const texts = await readAll();
    setTitles(Object.fromEntries(texts.map((x) => [x.file, x.title])));
    setIssues(checkContinuity(useStore.getState().project!.manifest, texts, lang));
  };
  useEffect(() => void run(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => codexById(m, id)?.name ?? "?";
  return (
    <section className="rep-card wide">
      <header>
        <h3>{issues ? t("rep.contTitle", { n: issues.length }) : t("spell.looking")}</h3>
        <button className="icon-btn" title={t("rep.refresh")} onClick={() => void run()}>
          <RefreshCw size={15} />
        </button>
      </header>
      <p className="muted">{t("rep.contHint")}</p>
      {issues?.length === 0 && <p className="ok-line"><CheckCircle2 size={15} /> {t("rep.contNone")}</p>}
      {issues?.map((x, i) => (
        <div key={i} className="rep-issue">
          <AlertTriangle size={15} className="warn" />
          <div>
            {x.kind === "spelling" && <b>{t("rep.spelling", { a: x.variant, b: x.name, n: x.count })}</b>}
            {x.kind === "field" && <b>{t("rep.field", { who: name(x.entry), f: x.field, e: x.expected, v: x.found })}</b>}
            {x.kind === "age" && <b>{t("rep.age", { who: name(x.entry), e: x.expected, v: x.found })}</b>}
            <q>{x.sample}</q>
            <div className="rep-links">
              {(x.kind === "spelling" ? x.files : [x.file]).slice(0, 6).map((f) => (
                <button
                  key={f}
                  className="eb-link"
                  onClick={() => goTo(f, { q: x.kind === "spelling" ? x.variant : x.sample.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), regex: x.kind !== "spelling", index: 0 })}
                >
                  {titles[f] ?? f}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function VoicesTab() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const lang = useStore((s) => s.settings.lang);
  const [stats, setStats] = useState<VoiceStats[] | null>(null);
  const run = async () => {
    setStats(null);
    const texts = await readAll();
    const people = useStore.getState().project!.manifest.codex.filter((e) => e.kind === "character");
    setStats(voiceStats(texts.flatMap((x) => dialogueLines(x.text, people, lang)), lang));
  };
  useEffect(() => void run(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const f1 = (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 1 });
  const max = Math.max(1, ...(stats ?? []).map((s) => s.lines));
  return (
    <section className="rep-card wide">
      <header>
        <h3>{t("rep.voicesTitle")}</h3>
        <button className="icon-btn" title={t("rep.refresh")} onClick={() => void run()}>
          <RefreshCw size={15} />
        </button>
      </header>
      <p className="muted">{t("rep.voicesHint")}</p>
      {stats?.length === 0 && <p className="muted">{t("rep.voicesNone")}</p>}
      <div className="voices">
        {stats?.map((s) => {
          const e = s.speaker ? codexById(m, s.speaker) : null;
          return (
            <div key={s.speaker ?? "?"} className="voice" style={{ borderTopColor: e?.color ?? "var(--line)" }}>
              <div className="voice-head">
                <b>{e?.name ?? t("rep.unknown")}</b>
                <span className="muted">{t("rep.lines", { n: formatNumber(s.lines, lang) })}</span>
              </div>
              <div className="voice-bar">
                <i style={{ width: `${(s.lines / max) * 100}%`, background: e?.color ?? "var(--sub)" }} />
              </div>
              <dl>
                <dt>{t("rep.avgLine")}</dt>
                <dd>{f1(s.avgLine)}</dd>
                <dt>{t("rep.avgSentence")}</dt>
                <dd>{f1(s.avgSentence)}</dd>
                <dt>{t("rep.questions")}</dt>
                <dd>{Math.round(s.questions * 100)} %</dd>
                <dt>{t("rep.exclam")}</dt>
                <dd>{Math.round(s.exclamations * 100)} %</dd>
                <dt>{t("rep.richness")}</dt>
                <dd>{Math.round(s.richness * 100)} %</dd>
              </dl>
              {s.top.length > 0 && (
                <div className="voice-words">
                  {s.top.map((w) => (
                    <span key={w} className="chip">
                      {w}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BetaTab() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const [log, setLog] = useState<string[]>([]);

  const importNotes = async () => {
    const paths = await open({ multiple: true, filters: [{ name: "JSON", extensions: ["json"] }] });
    const list = typeof paths === "string" ? [paths] : paths ?? [];
    if (!list.length) return;
    await flushAll();
    const st = useStore.getState();
    const p = st.project!;
    const lines: string[] = [];
    for (const path of list) {
      try {
        const file = parseBetaFile(await api.fileReadText(path));
        if (file.project !== p.manifest.id) lines.push(t("rep.betaOther", { f: file.title }));
        const reader = file.reader.trim() || t("rep.betaReader");
        const byScene = new Map<string, typeof file.notes>();
        for (const n of file.notes) byScene.set(n.scene, [...(byScene.get(n.scene) ?? []), n]);
        let ok = 0;
        let loose = 0;
        for (const [scene, notes] of byScene) {
          const node = locate(useStore.getState().project!.manifest, scene)?.node;
          if (!node?.file) {
            loose += notes.length;
            continue;
          }
          let md = await api.textRead(p.root, node.file);
          const added: Comment[] = [];
          for (const n of notes) {
            const r = anchorNote(md, n, reader);
            md = r.md;
            added.push(r.comment);
            if (r.exact) ok++;
            else loose++;
          }
          await api.textWrite(p.root, node.file, node.id, node.title, md);
          useStore.getState().editManifest((mm) => {
            const x = locate(mm, scene)!.node;
            x.comments = [...(x.comments ?? []), ...added];
          });
        }
        lines.push(t("rep.betaDone", { r: reader, n: ok + loose, k: loose }));
      } catch (e) {
        lines.push(`${path}: ${e instanceof SyntaxError || String(e).includes("beta") ? t("rep.betaBad") : errorText(e)}`);
      }
    }
    useStore.setState({ reload: useStore.getState().reload + 1 });
    setLog(lines);
    toast(lines[lines.length - 1] ?? "");
  };

  return (
    <section className="rep-card wide">
      <header>
        <h3>
          <MessageSquareQuote size={16} /> {t("rep.betaTitle")}
        </h3>
      </header>
      <p className="muted">{t("rep.betaHint")}</p>
      <div className="row-wrap">
        <button className="btn" onClick={() => useStore.setState({ dialog: "export" })}>
          {t("rep.betaExport")}
        </button>
        <button className="btn primary" onClick={() => void importNotes()}>
          <Upload size={14} /> {t("rep.betaImport")}
        </button>
      </div>
      {log.map((l, i) => (
        <p key={i} className="ok-line">
          {l}
        </p>
      ))}
    </section>
  );
}
