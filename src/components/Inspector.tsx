import { useCallback, useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { diffWords } from "diff";
import { Glasses, Layers, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { TreeNode } from "../types";
import { tNow, useT } from "../lib/i18n";
import { api, errorText, type Snapshot } from "../lib/api";
import { locate, wordsOf } from "../lib/tree";
import { countWords, formatNumber } from "../lib/words";
import { markdownToPlain } from "../lib/markdown";
import { flushTexts } from "../lib/saver";
import { useAsset } from "../lib/assets";
import { STATUSES } from "./Binder";
import Modal from "./Modal";
import LensPanel from "./LensPanel";

export default function Inspector() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const selected = useStore((s) => s.selected);
  const [tab, setTab] = useState<"card" | "layers" | "lens">("card");
  const loc = selected ? locate(m, selected) : null;

  if (!loc) {
    return (
      <aside className="inspector">
        <p className="muted">{t("insp.none")}</p>
      </aside>
    );
  }
  const isText = loc.node.type === "text";
  return (
    <aside className="inspector" key={loc.node.id}>
      {isText && (
        <div className="insp-tabs">
          <button className={tab === "card" ? "on" : ""} onClick={() => setTab("card")}>
            {t("insp.tab.card")}
          </button>
          <button className={tab === "layers" ? "on" : ""} onClick={() => setTab("layers")}>
            <Layers size={13} /> {t("insp.tab.layers")}
          </button>
          <button className={tab === "lens" ? "on" : ""} onClick={() => setTab("lens")}>
            <Glasses size={13} /> {t("lens.title")}
          </button>
        </div>
      )}
      {tab === "layers" && isText ? <LayersPanel node={loc.node} /> : tab === "lens" && isText ? <LensPanel /> : <Card node={loc.node} section={loc.section} />}
    </aside>
  );
}

function Card({ node, section }: { node: TreeNode; section: string }) {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const mentions = useStore((s) => s.mentions);
  const edit = useStore((s) => s.editManifest);
  const set = (patch: Partial<TreeNode>) => edit((mm) => void Object.assign(locate(mm, node.id)!.node, patch));
  const w = wordsOf(node, words);
  const characters = m.codex.filter((e) => e.kind === "character");
  const here = node.file ? m.codex.filter((e) => mentions[e.id]?.[node.file!]) : [];
  const openComments = (node.comments ?? []).filter((c) => !c.resolved).length;
  const showResolved = useStore((s) => s.settings.showResolved);

  return (
    <>
      {section === "trash" && <p className="muted">{t("insp.inTrash")}</p>}
      <label className="field">
        <span>{t("insp.title")}</span>
        <input id="insp-title" className="input" value={node.title} onChange={(e) => set({ title: e.target.value })} />
      </label>

      {node.type === "text" && (
        <div className="field">
          <span>{t("tree.status")}</span>
          <div className="statuses-row">
            {STATUSES.map((s) => (
              <button key={s} className={node.status === s ? "on" : ""} onClick={() => set({ status: s })}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: `var(--st-${s})` }} />
                {t(`status.${s}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {section === "manuscript" && (
        <label className="check">
          <input id="insp-include" type="checkbox" checked={node.include} onChange={(e) => set({ include: e.target.checked })} />
          {t("tree.include")}
        </label>
      )}

      {section === "manuscript" && node.type === "text" && (
        <div className="grid2">
          <label className="field">
            <span>{t("insp.pov")}</span>
            <select id="insp-pov" className="select" value={node.pov ?? ""} onChange={(e) => set({ pov: e.target.value || undefined })}>
              <option value="">—</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("insp.day")}</span>
            <input id="insp-day" className="input" value={node.day ?? ""} placeholder={t("insp.dayPh")} onChange={(e) => set({ day: e.target.value })} />
          </label>
        </div>
      )}

      <label className="field">
        <span>{t("insp.synopsis")}</span>
        <textarea id="insp-synopsis" className="textarea" rows={4} value={node.synopsis} placeholder={t("insp.synopsisPh")} onChange={(e) => set({ synopsis: e.target.value })} />
      </label>

      {node.type === "text" && (
        <div className="field">
          <span>{t("insp.target")}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="insp-target"
              className="input"
              type="number"
              min={0}
              step={100}
              style={{ width: 110 }}
              value={node.target || ""}
              placeholder={t("insp.noTarget")}
              onChange={(e) => set({ target: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatNumber(w, lang)}
              {node.target > 0 && ` / ${formatNumber(node.target, lang)}`}
            </span>
          </div>
          {node.target > 0 && (
            <div className="bar">
              <i style={{ width: `${Math.min(100, (w / node.target) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {here.length > 0 && (
        <div className="field">
          <span>{t("insp.here")}</span>
          <div className="chips">
            {here.map((e) => (
              <button key={e.id} className="chip-entry" onClick={() => useStore.setState({ split: { kind: "codex", id: e.id } })}>
                <Avatar rel={e.image} name={e.name} color={e.color} />
                {e.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {node.type === "text" && (
        <div className="field">
          <span>{t("cm.title")}</span>
          <div className="muted">
            {openComments ? t("cm.open", { n: openComments }) : t("cm.none")}
            {" · "}
            <label className="check" style={{ display: "inline-flex" }}>
              <input
                id="insp-resolved"
                type="checkbox"
                checked={showResolved}
                onChange={(e) => useStore.getState().setSettings({ showResolved: e.target.checked })}
              />
              {t("cm.showResolved")}
            </label>
          </div>
        </div>
      )}

      <label className="field">
        <span>{t("insp.notes")}</span>
        <textarea id="insp-notes" className="textarea" rows={8} value={node.notes} placeholder={t("insp.notesPh")} onChange={(e) => set({ notes: e.target.value })} />
      </label>
    </>
  );
}

export function Avatar({ rel, name, color, size = 20 }: { rel?: string; name: string; color: string; size?: number }) {
  const url = useAsset(rel);
  return url ? (
    <img className="avatar" src={url} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.5 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function stampDate(stamp: string) {
  const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)/.exec(stamp);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toLocaleString() : stamp;
}

function LayersPanel({ node }: { node: TreeNode }) {
  const t = useT();
  const root = useStore((s) => s.project!.root);
  const [list, setList] = useState<Snapshot[]>([]);
  const [name, setName] = useState("");
  const [compare, setCompare] = useState<Snapshot | null>(null);

  const load = useCallback(() => void api.snapshotList(root, node.id).then(setList, () => setList([])), [root, node.id]);
  useEffect(load, [load]);

  const create = async () => {
    try {
      await flushTexts();
      const body = await api.textRead(root, node.file!);
      await api.snapshotCreate(root, node.id, name.trim(), body);
      setName("");
      load();
      useStore.getState().toast(t("layers.created"));
    } catch (e) {
      useStore.getState().toast(errorText(e), "error");
    }
  };

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        {t("layers.hint")}
      </p>
      <div style={{ display: "flex", gap: 6 }}>
        <input id="layer-name" className="input" value={name} placeholder={t("layers.namePh")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
        <button className="btn primary" onClick={() => void create()}>
          <Plus size={14} />
        </button>
      </div>
      {list.length === 0 && <p className="muted">{t("layers.none")}</p>}
      <div className="layer-list">
        {list.map((s) => (
          <button key={s.stamp} className="layer-item" onClick={() => setCompare(s)}>
            <b>{s.name || t("layers.unnamed")}</b>
            <small className="muted">
              {stampDate(s.stamp)} · {s.words} {t("ed.words")}
            </small>
          </button>
        ))}
      </div>
      {compare && <CompareDialog node={node} snap={compare} onClose={() => setCompare(null)} onChange={load} />}
    </>
  );
}

function CompareDialog({ node, snap, onClose, onChange }: { node: TreeNode; snap: Snapshot; onClose: () => void; onChange: () => void }) {
  const t = useT();
  const root = useStore((s) => s.project!.root);
  const [parts, setParts] = useState<ReturnType<typeof diffWords> | null>(null);
  const [old, setOld] = useState("");

  useEffect(() => {
    void (async () => {
      await flushTexts();
      const [a, b] = await Promise.all([api.snapshotRead(root, node.id, snap.stamp), api.textRead(root, node.file!)]);
      setOld(a);
      setParts(diffWords(markdownToPlain(a), markdownToPlain(b)));
    })();
  }, [root, node, snap]);

  const restore = async () => {
    if (!(await ask(tNow("layers.restoreAsk"), { title: tNow("layers.restore"), kind: "warning" }))) return;
    try {
      await flushTexts();
      const current = await api.textRead(root, node.file!);
      await api.snapshotCreate(root, node.id, tNow("layers.beforeRestore"), current);
      await api.textWrite(root, node.file!, node.id, node.title, old);
      const st = useStore.getState();
      st.setWords(node.file!, countWords(markdownToPlain(old)));
      useStore.setState({ reload: st.reload + 1 });
      st.toast(t("layers.restored"));
      onChange();
      onClose();
    } catch (e) {
      useStore.getState().toast(errorText(e), "error");
    }
  };

  const remove = async () => {
    if (!(await ask(tNow("layers.deleteAsk"), { title: tNow("layers.delete"), kind: "warning" }))) return;
    await api.snapshotDelete(root, node.id, snap.stamp).catch(() => {});
    onChange();
    onClose();
  };

  return (
    <Modal
      title={`${t("layers.compare")} · ${snap.name || stampDate(snap.stamp)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" style={{ marginRight: "auto", color: "var(--danger)" }} onClick={() => void remove()}>
            <Trash2 size={14} /> {t("layers.delete")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("set.close")}
          </button>
          <button className="btn primary" onClick={() => void restore()}>
            <RotateCcw size={14} /> {t("layers.restore")}
          </button>
        </>
      }
    >
      <div className="body">
        {!parts ? (
          <p className="muted">{t("ed.loading")}</p>
        ) : (
          <div className="diff">
            <div>
              <div className="k">{stampDate(snap.stamp)}</div>
              <div className="diff-col">
                {parts.filter((p) => !p.added).map((p, i) => (
                  <span key={i} className={p.removed ? "dl" : undefined}>
                    {p.value}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="k">{t("layers.current")}</div>
              <div className="diff-col">
                {parts.filter((p) => !p.removed).map((p, i) => (
                  <span key={i} className={p.added ? "da" : undefined}>
                    {p.value}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
