import { useState } from "react";
import { Heart, Plus, Users } from "lucide-react";
import { useStore } from "../store";
import type { CodexEntry, Manifest } from "../types";
import { useT, type TKey } from "../lib/i18n";
import { newId } from "../lib/ids";
import { Avatar } from "./Inspector";

const CARD_W = 150;
const CARD_H = 64;
const GAP_X = 40;
const GAP_Y = 90;

export interface Placed {
  id: string;
  x: number;
  y: number;
  gen: number;
}

/** Coloca a cada persona por generaciones: hijos debajo de sus padres, parejas juntas. */
export function familyLayout(m: Manifest, ids: string[]): Placed[] {
  const parents = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  for (const r of m.relations) {
    if (!ids.includes(r.from) || !ids.includes(r.to)) continue;
    if (r.kind === "parent") parents.set(r.to, [...(parents.get(r.to) ?? []), r.from]);
    if (r.kind === "spouse") {
      spouses.set(r.from, [...(spouses.get(r.from) ?? []), r.to]);
      spouses.set(r.to, [...(spouses.get(r.to) ?? []), r.from]);
    }
  }
  const gen = new Map<string, number>();
  const visiting = new Set<string>();
  const g = (id: string): number => {
    if (gen.has(id)) return gen.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ps = parents.get(id) ?? [];
    const v = ps.length ? Math.max(...ps.map(g)) + 1 : 0;
    visiting.delete(id);
    gen.set(id, v);
    return v;
  };
  ids.forEach(g);
  // Las parejas, en la misma generación (la mayor de las dos).
  for (let i = 0; i < 3; i++)
    for (const [a, list] of spouses) for (const b of list) {
      const v = Math.max(gen.get(a)!, gen.get(b)!);
      gen.set(a, v);
      gen.set(b, v);
    }
  const levels = new Map<number, string[]>();
  for (const id of ids) levels.set(gen.get(id)!, [...(levels.get(gen.get(id)!) ?? []), id]);
  const x = new Map<string, number>();
  const out: Placed[] = [];
  for (const level of [...levels.keys()].sort((a, b) => a - b)) {
    const row = levels.get(level)!;
    // Orden: media de la posición de los padres; las parejas, seguidas.
    const key = (id: string) => {
      const ps = parents.get(id) ?? [];
      return ps.length ? ps.reduce((s, p) => s + (x.get(p) ?? 0), 0) / ps.length : (spouses.get(id) ?? []).map((s) => x.get(s) ?? Infinity).reduce((a, b) => Math.min(a, b), Infinity);
    };
    const ordered = [...row].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (Number.isFinite(ka) ? ka : 1e9) - (Number.isFinite(kb) ? kb : 1e9) || a.localeCompare(b);
    });
    const placed: string[] = [];
    for (const id of ordered) {
      if (placed.includes(id)) continue;
      placed.push(id);
      for (const s of spouses.get(id) ?? []) if (row.includes(s) && !placed.includes(s)) placed.push(s);
    }
    placed.forEach((id, i) => {
      const px = i * (CARD_W + GAP_X);
      x.set(id, px);
      out.push({ id, x: px, y: level * (CARD_H + GAP_Y), gen: level });
    });
  }
  return out;
}

