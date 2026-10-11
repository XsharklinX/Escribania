import { useMemo, useState } from "react";
import { Filter, FolderHeart, Pencil, Plus, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { Collection, Status } from "../types";
import { useT, type TKey } from "../lib/i18n";
import { allTags, emptyFilter, normTag, useCollectionNodes } from "../lib/collections";
import { newId } from "../lib/ids";
import { wordsOf } from "../lib/tree";
import { formatNumber } from "../lib/words";
import Modal from "./Modal";

const COLORS = ["#3B6FD8", "#C2416B", "#2E9A73", "#D2803A", "#8C4FC2", "#6B7180"];
const STATUSES: Status[] = ["idea", "draft", "revised", "final"];

/** Fila de colecciones encima del Legajo. Arrastra un texto sobre una colección manual para añadirlo. */
export function CollectionsBar({ dragId }: { dragId: React.MutableRefObject<string | null> }) {
  const t = useT();
  const list = useStore((s) => s.project!.manifest.collections);
  const active = useStore((s) => s.collection);
  const edit = useStore((s) => s.editManifest);
  const [dialog, setDialog] = useState<Collection | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="coll-bar">
      <FolderHeart size={13} className="muted" />
      {list.map((c) => (
        <button
          key={c.id}
          className={`coll-chip ${active === c.id ? "on" : ""} ${over === c.id ? "over" : ""}`}
          style={{ "--c": c.color } as React.CSSProperties}
          title={c.kind === "smart" ? t("coll.smart") : t("coll.manualHint")}
          onClick={() => useStore.setState({ collection: active === c.id ? null : c.id })}
          onDoubleClick={() => setDialog(c)}
          onDragOver={(e) => {
            if (c.kind !== "manual" || !dragId.current) return;
            e.preventDefault();
            setOver(c.id);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = dragId.current;
            if (id) edit((mm) => void mm.collections.forEach((x) => x.id === c.id && !x.ids.includes(id) && x.ids.push(id)));
          }}
        >
          {c.kind === "smart" && <Filter size={10} />}
          {c.name}
        </button>
      ))}
      <button className="coll-add" title={t("coll.new")} onClick={() => setDialog({ id: newId(), name: "", color: COLORS[list.length % COLORS.length], kind: "smart", ids: [], filter: emptyFilter() })}>
        <Plus size={12} />
      </button>
      {dialog && <CollectionDialog value={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Lista plana de la colección activa (sustituye al árbol mientras está elegida). */
export function CollectionList() {
  const t = useT();
  const id = useStore((s) => s.collection);
  const c = useStore((s) => s.project!.manifest.collections.find((x) => x.id === id) ?? null);
  const nodes = useCollectionNodes(c);
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const selected = useStore((s) => s.selected);
  const edit = useStore((s) => s.editManifest);
  if (!c) return null;
  return (
    <div className="coll-list">
      <div className="sec-head">
        <span className="coll-dot" style={{ background: c.color }} /> {c.name}
        <span className="n">{nodes ? nodes.length : "…"}</span>
        <button className="sec-add" title={t("coll.close")} onClick={() => useStore.setState({ collection: null })}>
          <X size={12} />
        </button>
      </div>
      {nodes?.length === 0 && <div className="empty-sec">{c.kind === "manual" ? t("coll.emptyManual") : t("coll.emptySmart")}</div>}
      {nodes?.map((n) => (
        <div key={n.id} className={`row ${selected === n.id ? "on" : ""}`} onClick={() => useStore.getState().select(n.id)}>
          <span className="label">{n.title}</span>
          {n.tags?.slice(0, 2).map((tg) => (
            <span key={tg} className="tag-mini">
              {tg}
            </span>
          ))}
          <span className="w">{formatNumber(wordsOf(n, words), lang)}</span>
          {c.kind === "manual" && (
            <button
              className="mini"
              title={t("coll.remove")}
              onClick={(e) => {
                e.stopPropagation();
                edit((mm) => void mm.collections.forEach((x) => x.id === c.id && (x.ids = x.ids.filter((i) => i !== n.id))));
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function CollectionDialog({ value, onClose }: { value: Collection; onClose: () => void }) {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const [c, setC] = useState<Collection>(value);
  const exists = m.collections.some((x) => x.id === c.id);
  const tags = allTags(m);
  const people = m.codex.filter((e) => e.kind === "character");
  const f = c.filter;
  const setF = (patch: Partial<Collection["filter"]>) => setC({ ...c, filter: { ...f, ...patch } });
  const save = () => {
    edit((mm) => {
      const i = mm.collections.findIndex((x) => x.id === c.id);
      if (i >= 0) mm.collections[i] = c;
      else mm.collections.push(c);
    });
    useStore.setState({ collection: c.id });
    onClose();
  };
  return (
    <Modal
      title={exists ? t("coll.edit") : t("coll.new")}
      onClose={onClose}
      footer={
        <>
          {exists && (
            <button
              className="btn danger"
              style={{ marginRight: "auto" }}
              onClick={() => {
                edit((mm) => void (mm.collections = mm.collections.filter((x) => x.id !== c.id)));
                useStore.setState({ collection: null });
                onClose();
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn primary" disabled={!c.name.trim()} onClick={save}>
            {t("cal.save")}
          </button>
        </>
      }
    >
      <div className="body">
        <label className="field">
          <span>{t("coll.name")}</span>
          <input className="input" autoFocus value={c.name} placeholder={t("coll.namePh")} onChange={(e) => setC({ ...c, name: e.target.value })} />
        </label>
        <div className="field">
          <span>{t("coll.color")}</span>
          <div className="row-wrap">
            {COLORS.map((col) => (
              <button key={col} className={`swatch ${c.color === col ? "on" : ""}`} style={{ background: col }} onClick={() => setC({ ...c, color: col })} aria-label={col} />
            ))}
          </div>
        </div>
        <div className="seg">
          <button className={c.kind === "smart" ? "on" : ""} onClick={() => setC({ ...c, kind: "smart" })}>
            <Filter size={12} /> {t("coll.smart")}
          </button>
          <button className={c.kind === "manual" ? "on" : ""} onClick={() => setC({ ...c, kind: "manual" })}>
            <Pencil size={12} /> {t("coll.manual")}
          </button>
        </div>
        {c.kind === "manual" ? (
          <p className="muted">{t("coll.manualHint")}</p>
        ) : (
          <>
            <div className="field">
              <span>{t("coll.tags")}</span>
              <div className="row-wrap">
                {tags.length === 0 && <span className="muted">{t("coll.noTags")}</span>}
                {tags.map((tg) => (
                  <button key={tg} className={`chip-btn ${f.tags.includes(tg) ? "on" : ""}`} onClick={() => setF({ tags: f.tags.includes(tg) ? f.tags.filter((x) => x !== tg) : [...f.tags, tg] })}>
                    {tg}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>{t("coll.status")}</span>
              <div className="row-wrap">
                {STATUSES.map((s) => (
                  <button key={s} className={`chip-btn ${f.status.includes(s) ? "on" : ""}`} onClick={() => setF({ status: f.status.includes(s) ? f.status.filter((x) => x !== s) : [...f.status, s] })}>
                    {t(`status.${s}` as TKey)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid2">
              <label className="field">
                <span>{t("coll.pov")}</span>
                <select className="select" value={f.pov} onChange={(e) => setF({ pov: e.target.value })}>
                  <option value="">{t("coll.any")}</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("coll.text")}</span>
                <input className="input" value={f.text} placeholder={t("coll.textPh")} onChange={(e) => setF({ text: e.target.value })} />
              </label>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Etiquetas de un texto en el Inspector. */
export function TagsField({ id, tags }: { id: string; tags: string[] }) {
  const t = useT();
  const edit = useStore((s) => s.editManifest);
  // El selector no puede devolver una lista nueva en cada render (zustand entra en bucle).
  const manifest = useStore((s) => s.project!.manifest);
  const all = useMemo(() => allTags(manifest), [manifest]);
  const [draft, setDraft] = useState("");
  const set = (next: string[]) =>
    edit((mm) => {
      const walkSet = (list: typeof mm.sections.manuscript) => {
        for (const n of list) {
          if (n.id === id) n.tags = next.length ? next : undefined;
          if (n.children) walkSet(n.children);
        }
      };
      Object.values(mm.sections).forEach(walkSet);
    });
  const add = () => {
    const tg = normTag(draft);
    if (tg && !tags.includes(tg)) set([...tags, tg]);
    setDraft("");
  };
  return (
    <div className="field">
      <span>{t("coll.tags")}</span>
      <div className="tags-field">
        {tags.map((tg) => (
          <span key={tg} className="tag-chip">
            {tg}
            <button onClick={() => set(tags.filter((x) => x !== tg))} aria-label={t("coll.remove")}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="tags-input"
          list="all-tags"
          value={draft}
          placeholder={tags.length ? "" : t("coll.tagPh")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && tags.length) set(tags.slice(0, -1));
          }}
          onBlur={add}
        />
        <datalist id="all-tags">
          {all.filter((x) => !tags.includes(x)).map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
