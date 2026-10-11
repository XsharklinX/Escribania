import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, FilePlus2, FolderPlus, Lightbulb, LogOut, Maximize2, PanelLeft, PanelRight, Search, Settings as Gear, Timer, Upload } from "lucide-react";
import { useStore } from "../store";
import type { View } from "../types";
import { useT, type TKey } from "../lib/i18n";
import { bookWords, locate } from "../lib/tree";
import { formatNumber } from "../lib/words";
import { closeProject } from "../lib/projects";
import { flushAll } from "../lib/saver";
import { stopAllAmbient } from "../lib/ambient";
import { matches } from "../lib/shortcuts";
import Binder, { createNode } from "./Binder";
import SearchPanel from "./SearchPanel";
import EditorPane from "./EditorPane";
import Inspector from "./Inspector";
import StatusBar from "./StatusBar";
import RetiroBar from "./RetiroBar";
import SettingsDialog from "./SettingsDialog";
import ExportDialog from "./ExportDialog";
import GoalRing from "./GoalRing";
import Corkboard from "./Corkboard";
import Outline from "./Outline";
import StructureView from "./StructureView";
import CodexView from "./CodexView";
import GraphView from "./GraphView";
import MoodBoard from "./MoodBoard";
import Termometro from "./Termometro";
import CommandPalette from "./CommandPalette";
import Notebook from "./Notebook";
import { SprintDialog, SprintWidget } from "./Sprint";
import Imprenta from "./Imprenta";
import PulsoView from "./PulsoView";
import RejillaView from "./RejillaView";
import CopoView from "./CopoView";
import CronosView from "./CronosView";
import MapView from "./MapView";
import LinajesView from "./LinajesView";
import ImportDialog from "./ImportDialog";
import TimeMachine from "./TimeMachine";
import Tour from "./Tour";
import SyncDialogs from "./SyncDialogs";
import RepasoView from "./RepasoView";
import CalendarView from "./CalendarView";

export async function setRetiro(on: boolean) {
  useStore.setState({ retiro: on, view: on ? "hoja" : useStore.getState().view, ...(on ? {} : { noNet: false }) });
  if (!on) stopAllAmbient();
  try {
    await getCurrentWindow().setFullscreen(on);
  } catch {
    /* sin pantalla completa: Retiro funciona igual dentro de la ventana */
  }
}

export const VIEWS: { id: View; key: TKey }[] = [
  { id: "hoja", key: "view.hoja" },
  { id: "corcho", key: "view.corcho" },
  { id: "escaleta", key: "view.escaleta" },
  { id: "rejilla", key: "view.rejilla" },
  { id: "estructura", key: "view.estructura" },
  { id: "copo", key: "view.copo" },
  { id: "codice", key: "view.codice" },
  { id: "telarana", key: "view.telarana" },
  { id: "cronos", key: "view.cronos" },
  { id: "mapa", key: "view.mapa" },
  { id: "linajes", key: "view.linajes" },
  { id: "mural", key: "view.mural" },
  { id: "pulso", key: "view.pulso" },
  { id: "repaso", key: "view.repaso" },
  { id: "calendario", key: "view.calendario" },
  { id: "imprenta", key: "view.imprenta" },
  { id: "termometro", key: "view.termometro" },
];

/** Barra de vistas: sueltas o agrupadas en un desplegable. */
const NAV: (View | { key: TKey; views: View[] })[] = [
  "hoja",
  { key: "view.group.plan", views: ["corcho", "escaleta", "rejilla", "estructura", "copo", "calendario"] },
  { key: "view.group.world", views: ["codice", "telarana", "cronos", "mapa", "linajes", "mural"] },
  { key: "view.group.review", views: ["pulso", "repaso"] },
  "imprenta",
  "termometro",
];

/** Vistas que ocupan toda la ventana (sin Legajo ni Inspector). */
const FULL: View[] = ["codice", "telarana", "mural", "termometro", "rejilla", "copo", "cronos", "mapa", "linajes", "pulso", "imprenta", "repaso", "calendario"];