/** Árbol de linajes a partir de las relaciones "padre/madre de" y "pareja de". */
export default function LinajesView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const [selected, setSelected] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const characters = m.codex.filter((e) => e.kind === "character");
  const involved = new Set(m.relations.filter((r) => r.kind === "parent" || r.kind === "spouse").flatMap((r) => [r.from, r.to]));
  const ids = characters.filter((c) => involved.has(c.id) || c.id === selected).map((c) => c.id);
  const placed = familyLayout(m, ids);
  const pos = new Map(placed.map((p) => [p.id, p]));
  const byId = new Map(characters.map((c) => [c.id, c]));
  const width = Math.max(600, ...placed.map((p) => p.x + CARD_W)) + 40;
  const height = Math.max(300, ...placed.map((p) => p.y + CARD_H)) + 40;

  const add = (kind: "parent" | "child" | "spouse") => {
    if (!selected || !other || other === selected) return;
    const from = kind === "child" ? selected : kind === "parent" ? other : selected;
    const to = kind === "child" ? other : kind === "parent" ? selected : other;
    const labelKey: TKey = kind === "spouse" ? "lin.spouseOf" : "lin.parentOf";
    edit((mm) => void mm.relations.push({ id: newId(), from, to, label: t(labelKey), kind: kind === "spouse" ? "spouse" : "parent" }));
    setOther("");
  };

  // Líneas: pareja (horizontal) y de padres a hijos (en escuadra).
  const lines: string[] = [];
  for (const r of m.relations) {
    const a = pos.get(r.from);
    const b = pos.get(r.to);
    if (!a || !b) continue;
    if (r.kind === "spouse") lines.push(`M${a.x + CARD_W / 2},${a.y + CARD_H / 2} L${b.x + CARD_W / 2},${b.y + CARD_H / 2}`);
  }
  for (const child of placed) {
    const ps = m.relations.filter((r) => r.kind === "parent" && r.to === child.id).map((r) => pos.get(r.from)).filter(Boolean) as Placed[];
    if (!ps.length) continue;
    const px = ps.reduce((s, p) => s + p.x + CARD_W / 2, 0) / ps.length;
    const py = Math.max(...ps.map((p) => p.y)) + CARD_H;
    const midY = py + GAP_Y / 2;
    lines.push(`M${px},${py} L${px},${midY} L${child.x + CARD_W / 2},${midY} L${child.x + CARD_W / 2},${child.y}`);
  }

  const sel = selected ? byId.get(selected) : undefined;
  return (
    <div className="view lineage-view">
      <div className="view-head">
        <h2>{t("view.linajes")}</h2>
        <span className="spacer" />
        <select className="select" style={{ width: 200 }} value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)}>
          <option value="">{t("lin.pick")}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {sel && (
          <>
            <select className="select" style={{ width: 180 }} value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">{t("lin.other")}</option>
              {characters.filter((c) => c.id !== selected).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button className="btn" disabled={!other} onClick={() => add("parent")}>
              <Users size={14} /> {t("lin.addParent")}
            </button>
            <button className="btn" disabled={!other} onClick={() => add("child")}>
              <Plus size={14} /> {t("lin.addChild")}
            </button>
            <button className="btn" disabled={!other} onClick={() => add("spouse")}>
              <Heart size={14} /> {t("lin.addSpouse")}
            </button>
          </>
        )}
      </div>
      {placed.length === 0 ? (
        <p className="muted pad">{characters.length ? t("lin.empty") : t("graph.empty")}</p>
      ) : (
        <div className="lineage-scroll">
          <div className="lineage" style={{ width, height }}>
            <svg width={width} height={height} className="lineage-lines">
              <g transform="translate(20,20)">
                {lines.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </g>
            </svg>
            {placed.map((p) => {
              const c = byId.get(p.id) as CodexEntry;
              return (
                <button
                  key={p.id}
                  className={`lin-card ${selected === p.id ? "on" : ""}`}
                  style={{ left: p.x + 20, top: p.y + 20, width: CARD_W, height: CARD_H, borderColor: c.color }}
                  onClick={() => setSelected(p.id)}
                  onDoubleClick={() => useStore.setState({ view: "codice", codexSelected: p.id })}
                >
                  <Avatar rel={c.image} name={c.name} color={c.color} size={36} />
                  <span>
                    <b>{c.name}</b>
                    <small className="muted">{c.fields.find((f) => /edad|age|†|rol|role/i.test(f.k) && f.v)?.v}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <p className="muted pad">{t("lin.hint")}</p>
    </div>
  );
}
