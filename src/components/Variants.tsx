import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { diffWords } from "diff";
import { Check, Columns2, GitBranch, Plus, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { TreeNode } from "../types";
import { tNow, useT } from "../lib/i18n";
import { acceptChanges, markdownToHtml, markdownToPlain as rawPlain, stripComments } from "../lib/markdown";

/** Texto plano tal como se leería: comentarios fuera y cambios aceptados. */
const markdownToPlain = (md: string) => rawPlain(acceptChanges(stripComments(md)));
import { countWords, formatNumber } from "../lib/words";
import { createVariant, deleteVariant, readVariant, renameVariant, switchVariant } from "../lib/variants";
import { locate } from "../lib/tree";
import { errorText } from "../lib/api";

/** Variantes en la barra de la Hoja: A · B · C, una nueva y comparar. */
export function VariantsBar({ node }: { node: TreeNode }) {
  const t = useT();
  const live = useStore((s) => locate(s.project!.manifest, node.id)?.node ?? node);
  const [compare, setCompare] = useState(false);
  const toast = useStore((s) => s.toast);
  const list = live.variants ?? [];
  const active = live.variantActive ?? list[0]?.id;
  const run = (p: Promise<void>) => void p.catch((e) => toast(errorText(e), "error"));
  return (
    <span className="eb-group variants">
      <GitBranch size={14} className="muted" />
      {list.map((v) => (
        <button key={v.id} className={`var-chip ${v.id === active ? "on" : ""}`} title={v.name !== v.id ? v.name : t("var.switch", { v: v.name })} onClick={() => run(switchVariant(node.id, v.id))}>
          {v.id}
        </button>
      ))}
      <button className="icon-btn" title={t("var.new")} onClick={() => run(createVariant(node.id))}>
        <Plus size={14} />
      </button>
      {list.length > 1 && (
        <button className="icon-btn" title={t("var.compare")} onClick={() => setCompare(true)}>
          <Columns2 size={14} />
        </button>
      )}
      {compare && <VariantCompare id={node.id} onClose={() => setCompare(false)} />}
    </span>
  );
}

function VariantCompare({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const n = useStore((s) => locate(s.project!.manifest, id)?.node);
  const lang = useStore((s) => s.settings.lang);
  const list = n?.variants ?? [];
  const active = n?.variantActive ?? list[0]?.id;
  const [left, setLeft] = useState(active ?? "A");
  const [right, setRight] = useState(list.find((v) => v.id !== active)?.id ?? "B");
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState(false);
  const sig = list.map((v) => v.id).join(",") + active;

  useEffect(() => {
    if (!n) return;
    let alive = true;
    void Promise.all(list.map(async (v) => [v.id, await readVariant(n, v.id)] as const)).then((pairs) => alive && setTexts(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parts = useMemo(() => (diff ? diffWords(markdownToPlain(texts[left] ?? ""), markdownToPlain(texts[right] ?? "")) : []), [diff, texts, left, right]);
  if (!n) return null;

  const column = (vid: string, setVid: (v: string) => void, side: "l" | "r") => {
    const v = list.find((x) => x.id === vid);
    const body = texts[vid] ?? "";
    return (
      <div className="vc-col">
        <div className="vc-head">
          <select className="select" value={vid} onChange={(e) => setVid(e.target.value)}>
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {t("var.label", { v: x.id })}
                {x.name !== x.id ? ` · ${x.name}` : ""}
              </option>
            ))}
          </select>
          <span className="muted">
            {formatNumber(countWords(markdownToPlain(body)), lang)} {t("ed.words")}
          </span>
          {vid === active ? (
            <span className="badge">{t("var.inBook")}</span>
          ) : (
            <>
              <button className="btn primary" onClick={() => void switchVariant(id, vid)}>
                <Check size={14} /> {t("var.choose")}
              </button>
              <button
                className="icon-btn danger"
                title={t("var.delete")}
                onClick={async () => {
                  if (await ask(tNow("var.deleteAsk", { v: vid }), { kind: "warning" })) await deleteVariant(id, vid);
                }}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
        {v && <input className="input vc-name" value={v.name} placeholder={t("var.namePh")} onChange={(e) => renameVariant(id, vid, e.target.value || vid)} />}
        {diff ? (
          <div className="vc-body diff">
            {parts.map((p, i) =>
              p.added ? (side === "r" ? <ins key={i}>{p.value}</ins> : null) : p.removed ? (side === "l" ? <del key={i}>{p.value}</del> : null) : <span key={i}>{p.value}</span>,
            )}
          </div>
        ) : (
          <div className="vc-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(body) }} />
        )}
      </div>
    );
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="var-compare" role="dialog" aria-label={t("var.compare")}>
        <header>
          <h2>
            {t("var.compare")} · {n.title}
          </h2>
          <label className="check">
            <input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> {t("var.diff")}
          </label>
          <button className="icon-btn" onClick={onClose} aria-label={t("set.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="vc-cols">
          {column(left, setLeft, "l")}
          {column(right, setRight, "r")}
        </div>
      </div>
    </div>
  );
}
