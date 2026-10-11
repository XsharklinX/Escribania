import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Columns2, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { CodexEntry, CodexKind } from "../types";
import { tNow, useT } from "../lib/i18n";
import { api } from "../lib/api";
import { CODEX_KINDS, codexById, newCodexEntry } from "../lib/model";
import { importFiles, IMAGE_EXT, useAsset } from "../lib/assets";
import { queueText, flushTexts } from "../lib/saver";
import { refreshMentions } from "../lib/mentions";
import { allTexts } from "../lib/tree";
import { newId } from "../lib/ids";
import { Avatar } from "./Inspector";

type Filter = "all" | CodexKind;

export function createEntry(kind: CodexKind): string {
  const st = useStore.getState();
  const p = st.project!;
  const e = newCodexEntry(kind, tNow(`kind.new.${kind}`), st.settings.lang, p.manifest.codex);
  st.editManifest((m) => void m.codex.push(e));
  void api.textWrite(p.root, e.file, e.id, e.name, "").catch(() => {});
  useStore.setState({ codexSelected: e.id });
  return e.id;
}

export default function CodexView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const selected = useStore((s) => s.codexSelected);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => refreshMentions(), []);

  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    return m.codex
      .filter((e) => filter === "all" || e.kind === filter)
      .filter((e) => !needle || [e.name, ...e.aliases].some((n) => n.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => (filter === "term" ? a.name.localeCompare(b.name) : CODEX_KINDS.indexOf(a.kind) - CODEX_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name)));
  }, [m.codex, filter, q]);

  const current = codexById(m, selected) ?? null;

  return (
    <div className="view codex-view">
      <aside className="codex-list">
        <div className="codex-tools">
          <input id="codex-q" className="input" placeholder={t("codex.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ position: "relative" }}>
            <button className="btn primary" onClick={() => setAdding(!adding)} title={t("codex.new")}>
              <Plus size={15} />
            </button>
            {adding && (
              <div className="menu" style={{ position: "absolute", right: 0, top: 34 }} onMouseLeave={() => setAdding(false)}>
                {CODEX_KINDS.map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      createEntry(k);
                      setAdding(false);
                    }}
                  >
                    {t(`kind.${k}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="kind-tabs">
          {(["all", ...CODEX_KINDS] as Filter[]).map((k) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {t(k === "all" ? "codex.all" : `kind.plural.${k}`)}
              <span>{k === "all" ? m.codex.length : m.codex.filter((e) => e.kind === k).length}</span>
            </button>
          ))}
        </div>
        <div className="codex-items">
          {list.length === 0 && <p className="muted pad">{m.codex.length ? t("codex.noMatch") : t("codex.empty")}</p>}
          {list.map((e) => (
            <button key={e.id} className={`codex-item ${selected === e.id ? "on" : ""}`} onClick={() => useStore.setState({ codexSelected: e.id })}>
              <Avatar rel={e.image} name={e.name} color={e.color} size={30} />
              <span>
                <b>{e.name || "—"}</b>
                <small className="muted">
                  {t(`kind.${e.kind}`)}
                  {e.aliases.length > 0 && ` · ${e.aliases.join(", ")}`}
                </small>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="codex-detail">
        {current ? <EntryDetail key={current.id} id={current.id} /> : <div className="editor-empty">{t("codex.pick")}</div>}
      </div>
    </div>
  );
}

export function EntryDetail({ id, compact }: { id: string; compact?: boolean }) {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const root = useStore((s) => s.project!.root);
  const mentions = useStore((s) => s.mentions[id]);
  const edit = useStore((s) => s.editManifest);
  const e = codexById(m, id);
  const [desc, setDesc] = useState<string | null>(null);
  const [relTo, setRelTo] = useState("");
  const [relLabel, setRelLabel] = useState("");
  const nameRef = useRef(e?.name ?? "");
  nameRef.current = e?.name ?? "";

  useEffect(() => {
    if (!e) return;
    let alive = true;
    void flushTexts().then(() => api.textRead(root, e.file)).then((d) => alive && setDesc(d), () => alive && setDesc(""));
    return () => {
      alive = false;
      void flushTexts();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, root]);

  if (!e) return <div className="editor-empty">{t("codex.pick")}</div>;
  const set = (patch: Partial<CodexEntry>) => edit((mm) => void Object.assign(mm.codex.find((x) => x.id === id)!, patch));
  const rels = m.relations.filter((r) => r.from === id || r.to === id);
  const texts = new Map(allTexts(m, ["manuscript", "notes"]).map((n) => [n.file!, n]));
  const appearances = Object.entries(mentions ?? {})
    .map(([file, n]) => ({ node: texts.get(file), n }))
    .filter((x) => x.node);
  const boards = m.boards.filter((b) => b.linkedTo === id);

  const pickImage = async () => {
    const [img] = await importFiles("recursos", IMAGE_EXT, false);
    if (img) set({ image: img.rel });
  };

  const remove = async () => {
    if (!(await ask(tNow("codex.deleteAsk", { name: e.name }), { title: tNow("codex.delete"), kind: "warning" }))) return;
    edit((mm) => {
      mm.codex = mm.codex.filter((x) => x.id !== id);
      mm.relations = mm.relations.filter((r) => r.from !== id && r.to !== id);
    });
    void api.textDelete(root, e.file).catch(() => {});
    useStore.setState({ codexSelected: null, split: useStore.getState().split?.id === id ? null : useStore.getState().split });
  };

  return (
    <div className={`entry ${compact ? "compact" : ""}`}>
      <div className="entry-head">
        <button className="portrait" onClick={() => void pickImage()} title={t("codex.image")} style={{ borderColor: e.color }}>
          <Portrait rel={e.image} />
          {!e.image && <ImagePlus size={22} />}
        </button>
        <div className="entry-main">
          <input id="entry-name" className="entry-name" value={e.name} placeholder={t("codex.name")} onChange={(ev) => set({ name: ev.target.value })} onBlur={() => refreshMentions(500)} />
          <div className="entry-row">
            <select className="select" value={e.kind} onChange={(ev) => set({ kind: ev.target.value as CodexKind })}>
              {CODEX_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
            <input type="color" className="color" value={e.color} onChange={(ev) => set({ color: ev.target.value })} title={t("codex.color")} />
            <label className="check" title={t("codex.mentionsHint")}>
              <input type="checkbox" checked={e.mentions} onChange={(ev) => set({ mentions: ev.target.checked })} />
              {t("codex.mentions")}
            </label>
            <span className="spacer" />
            {!compact && (
              <button className="icon-btn" title={t("split.open")} onClick={() => useStore.setState({ split: { kind: "codex", id }, view: "hoja" })}>
                <Columns2 size={16} />
              </button>
            )}
            {!compact && (
              <button className="icon-btn danger" title={t("codex.delete")} onClick={() => void remove()}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <label className="field">
            <span>{t("codex.aliases")}</span>
            <input
              className="input"
              defaultValue={e.aliases.join(", ")}
              placeholder={t("codex.aliasesPh")}
              onBlur={(ev) => {
                set({ aliases: ev.target.value.split(",").map((s) => s.trim()).filter(Boolean) });
                refreshMentions(300);
              }}
            />
          </label>
        </div>
      </div>

      <div className="fields">
        {e.fields.map((f, i) => (
          <div key={i} className="field-row">
            <input className="input k-in" value={f.k} onChange={(ev) => set({ fields: e.fields.map((x, j) => (j === i ? { ...x, k: ev.target.value } : x)) })} />
            <input className="input" value={f.v} onChange={(ev) => set({ fields: e.fields.map((x, j) => (j === i ? { ...x, v: ev.target.value } : x)) })} />
            <button className="icon-btn" onClick={() => set({ fields: e.fields.filter((_, j) => j !== i) })} title={t("codex.removeField")}>
              <X size={14} />
            </button>
          </div>
        ))}
        <button className="btn" onClick={() => set({ fields: [...e.fields, { k: t("codex.fieldNew"), v: "" }] })}>
          <Plus size={14} /> {t("codex.addField")}
        </button>
      </div>

      <label className="field">
        <span>{e.kind === "term" ? t("codex.definition") : t("codex.description")}</span>
        {desc === null ? (
          <p className="muted">{t("ed.loading")}</p>
        ) : (
          <textarea
            className="textarea desc"
            rows={compact ? 8 : 12}
            value={desc}
            placeholder={t("codex.descPh")}
            onChange={(ev) => {
              setDesc(ev.target.value);
              queueText({ root, file: e.file, id: e.id, title: nameRef.current, body: ev.target.value });
            }}
          />
        )}
      </label>

      {!compact && (
        <>
          <div className="field">
            <span>{t("codex.relations")}</span>
            {rels.map((r) => {
              const other = codexById(m, r.from === id ? r.to : r.from);
              return (
                <div key={r.id} className="rel-row">
                  <span className="rel-dir">{r.from === id ? "→" : "←"}</span>
                  <button className="link" onClick={() => other && useStore.setState({ codexSelected: other.id })}>
                    {other?.name ?? "?"}
                  </button>
                  <input className="input" value={r.label} onChange={(ev) => edit((mm) => void (mm.relations.find((x) => x.id === r.id)!.label = ev.target.value))} />
                  <button className="icon-btn" onClick={() => edit((mm) => void (mm.relations = mm.relations.filter((x) => x.id !== r.id)))}>
                    <X size={14} />
                  </button>
                </div>
              );
            })}
            <div className="rel-row">
              <select className="select" value={relTo} onChange={(ev) => setRelTo(ev.target.value)}>
                <option value="">{t("codex.relWith")}</option>
                {m.codex
                  .filter((x) => x.id !== id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
              <input className="input" value={relLabel} placeholder={t("codex.relLabel")} onChange={(ev) => setRelLabel(ev.target.value)} />
              <button
                className="btn"
                disabled={!relTo}
                onClick={() => {
                  edit((mm) => void mm.relations.push({ id: newId(), from: id, to: relTo, label: relLabel.trim() }));
                  setRelTo("");
                  setRelLabel("");
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="field">
            <span>{t("codex.appearances", { n: appearances.length })}</span>
            {appearances.length === 0 && <p className="muted">{t("codex.noAppearances")}</p>}
            <div className="chips">
              {appearances.map(({ node, n }) => (
                <button key={node!.id} className="chip-entry" onClick={() => useStore.setState({ selected: node!.id, view: "hoja" })}>
                  {node!.title} <small className="muted">×{n}</small>
                </button>
              ))}
            </div>
          </div>

          {boards.length > 0 && (
            <div className="field">
              <span>{t("view.mural")}</span>
              <div className="chips">
                {boards.map((b) => (
                  <button key={b.id} className="chip-entry" onClick={() => useStore.setState({ view: "mural" })}>
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Portrait({ rel }: { rel?: string }) {
  const url = useAsset(rel);
  return url ? <img src={url} alt="" /> : null;
}
