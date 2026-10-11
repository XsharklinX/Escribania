import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Palette, Plus, StickyNote, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { Board, BoardItem } from "../types";
import { tNow, useT } from "../lib/i18n";
import { api } from "../lib/api";
import { importFiles, IMAGE_EXT, useAsset } from "../lib/assets";
import { newBoard } from "../lib/model";
import { newId } from "../lib/ids";

const CANVAS_W = 2600;
const CANVAS_H = 1700;
const NOTE_COLORS = ["#FFE680", "#FFC9C2", "#C8E6C9", "#C5D8FF", "#E8D5FF"];

export default function MoodBoard() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const root = useStore((s) => s.project!.root);
  const edit = useStore((s) => s.editManifest);
  const [boardId, setBoardId] = useState<string | null>(m.boards[0]?.id ?? null);
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [live, setLive] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const board = m.boards.find((b) => b.id === boardId) ?? null;

  useEffect(() => {
    if (!board && m.boards[0]) setBoardId(m.boards[0].id);
  }, [board, m.boards]);

  const editBoard = (fn: (b: Board) => void) => edit((mm) => fn(mm.boards.find((b) => b.id === boardId)!));
  const editItem = (id: string, patch: Partial<BoardItem>) => editBoard((b) => void Object.assign(b.items.find((i) => i.id === id)!, patch));

  // Al añadir algo, aparece en el centro de lo que se está viendo.
  const spot = (w: number, h: number) => {
    const el = scrollRef.current;
    const cx = el ? (el.scrollLeft + el.clientWidth / 2) / zoom : 400;
    const cy = el ? (el.scrollTop + el.clientHeight / 2) / zoom : 300;
    return { x: Math.round(cx - w / 2 + (Math.random() - 0.5) * 80), y: Math.round(cy - h / 2 + (Math.random() - 0.5) * 60), rot: Math.round((Math.random() - 0.5) * 6) };
  };

  const addBoard = () => {
    const b = newBoard(`${t("mural.board")} ${m.boards.length + 1}`);
    edit((mm) => void mm.boards.push(b));
    setBoardId(b.id);
  };

  const addImages = async () => {
    const imgs = await importFiles("recursos", IMAGE_EXT);
    if (!imgs.length) return;
    editBoard((b) => {
      for (const img of imgs) b.items.push({ id: newId(), kind: "image", w: 260, h: 200, asset: img.rel, caption: "", ...spot(260, 200) });
    });
  };

  const addNote = () => editBoard((b) => void b.items.push({ id: newId(), kind: "note", w: 180, h: 150, text: "", color: NOTE_COLORS[b.items.length % NOTE_COLORS.length], ...spot(180, 150) }));
  const addSwatch = () =>
    editBoard((b) => void b.items.push({ id: newId(), kind: "swatch", w: 250, h: 70, colors: ["#1D2B3A", "#3E5A6B", "#C9A46A", "#E8DCC4", "#8C2F1E"], ...spot(250, 70) }));

  const removeItem = (id: string) => {
    const item = board?.items.find((i) => i.id === id);
    editBoard((b) => void (b.items = b.items.filter((i) => i.id !== id)));
    // La imagen se borra del proyecto si ya no se usa en ningún sitio.
    if (item?.asset) {
      const used = m.boards.some((b) => b.items.some((i) => i.id !== id && i.asset === item.asset)) || m.codex.some((e) => e.image === item.asset);
      if (!used) void api.assetDelete(root, item.asset).catch(() => {});
    }
    setSel(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || !sel) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      removeItem(sel);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const startDrag = (e: React.PointerEvent, item: BoardItem, mode: "move" | "resize") => {
    if ((e.target as HTMLElement).closest("textarea, input")) return;
    e.preventDefault();
    e.stopPropagation();
    setSel(item.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h };
    let last = start;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom;
      const dy = (ev.clientY - sy) / zoom;
      last =
        mode === "move"
          ? { ...start, x: Math.round(Math.min(CANVAS_W - 40, Math.max(0, start.x + dx))), y: Math.round(Math.min(CANVAS_H - 40, Math.max(0, start.y + dy))) }
          : { ...start, w: Math.round(Math.max(80, start.w + dx)), h: Math.round(Math.max(50, start.h + dy)) };
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      if (last !== start) editItem(item.id, { x: last.x, y: last.y, w: last.w, h: last.h });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="view mural-view">
      <div className="view-head">
        <div className="board-tabs">
          {m.boards.map((b) =>
            renaming && b.id === boardId ? (
              <input
                key={b.id}
                className="input"
                autoFocus
                defaultValue={b.name}
                style={{ width: 160 }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) editBoard((bb) => void (bb.name = v));
                  setRenaming(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <button key={b.id} className={b.id === boardId ? "on" : ""} onClick={() => setBoardId(b.id)} onDoubleClick={() => setRenaming(true)}>
                {b.name}
              </button>
            ),
          )}
          <button onClick={addBoard} title={t("mural.newBoard")}>
            <Plus size={14} />
          </button>
        </div>
        <span className="spacer" />
        {board && (
          <>
            <button className="btn" onClick={() => void addImages()}>
              <ImagePlus size={15} /> {t("mural.image")}
            </button>
            <button className="btn" onClick={addNote}>
              <StickyNote size={15} /> {t("mural.note")}
            </button>
            <button className="btn" onClick={addSwatch}>
              <Palette size={15} /> {t("mural.palette")}
            </button>
            <select className="select" style={{ width: 170 }} value={board.linkedTo ?? ""} onChange={(e) => editBoard((b) => void (b.linkedTo = e.target.value || undefined))} title={t("mural.link")}>
              <option value="">{t("mural.noLink")}</option>
              {m.codex.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input type="range" min={0.3} max={1.5} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} title={t("mural.zoom")} style={{ width: 90 }} />
            <button
              className="icon-btn danger"
              title={t("mural.deleteBoard")}
              onClick={async () => {
                if (!(await ask(tNow("mural.deleteAsk", { name: board.name }), { kind: "warning" }))) return;
                edit((mm) => void (mm.boards = mm.boards.filter((b) => b.id !== board.id)));
                setBoardId(null);
              }}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      {!board ? (
        <div className="editor-empty">
          <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
            <p>{t("mural.empty")}</p>
            <button className="btn primary" onClick={addBoard}>
              <Plus size={15} /> {t("mural.newBoard")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mural-scroll" ref={scrollRef} onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
          <div className="mural-canvas" style={{ width: CANVAS_W * zoom, height: CANVAS_H * zoom }} onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", width: CANVAS_W, height: CANVAS_H, position: "relative" }} onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
              {board.items.length === 0 && <p className="mural-hint">{t("mural.hint")}</p>}
              {board.items.map((it) => {
                const g = live?.id === it.id ? live : it;
                return (
                  <div
                    key={it.id}
                    className={`m-item ${it.kind} ${sel === it.id ? "on" : ""}`}
                    style={{ left: g.x, top: g.y, width: g.w, height: g.h, transform: `rotate(${it.rot}deg)`, background: it.kind === "note" ? it.color : undefined }}
                    onPointerDown={(e) => startDrag(e, it, "move")}
                  >
                    <ItemBody item={it} onChange={(p) => editItem(it.id, p)} />
                    {sel === it.id && (
                      <>
                        <span className="m-resize" onPointerDown={(e) => startDrag(e, it, "resize")} />
                        <button className="m-del" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeItem(it.id)} title={t("cm.delete")}>
                          <Trash2 size={12} />
                        </button>
                        {it.kind === "note" && (
                          <div className="m-colors" onPointerDown={(e) => e.stopPropagation()}>
                            {NOTE_COLORS.map((c) => (
                              <button key={c} style={{ background: c }} onClick={() => editItem(it.id, { color: c })} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemBody({ item, onChange }: { item: BoardItem; onChange: (p: Partial<BoardItem>) => void }) {
  const t = useT();
  const url = useAsset(item.kind === "image" ? item.asset : null);
  if (item.kind === "image")
    return (
      <>
        <div className="m-photo">{url ? <img src={url} alt="" draggable={false} /> : null}</div>
        <input className="m-caption" value={item.caption ?? ""} placeholder={t("mural.caption")} onChange={(e) => onChange({ caption: e.target.value })} />
      </>
    );
  if (item.kind === "note") return <textarea className="m-note" value={item.text ?? ""} placeholder={t("mural.notePh")} onChange={(e) => onChange({ text: e.target.value })} />;
  return (
    <div className="m-swatch">
      {(item.colors ?? []).map((c, i) => (
        <label key={i} style={{ background: c }}>
          <input type="color" value={c} onChange={(e) => onChange({ colors: item.colors!.map((x, j) => (j === i ? e.target.value : x)) })} />
        </label>
      ))}
    </div>
  );
}
