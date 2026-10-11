import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { DEFAULT_SETTINGS, useStore } from "../store";
import type { Settings } from "../types";
import { api, errorText } from "../lib/api";
import { useT } from "../lib/i18n";
import { markdownToHtml } from "../lib/markdown";
import { normalizeManifest } from "../lib/model";
import { locate } from "../lib/tree";
import { onManifest, onText, type PanelParams } from "../lib/panels";
import { EntryDetail } from "./CodexView";
import MapView from "./MapView";
import { ResearchViewer } from "./EditorPane";

/** Ventana aparte de solo lectura. Copia el proyecto en su propio estado y escucha los cambios. */
export default function PanelApp({ params }: { params: PanelParams }) {
  const t = useT();
  const project = useStore((s) => s.project);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const [saved, opened] = await Promise.all([api.settingsLoad().catch(() => null), api.projectOpen(params.path)]);
        const settings = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === "object" ? (saved as Partial<Settings>) : {}) };
        useStore.setState({ settings, settingsLoaded: true, words: opened.words, project: { path: opened.path, root: opened.root, manifest: normalizeManifest(opened.manifest) } });
        document.documentElement.dataset.theme = settings.theme;
        document.documentElement.lang = settings.lang;
      } catch (e) {
        setError(errorText(e));
      }
    })();
    const a = onManifest((m) => {
      const p = useStore.getState().project;
      if (p) useStore.setState({ project: { ...p, manifest: normalizeManifest(m) } });
    });
    const b = onText(() => setTick((n) => n + 1));
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, [params.path]);

  if (error) return <div className="editor-empty">{error}</div>;
  if (!project) return null;
  let body;
  if (params.kind === "codex") body = <div className="editor-area"><EntryDetail key={tick} id={params.id} compact /></div>;
  else if (params.kind === "map") body = <MapView />;
  else {
    const node = locate(project.manifest, params.id)?.node;
    if (!node) body = <div className="editor-empty">{t("panel.gone")}</div>;
    else if (params.kind === "research") body = <ResearchViewer node={node} />;
    else body = <ReadOnlyText key={tick} file={node.file!} title={node.title} />;
  }
  return (
    <div className="panel-window">
      <div className="panel-ro">
        <Eye size={13} /> {t("panel.readOnly")}
      </div>
      <div className="panel-body">{body}</div>
    </div>
  );
}

function ReadOnlyText({ file, title }: { file: string; title: string }) {
  const root = useStore((s) => s.project!.root);
  const [html, setHtml] = useState("");
  useEffect(() => void api.textRead(root, file).then((md) => setHtml(markdownToHtml(md)), () => setHtml("")), [root, file]);
  return (
    <div className="editor-area">
      <div className="sheet-wrap">
        <div className="sheet">
          <div className="scene-title">{title}</div>
          <div className="ProseMirror ro" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
