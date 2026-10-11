import { save } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, Download, FileText, Folder } from "lucide-react";
import { useStore } from "../store";
import type { Manifest, Status, TreeNode } from "../types";
import { useT, type TKey } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { locate, wordsOf } from "../lib/tree";
import { formatNumber } from "../lib/words";
import { slugify } from "../lib/ids";
import { STATUSES } from "./Binder";

export const OUTLINE_COLUMNS: { id: string; key: TKey }[] = [
  { id: "synopsis", key: "insp.synopsis" },
  { id: "pov", key: "insp.pov" },
  { id: "day", key: "insp.day" },
  { id: "status", key: "tree.status" },
  { id: "words", key: "ed.words" },
  { id: "target", key: "insp.target" },
  { id: "include", key: "outline.include" },
];

interface Row {
  node: TreeNode;
  depth: number;
}

function rows(list: TreeNode[], depth = 0, out: Row[] = []): Row[] {
  for (const n of list) {
    out.push({ node: n, depth });
    if (n.children && n.open !== false) rows(n.children, depth + 1, out);
  }
  return out;
}

function csv(m: Manifest, words: Record<string, number>, lang: string): string {
  const cell = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [["Nivel", "Título", "Tipo", "Sinopsis", "POV", "Día", "Estado", "Palabras", "Meta", "Incluir"].map(cell).join(";")];
  for (const { node, depth } of rows(m.sections.manuscript)) {
    const pov = m.codex.find((c) => c.id === node.pov)?.name ?? "";
    lines.push(
      [depth, node.title, node.type, node.synopsis, pov, node.day ?? "", node.status, wordsOf(node, words), node.target || "", node.include ? "sí" : "no"].map(cell).join(";"),
    );
  }
  void lang;
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export default function Outline() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const selected = useStore((s) => s.selected);
  const cols = useStore((s) => s.settings.outlineColumns);
  const setSettings = useStore((s) => s.setSettings);
  const edit = useStore((s) => s.editManifest);
  const characters = m.codex.filter((e) => e.kind === "character");
  const set = (id: string, patch: Partial<TreeNode>) => edit((mm) => void Object.assign(locate(mm, id)!.node, patch));
  const has = (c: string) => cols.includes(c);

  const exportCsv = async () => {
    try {
      const path = await save({ defaultPath: `${slugify(m.title)}-escaleta.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      await api.fileWriteText(path, csv(m, words, lang));
      useStore.getState().toast(t("exp.done") + ": " + path);
    } catch (e) {
      useStore.getState().toast(errorText(e), "error");
    }
  };

  const all = rows(m.sections.manuscript);
  return (
    <div className="view outline-view">
      <div className="view-head">
        <h2>{t("view.escaleta")}</h2>
        <span className="spacer" />
        <div className="col-toggles">
          {OUTLINE_COLUMNS.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={has(c.id)} onChange={(e) => setSettings({ outlineColumns: e.target.checked ? [...cols, c.id] : cols.filter((x) => x !== c.id) })} />
              {t(c.key)}
            </label>
          ))}
        </div>
        <button className="btn" onClick={() => void exportCsv()}>
          <Download size={15} /> CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="outline">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>{t("insp.title")}</th>
              {has("synopsis") && <th style={{ minWidth: 260 }}>{t("insp.synopsis")}</th>}
              {has("pov") && <th>{t("insp.pov")}</th>}
              {has("day") && <th>{t("insp.day")}</th>}
              {has("status") && <th>{t("tree.status")}</th>}
              {has("words") && <th className="num">{t("ed.words")}</th>}
              {has("target") && <th className="num">{t("insp.target")}</th>}
              {has("include") && <th>{t("outline.include")}</th>}
            </tr>
          </thead>
          <tbody>
            {all.map(({ node, depth }) => {
              const folder = node.type === "folder";
              const w = wordsOf(node, words);
              return (
                <tr key={node.id} className={`${folder ? "folder" : ""} ${selected === node.id ? "on" : ""}`} onClick={() => useStore.getState().select(node.id)}>
                  <td>
                    <div className="o-title" style={{ paddingLeft: depth * 18 }}>
                      {folder ? (
                        <button className="chev" onClick={() => set(node.id, { open: node.open === false })}>
                          {node.open === false ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        </button>
                      ) : (
                        <span style={{ width: 16 }} />
                      )}
                      {folder ? <Folder size={14} className="muted" /> : <FileText size={14} className="muted" />}
                      <input className="cell" value={node.title} onChange={(e) => set(node.id, { title: e.target.value })} />
                      {!folder && (
                        <button className="open-link" title={t("outline.open")} onClick={() => useStore.setState({ selected: node.id, view: "hoja" })}>
                          ↗
                        </button>
                      )}
                    </div>
                  </td>
                  {has("synopsis") && (
                    <td>
                      <textarea className="cell" rows={Math.max(1, Math.ceil(node.synopsis.length / 48))} value={node.synopsis} onChange={(e) => set(node.id, { synopsis: e.target.value })} />
                    </td>
                  )}
                  {has("pov") && (
                    <td>
                      {!folder && (
                        <select className="cell" value={node.pov ?? ""} onChange={(e) => set(node.id, { pov: e.target.value || undefined })}>
                          <option value="">—</option>
                          {characters.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  )}
                  {has("day") && <td>{!folder && <input className="cell" style={{ width: 110 }} value={node.day ?? ""} onChange={(e) => set(node.id, { day: e.target.value })} />}</td>}
                  {has("status") && (
                    <td>
                      {!folder && (
                        <select className="cell" value={node.status} onChange={(e) => set(node.id, { status: e.target.value as Status })}>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(`status.${s}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  )}
                  {has("words") && <td className="num">{formatNumber(w, lang)}</td>}
                  {has("target") && (
                    <td className="num">
                      {!folder && (
                        <input className="cell num" type="number" min={0} step={100} style={{ width: 80 }} value={node.target || ""} onChange={(e) => set(node.id, { target: Math.max(0, Number(e.target.value) || 0) })} />
                      )}
                    </td>
                  )}
                  {has("include") && (
                    <td>
                      <input type="checkbox" checked={node.include} onChange={(e) => set(node.id, { include: e.target.checked })} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
