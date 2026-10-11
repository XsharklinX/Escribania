import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ImagePlus, MapPin, MousePointer2, Route, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { MapDef, MapPin as Pin } from "../types";
import { tNow, useT } from "../lib/i18n";
import { importFiles, IMAGE_EXT, useAsset } from "../lib/assets";
import { newId } from "../lib/ids";
import { PALETTE } from "../lib/model";

type Mode = "select" | "pin" | "route";

/** Cartógrafo: mapas propios con chinchetas enlazadas a los lugares del Códice. */
export default function MapView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const [mapId, setMapId] = useState<string | null>(m.maps[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>("select");
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<{ kind: "pin" | "route"; id: string } | null>(null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [dragPin, setDragPin] = useState<{ id: string; x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const map = m.maps.find((x) => x.id === mapId) ?? null;
  const img = useAsset(map?.image);

  useEffect(() => {
    if (!map && m.maps[0]) setMapId(m.maps[0].id);
  }, [map, m.maps]);

  const editMap = (fn: (mm: MapDef) => void) => edit((mf) => fn(mf.maps.find((x) => x.id === mapId)!));
  const rel = (e: React.MouseEvent | PointerEvent): [number, number] => {
    const r = stage.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const addMap = async () => {
    const [file] = await importFiles("recursos", IMAGE_EXT, false);
    if (!file) return;
    const def: MapDef = { id: newId(), name: file.name.replace(/\.[^.]+$/, ""), image: file.rel, pins: [], routes: [] };
    edit((mf) => void mf.maps.push(def));
    setMapId(def.id);
  };

  const finishRoute = () => {
    if (drawing && drawing.length > 1) editMap((mm) => void mm.routes.push({ id: newId(), color: "#C0392B", points: drawing }));
    setDrawing(null);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Enter" && drawing) finishRoute();
      if (e.key === "Escape") {
        setDrawing(null);
        setSel(null);
      }
      if (e.key === "Delete" && sel) {
        editMap((mm) => {
          if (sel.kind === "pin") mm.pins = mm.pins.filter((p) => p.id !== sel.id);
          else mm.routes = mm.routes.filter((r) => r.id !== sel.id);
        });
        setSel(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const onStageClick = (e: React.MouseEvent) => {
    if (!map) return;
    const [x, y] = rel(e);
    if (mode === "pin") {
      const pin: Pin = { id: newId(), x, y, label: t("map.newPin"), color: PALETTE[map.pins.length % PALETTE.length] };
      editMap((mm) => void mm.pins.push(pin));
      setSel({ kind: "pin", id: pin.id });
      setMode("select");
    } else if (mode === "route") {
      setDrawing([...(drawing ?? []), [x, y]]);
    } else if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "IMG") setSel(null);
  };

  const startPinDrag = (e: React.PointerEvent, p: Pin) => {
    if (mode !== "select") return;
    e.stopPropagation();
    setSel({ kind: "pin", id: p.id });
    let moved = false;
    let last = { x: p.x, y: p.y };
    const move = (ev: PointerEvent) => {
      moved = true;
      const [x, y] = rel(ev);
      last = { x, y };
      setDragPin({ id: p.id, x, y });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragPin(null);
      if (moved) editMap((mm) => void Object.assign(mm.pins.find((q) => q.id === p.id)!, last));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pin = sel?.kind === "pin" ? map?.pins.find((p) => p.id === sel.id) : undefined;
  const places = m.codex.filter((e) => e.kind === "place");

  return (
    <div className="view map-view">
      <div className="view-head">
        <div className="board-tabs">
          {m.maps.map((x) => (
            <button key={x.id} className={x.id === mapId ? "on" : ""} onClick={() => setMapId(x.id)}>
              {x.name}
            </button>
          ))}
          <button onClick={() => void addMap()} title={t("map.add")}>
            <ImagePlus size={14} />
          </button>
        </div>
        <span className="spacer" />
        {map && (
          <>
            <div className="seg">
              <button className={mode === "select" ? "on" : ""} onClick={() => setMode("select")} title={t("map.select")}>
                <MousePointer2 size={14} />
              </button>
              <button className={mode === "pin" ? "on" : ""} onClick={() => setMode("pin")} title={t("map.pin")}>
                <MapPin size={14} />
              </button>
              <button className={mode === "route" ? "on" : ""} onClick={() => setMode("route")} title={t("map.route")}>
                <Route size={14} />
              </button>
            </div>
            <input className="input" style={{ width: 170 }} value={map.name} onChange={(e) => editMap((mm) => void (mm.name = e.target.value))} />
            <input type="range" min={0.4} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 100 }} title={t("mural.zoom")} />
            <button
              className="icon-btn danger"
              title={t("map.delete")}
              onClick={async () => {
                if (!(await ask(tNow("map.deleteAsk", { name: map.name }), { kind: "warning" }))) return;
                edit((mf) => void (mf.maps = mf.maps.filter((x) => x.id !== map.id)));
                setMapId(null);
              }}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      {!map ? (
        <div className="editor-empty">
          <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
            <p>{t("map.empty")}</p>
            <button className="btn primary" onClick={() => void addMap()}>
              <ImagePlus size={15} /> {t("map.add")}
            </button>
          </div>
        </div>
      ) : (
        <div className="map-scroll">
          <div className={`map-stage mode-${mode}`} ref={stage} style={{ width: `${zoom * 100}%` }} onClick={onStageClick} onDoubleClick={() => mode === "route" && finishRoute()}>
            {img && <img src={img} alt="" draggable={false} />}
            <svg className="map-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              {map.routes.map((r) => (
                <polyline
                  key={r.id}
                  points={r.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")}
                  className={`map-route ${sel?.kind === "route" && sel.id === r.id ? "on" : ""}`}
                  style={{ stroke: r.color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (mode === "select") setSel({ kind: "route", id: r.id });
                  }}
                />
              ))}
              {drawing && <polyline points={drawing.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} className="map-route drawing" />}
            </svg>
            {map.pins.map((p) => {
              const pos = dragPin?.id === p.id ? dragPin : p;
              const entry = m.codex.find((e) => e.id === p.entry);
              return (
                <div key={p.id} className={`map-pin ${pin?.id === p.id ? "on" : ""}`} style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }} onPointerDown={(e) => startPinDrag(e, p)} onClick={(e) => e.stopPropagation()}>
                  <span className="map-pin-head" style={{ background: p.color }} />
                  <span className="map-pin-label">{entry?.name ?? p.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="tl-bottom">
        {pin ? (
          <div className="tl-panel">
            <input className="input" value={pin.label} onChange={(e) => editMap((mm) => void (mm.pins.find((p) => p.id === pin.id)!.label = e.target.value))} />
            <select className="select" value={pin.entry ?? ""} onChange={(e) => editMap((mm) => void (mm.pins.find((p) => p.id === pin.id)!.entry = e.target.value || undefined))}>
              <option value="">{t("map.noPlace")}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input type="color" className="color" value={pin.color} onChange={(e) => editMap((mm) => void (mm.pins.find((p) => p.id === pin.id)!.color = e.target.value))} />
            {pin.entry && (
              <button className="btn" onClick={() => useStore.setState({ view: "codice", codexSelected: pin.entry! })}>
                {t("map.openEntry")}
              </button>
            )}
            <button
              className="icon-btn danger"
              onClick={() => {
                editMap((mm) => void (mm.pins = mm.pins.filter((p) => p.id !== pin.id)));
                setSel(null);
              }}
            >
              <Trash2 size={14} />
            </button>
            <button className="icon-btn" onClick={() => setSel(null)}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <p className="muted">{mode === "route" ? t("map.routeHint") : mode === "pin" ? t("map.pinHint") : t("map.hint")}</p>
        )}
      </div>
    </div>
  );
}
