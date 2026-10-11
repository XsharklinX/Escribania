import { useEffect, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { newId } from "../lib/ids";
import { text } from "../lib/templates";
import Modal from "./Modal";

/** Cuaderno de ideas: notas sueltas de la app, fuera de cualquier proyecto. */
export interface Idea {
  id: string;
  text: string;
  created: string;
  sentTo?: string;
}

const FILE = "cuaderno.json";

export async function loadIdeas(): Promise<Idea[]> {
  try {
    const raw = (await api.appJsonRead(FILE)) as { ideas?: Idea[] } | null;
    return raw?.ideas ?? [];
  } catch {
    return [];
  }
}

async function saveIdeas(ideas: Idea[]) {
  await api.appJsonWrite(FILE, { ideas }).catch(() => {});
}

export default function Notebook() {
  const t = useT();
  const project = useStore((s) => s.project);
  const lang = useStore((s) => s.settings.lang);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const close = () => useStore.setState({ dialog: null });

  useEffect(() => void loadIdeas().then(setIdeas), []);

  const update = (next: Idea[]) => {
    setIdeas(next);
    void saveIdeas(next);
  };

  const add = () => {
    if (!draft.trim() || !ideas) return;
    update([{ id: newId(), text: draft.trim(), created: new Date().toISOString() }, ...ideas]);
    setDraft("");
  };

  const send = (idea: Idea) => {
    const st = useStore.getState();
    if (!st.project) return;
    const title = idea.text.split(/\s+/).slice(0, 6).join(" ").replace(/[.,;:]+$/, "") + (idea.text.split(/\s+/).length > 6 ? "…" : "");
    const node = text(title);
    node.include = false;
    st.editManifest((m) => void m.sections.notes.unshift(node));
    void api.textWrite(st.project.root, node.file!, node.id, node.title, idea.text + "\n");
    update(ideas!.map((i) => (i.id === idea.id ? { ...i, sentTo: st.project!.manifest.title } : i)));
    st.toast(t("nb.sent"));
  };

  const fmt = new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const shown = (ideas ?? []).filter((i) => !filter || i.text.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Modal title={t("nb.title")} onClose={close} wide>
      <div className="body">
        <textarea
          id="nb-draft"
          className="textarea nb-draft"
          autoFocus
          rows={3}
          value={draft}
          placeholder={t("nb.placeholder")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              add();
            }
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="muted">{t("nb.hint")}</span>
          <span className="spacer" />
          <button className="btn primary" disabled={!draft.trim()} onClick={add}>
            {t("nb.save")}
          </button>
        </div>
        {(ideas?.length ?? 0) > 4 && <input className="input" placeholder={t("nb.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />}
        <div className="ideas">
          {ideas && ideas.length === 0 && <p className="muted">{t("nb.empty")}</p>}
          {shown.map((i) => (
            <div key={i.id} className="idea">
              <p>{i.text}</p>
              <div className="idea-foot">
                <small className="muted">
                  {fmt.format(new Date(i.created))}
                  {i.sentTo && ` · ${t("nb.sentTo", { p: i.sentTo })}`}
                </small>
                <span className="spacer" />
                {project && (
                  <button className="btn" onClick={() => send(i)} title={t("nb.sendHint")}>
                    <Send size={13} /> {t("nb.send")}
                  </button>
                )}
                <button className="icon-btn" onClick={() => update(ideas!.filter((x) => x.id !== i.id))} title={t("cm.delete")}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