function NavGroup({ label, views, current }: { label: string; views: View[]; current: View }) {
  const t = useT();
  // El menú va en posición fija: la barra de vistas tiene desplazamiento horizontal
  // y recortaría un menú normal (se abría pero no se veía).
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const active = views.includes(current);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && (e.target as HTMLElement).closest(".nav-group")) return;
      setOpen(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <div className="nav-group">
      <button
        className={active ? "on" : ""}
        aria-expanded={Boolean(open)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { left: r.left, top: r.bottom + 4 });
        }}
      >
        {active ? t(VIEWS.find((v) => v.id === current)!.key) : label} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu nav-menu" style={{ position: "fixed", left: open.left, top: open.top }}>
          {views.map((v) => (
            <button
              key={v}
              className={v === current ? "on" : ""}
              onClick={() => {
                useStore.setState({ view: v });
                setOpen(null);
              }}
            >
              {t(VIEWS.find((x) => x.id === v)!.key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Workspace() {
  const t = useT();
  const project = useStore((s) => s.project)!;
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const words = useStore((s) => s.words);
  const retiro = useStore((s) => s.retiro);
  const dialog = useStore((s) => s.dialog);
  const view = useStore((s) => s.view);
  const leftPanel = useStore((s) => s.leftPanel);
  const palette = useStore((s) => s.palette);
  const sprint = useStore((s) => s.sprint);
  const timeMachine = useStore((s) => s.timeMachine);
  const m = project.manifest;
  const total = bookWords(m, words);
  const full = FULL.includes(view);

  // Atajos de teclado de la ventana.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (matches(e, "retiro")) run(() => void setRetiro(!st.retiro));
      else if (e.key === "Escape" && st.retiro && !st.dialog && !st.palette) run(() => void setRetiro(false));
      else if (matches(e, "palette")) run(() => useStore.setState({ palette: !st.palette }));
      else if (matches(e, "search"))
        run(() => {
          useStore.setState({ leftPanel: "search", view: FULL.includes(st.view) ? "hoja" : st.view });
          st.setSettings({ binderOpen: true });
          setTimeout(() => document.getElementById("search-query")?.focus(), 30);
        });
      else if (matches(e, "save")) run(() => void flushAll());
      else if (matches(e, "newText")) run(() => createNode("text"));
      else if (matches(e, "newFolder")) run(() => createNode("folder"));
      else if (matches(e, "export")) run(() => useStore.setState({ dialog: "export" }));
      else if (matches(e, "settings")) run(() => useStore.setState({ dialog: "settings" }));
      else if (matches(e, "binder")) run(() => st.setSettings({ binderOpen: !st.settings.binderOpen }));
      else if (matches(e, "inspector")) run(() => st.setSettings({ inspectorOpen: !st.settings.inspectorOpen }));
      else if (matches(e, "timeMachine") && st.selected && locate(st.project!.manifest, st.selected)?.node.type === "text") run(() => useStore.setState({ timeMachine: st.selected }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Si lo seleccionado desaparece (vaciar papelera), se deselecciona.
  const selected = useStore((s) => s.selected);
  useEffect(() => {
    if (selected && !locate(m, selected)) useStore.setState({ selected: null });
  }, [m, selected]);

  let main;
  switch (view) {
    case "corcho":
      main = <Corkboard />;
      break;
    case "escaleta":
      main = <Outline />;
      break;
    case "estructura":
      main = <StructureView />;
      break;
    case "codice":
      main = <CodexView />;
      break;
    case "telarana":
      main = <GraphView />;
      break;
    case "mural":
      main = <MoodBoard />;
      break;
    case "termometro":
      main = <Termometro />;
      break;
    case "imprenta":
      main = <Imprenta />;
      break;
    case "pulso":
      main = <PulsoView />;
      break;
    case "rejilla":
      main = <RejillaView />;
      break;
    case "copo":
      main = <CopoView />;
      break;
    case "cronos":
      main = <CronosView />;
      break;
    case "mapa":
      main = <MapView />;
      break;
    case "linajes":
      main = <LinajesView />;
      break;
    case "repaso":
      main = <RepasoView />;
      break;
    case "calendario":
      main = <CalendarView />;
      break;
    default:
      main = <EditorPane />;
  }

  return (
    <div className={`workspace ${retiro ? "retiro dim" : ""} para-${settings.paragraph}`}>
      <div className="toolbar">
        <button
          className={`icon-btn ${settings.binderOpen && !full ? "on" : ""}`}
          title={t("tb.binder")}
          disabled={full}
          onClick={() => setSettings({ binderOpen: !settings.binderOpen })}
        >
          <PanelLeft size={17} />
        </button>
        <span className="title" title={project.path}>
          {m.title}
        </span>
        <button className="icon-btn" title={`${t("tree.newText")} (Ctrl+N)`} onClick={() => createNode("text")}>
          <FilePlus2 size={17} />
        </button>
        <button className="icon-btn" title={`${t("tree.newFolder")} (Ctrl+Shift+N)`} onClick={() => createNode("folder")}>
          <FolderPlus size={17} />
        </button>
        <span className="sep" />
        <nav className="modes" aria-label={t("view.label")}>
          {NAV.map((n) =>
            typeof n === "string" ? (
              <button key={n} className={view === n ? "on" : ""} onClick={() => useStore.setState({ view: n })}>
                {t(VIEWS.find((v) => v.id === n)!.key)}
              </button>
            ) : (
              <NavGroup key={n.key} label={t(n.key)} views={n.views} current={view} />
            ),
          )}
        </nav>
        <span className="spacer" />
        {sprint && <SprintWidget />}
        <span className="goal" title={t("sb.book")}>
          <GoalRing value={total} target={m.target.words} />
          {formatNumber(total, settings.lang)}
          {m.target.words > 0 && ` / ${formatNumber(m.target.words, settings.lang)}`}
        </span>
        <button className="icon-btn" title={`${t("search.title")} (Ctrl+Shift+F)`} onClick={() => useStore.setState({ leftPanel: leftPanel === "search" ? "binder" : "search", view: full ? "hoja" : view })}>
          <Search size={17} />
        </button>
        {!sprint && (
          <button className="icon-btn" title={t("sprint.title")} onClick={() => useStore.setState({ dialog: "sprint" })}>
            <Timer size={17} />
          </button>
        )}
        <button className="icon-btn" title={`${t("nb.title")} (Ctrl+Alt+I)`} onClick={() => useStore.setState({ dialog: "capture" })}>
          <Lightbulb size={17} />
        </button>
        <button className="icon-btn" data-tour="retiro" title={t("tb.retiro")} onClick={() => void setRetiro(true)}>
          <Maximize2 size={17} />
        </button>
        <button className="icon-btn" title={t("tb.export")} onClick={() => useStore.setState({ dialog: "export" })}>
          <Upload size={17} />
        </button>
        <button className="icon-btn" title={t("tb.settings")} onClick={() => useStore.setState({ dialog: "settings" })}>
          <Gear size={17} />
        </button>
        <button
          className={`icon-btn ${settings.inspectorOpen && !full ? "on" : ""}`}
          title={t("tb.inspector")}
          disabled={full}
          onClick={() => setSettings({ inspectorOpen: !settings.inspectorOpen })}
        >
          <PanelRight size={17} />
        </button>
        <span className="sep" />
        <button className="icon-btn" title={t("tb.close")} onClick={() => void closeProject()}>
          <LogOut size={17} />
        </button>
      </div>

      <div className="panes">
        {!full && settings.binderOpen && (leftPanel === "search" ? <SearchPanel /> : <Binder />)}
        {main}
        {!full && settings.inspectorOpen && <Inspector />}
      </div>

      <StatusBar />
      {retiro && <RetiroBar />}
      {palette && <CommandPalette />}
      {dialog === "settings" && <SettingsDialog />}
      {dialog === "export" && <ExportDialog />}
      {dialog === "capture" && <Notebook />}
      {dialog === "sprint" && <SprintDialog />}
      {dialog === "import" && <ImportDialog onClose={() => useStore.setState({ dialog: null })} />}
      {timeMachine && <TimeMachine id={timeMachine} />}
      <Tour />
      <SyncDialogs />
    </div>
  );
}
