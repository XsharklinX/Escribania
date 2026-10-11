import { useEffect, useMemo, useRef, useState } from "react";
import { BookUser, Command, FileText, LayoutGrid } from "lucide-react";
import { useStore } from "../store";
import { useT, type TKey } from "../lib/i18n";
import { SECTIONS, walk } from "../lib/tree";
import { backupNow, flushAll } from "../lib/saver";
import { closeProject } from "../lib/projects";
import { createNode, importResearch, nodeIcon } from "./Binder";
import { setRetiro, VIEWS } from "./Workspace";
import { createEntry } from "./CodexView";

interface Item {
  id: string;
  label: string;
  hint?: string;
  group: "cmd" | "node" | "codex" | "board";
  icon?: React.ComponentType<{ size?: number }>;
  run: () => void;
}

export function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Todas las palabras de la consulta deben aparecer; puntúa mejor lo que empieza igual. */
export function score(label: string, query: string): number {
  const l = normalize(label);
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let s = 0;
  for (const w of words) {
    const i = l.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 ? 3 : l[i - 1] === " " ? 2 : 1;
  }
  return s + 1 / (1 + l.length / 40);
}

export default function CommandPalette() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => useStore.setState({ palette: false });

  const items = useMemo(() => {
    const st = () => useStore.getState();
    const cmd = (id: string, key: TKey, run: () => void, hint?: string): Item => ({ id, label: t(key), hint, group: "cmd", icon: Command, run });
    const out: Item[] = [
      cmd("new-text", "tree.newText", () => createNode("text"), "Ctrl+N"),
      cmd("new-folder", "tree.newFolder", () => createNode("folder"), "Ctrl+Shift+N"),
      cmd("search", "search.title", () => useStore.setState({ leftPanel: "search", view: "hoja" }), "Ctrl+Shift+F"),
      cmd("retiro", "tb.retiro", () => void setRetiro(true), "F11"),
      cmd("sprint", "sprint.title", () => useStore.setState({ dialog: "sprint" })),
      cmd("notebook", "nb.title", () => useStore.setState({ dialog: "capture" }), "Ctrl+Alt+I"),
      cmd("export", "tb.export", () => useStore.setState({ dialog: "export" }), "Ctrl+E"),
      cmd("settings", "tb.settings", () => useStore.setState({ dialog: "settings" }), "Ctrl+,"),
      cmd("binder", "tb.binder", () => st().setSettings({ binderOpen: !st().settings.binderOpen }), "Ctrl+1"),
      cmd("inspector", "tb.inspector", () => st().setSettings({ inspectorOpen: !st().settings.inspectorOpen }), "Ctrl+3"),
      cmd("import", "res.import", () => void importResearch()),
      cmd("bridges", "imp.title", () => useStore.setState({ dialog: "import" })),
      cmd("new-character", "kind.new.character", () => {
        createEntry("character");
        useStore.setState({ view: "codice" });
      }),
      cmd("new-place", "kind.new.place", () => {
        createEntry("place");
        useStore.setState({ view: "codice" });
      }),
      cmd("new-term", "kind.new.term", () => {
        createEntry("term");
        useStore.setState({ view: "codice" });
      }),
      cmd("save", "pal.save", () => void flushAll(), "Ctrl+S"),
      cmd("backup", "set.backupNow", () => void backupNow(true).then((p) => p && st().toast(t("set.backupDone")))),
      cmd("close", "tb.close", () => void closeProject()),
      ...VIEWS.map((v) => cmd("view-" + v.id, v.key, () => useStore.setState({ view: v.id }), t("pal.view"))),
    ];
    for (const sec of SECTIONS) {
      if (sec === "trash") continue;
      walk(m.sections[sec], (n) =>
        out.push({
          id: n.id,
          label: n.title,
          hint: t(`sec.${sec}`),
          group: "node",
          icon: nodeIcon(n),
          run: () => useStore.setState({ selected: n.id, view: n.type === "folder" ? "corcho" : "hoja" }),
        }),
      );
    }
    for (const e of m.codex)
      out.push({ id: "c" + e.id, label: e.name, hint: [t(`kind.${e.kind}`), ...e.aliases].join(" · "), group: "codex", icon: BookUser, run: () => useStore.setState({ view: "codice", codexSelected: e.id }) });
    for (const b of m.boards) out.push({ id: "b" + b.id, label: b.name, hint: t("view.mural"), group: "board", icon: LayoutGrid, run: () => useStore.setState({ view: "mural" }) });
    return out;
  }, [m, t]);

  const results = useMemo(() => {
    if (!q.trim()) return items.filter((i) => i.group === "cmd").slice(0, 12);
    return items
      .map((i) => ({ i, s: score(i.label + " " + (i.group === "codex" ? i.hint : ""), q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map((x) => x.i);
  }, [items, q]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.children[idx]?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const run = (it: Item | undefined) => {
    if (!it) return;
    close();
    it.run();
  };

  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label={t("pal.title")}>
        <input
          id="palette-input"
          className="palette-input"
          autoFocus
          placeholder={t("pal.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx(Math.min(results.length - 1, idx + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx(Math.max(0, idx - 1));
            } else if (e.key === "Enter") run(results[idx]);
          }}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <p className="muted pad">{t("pal.nothing")}</p>}
          {results.map((it, i) => {
            const Icon = it.icon ?? FileText;
            return (
              <button key={it.group + it.id} className={`palette-item ${i === idx ? "on" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
                <Icon size={15} />
                <span className="pl">{it.label}</span>
                {it.hint && <small className="muted">{it.hint}</small>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
