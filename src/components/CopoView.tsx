import { ChevronLeft, ChevronRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { CodexEntry, Snowflake } from "../types";
import { useT, type TKey } from "../lib/i18n";
import { api } from "../lib/api";
import { folder, text } from "../lib/templates";
import { newCodexEntry } from "../lib/model";
import { countWords } from "../lib/words";

const STEPS = 7;

/** Método Copo de nieve, paso a paso. Al final crea fichas y escenas en el proyecto. */
export default function CopoView() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const sf = m.snowflake;
  const set = (patch: Partial<Snowflake>) => edit((mm) => void Object.assign(mm.snowflake, patch));
  const step = Math.min(sf.step, STEPS - 1);

  const area = (key: "sentence" | "paragraph" | "page" | "synopsis", rows: number, target: [number, number]) => {
    const n = countWords(sf[key]);
    return (
      <>
        <textarea className="textarea copo-text" rows={rows} value={sf[key]} onChange={(e) => set({ [key]: e.target.value })} />
        <span className={`kit-count ${!n ? "" : n < target[0] ? "short" : n > target[1] ? "long" : "ok"}`}>
          {n} / {target[0]}–{target[1]} {t("ed.words")}
        </span>
      </>
    );
  };

  const build = async () => {
    const st = useStore.getState();
    const p = st.project!;
    const entries: CodexEntry[] = [];
    for (const c of sf.characters.filter((c) => c.name.trim())) {
      if (p.manifest.codex.some((e) => e.name.toLowerCase() === c.name.trim().toLowerCase())) continue;
      const e = newCodexEntry("character", c.name.trim(), st.settings.lang, [...p.manifest.codex, ...entries]);
      const extra = [
        [t("copo.motivation"), c.motivation],
        [t("copo.goal"), c.goal],
        [t("copo.conflict"), c.conflict],
        [t("copo.epiphany"), c.epiphany],
      ].filter(([, v]) => v.trim());
      e.fields = [...e.fields.filter((f) => !extra.some(([k]) => k === f.k)), ...extra.map(([k, v]) => ({ k, v }))];
      await api.textWrite(p.root, e.file, e.id, e.name, c.storyline);
      entries.push(e);
    }
    const all = [...p.manifest.codex, ...entries];
    const scenes = sf.scenes.filter((s) => s.title.trim() || s.synopsis.trim());
    const texts = scenes.map((s, i) => {
      const n = text(s.title.trim() || `${t("tpl.scene").replace(/\d+$/, "")}${i + 1}`);
      n.synopsis = s.synopsis;
      n.pov = all.find((e) => e.name.toLowerCase() === s.pov.trim().toLowerCase())?.id;
      return n;
    });
    for (const n of texts) await api.textWrite(p.root, n.file!, n.id, n.title, "");
    const summary = text(t("copo.summaryTitle"));
    summary.include = false;
    const body = [sf.sentence, sf.paragraph, sf.page, sf.synopsis].filter((x) => x.trim()).join("\n\n* * *\n\n");
    await api.textWrite(p.root, summary.file!, summary.id, summary.title, body);
    st.editManifest((mm) => {
      mm.codex.push(...entries);
      if (texts.length) mm.sections.manuscript.push(folder(t("copo.folder"), texts));
      mm.sections.notes.unshift(summary);
    });
    st.toast(t("copo.created", { c: entries.length, s: texts.length }));
  };

  const titles: TKey[] = ["copo.s1", "copo.s2", "copo.s3", "copo.s4", "copo.s5", "copo.s6", "copo.s7"];
  return (
    <div className="view copo-view">
      <div className="view-head">
        <h2>{t("view.copo")}</h2>
        <div className="stepper">
          {titles.map((k, i) => (
            <button key={k} className={i === step ? "on" : i < step ? "done" : ""} onClick={() => set({ step: i })}>
              <b>{i + 1}</b> <span>{t(k)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="copo-body">
        <h3>
          {step + 1}. {t(titles[step])}
        </h3>
        <p className="muted copo-help">{t(`copo.h${step + 1}` as TKey)}</p>
        {step === 0 && area("sentence", 3, [10, 30])}
        {step === 1 && area("paragraph", 8, [80, 200])}
        {step === 2 && (
          <div className="copo-chars">
            {sf.characters.map((c, i) => (
              <div key={i} className="copo-char">
                <div className="copo-char-head">
                  <input className="input entry-name" style={{ fontSize: 18 }} placeholder={t("codex.name")} value={c.name} onChange={(e) => set({ characters: sf.characters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <button className="icon-btn danger" onClick={() => set({ characters: sf.characters.filter((_, j) => j !== i) })}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {(["motivation", "goal", "conflict", "epiphany", "storyline"] as const).map((k) => (
                  <label key={k} className="field">
                    <span>{t(`copo.${k}` as TKey)}</span>
                    <textarea className="textarea" rows={k === "storyline" ? 3 : 1} value={c[k]} onChange={(e) => set({ characters: sf.characters.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                  </label>
                ))}
              </div>
            ))}
            <button className="btn" onClick={() => set({ characters: [...sf.characters, { name: "", storyline: "", motivation: "", goal: "", conflict: "", epiphany: "" }] })}>
              <Plus size={14} /> {t("copo.addCharacter")}
            </button>
          </div>
        )}
        {step === 3 && area("page", 16, [300, 700])}
        {step === 4 && area("synopsis", 22, [1000, 3000])}
        {step === 5 && (
          <div className="copo-scenes">
            {sf.scenes.map((s, i) => (
              <div key={i} className="copo-scene">
                <span className="num">{i + 1}</span>
                <input className="input" placeholder={t("insp.title")} value={s.title} onChange={(e) => set({ scenes: sf.scenes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <input className="input" placeholder={t("insp.pov")} list="copo-povs" value={s.pov} onChange={(e) => set({ scenes: sf.scenes.map((x, j) => (j === i ? { ...x, pov: e.target.value } : x)) })} />
                <input className="input" placeholder={t("insp.synopsis")} value={s.synopsis} onChange={(e) => set({ scenes: sf.scenes.map((x, j) => (j === i ? { ...x, synopsis: e.target.value } : x)) })} />
                <button className="icon-btn danger" onClick={() => set({ scenes: sf.scenes.filter((_, j) => j !== i) })}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <datalist id="copo-povs">
              {[...sf.characters.map((c) => c.name), ...m.codex.filter((e) => e.kind === "character").map((e) => e.name)].filter(Boolean).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <div className="press-actions">
              <button className="btn" onClick={() => set({ scenes: [...sf.scenes, { title: "", pov: "", synopsis: "" }] })}>
                <Plus size={14} /> {t("copo.addScene")}
              </button>
              {sf.scenes.length === 0 && sf.synopsis.trim() && (
                <button
                  className="btn"
                  onClick={() => set({ scenes: sf.synopsis.split(/\n\n+/).filter((x) => x.trim()).map((x) => ({ title: "", pov: "", synopsis: x.trim().slice(0, 280) })) })}
                >
                  {t("copo.fromSynopsis")}
                </button>
              )}
            </div>
          </div>
        )}
        {step === 6 && (
          <div className="copo-final">
            <p>{t("copo.summary", { c: sf.characters.filter((c) => c.name.trim()).length, s: sf.scenes.length })}</p>
            <button className="btn primary big" onClick={() => void build()}>
              <Sparkles size={16} /> {t("copo.build")}
            </button>
          </div>
        )}
        <div className="copo-nav">
          <button className="btn" disabled={step === 0} onClick={() => set({ step: step - 1 })}>
            <ChevronLeft size={15} /> {t("copo.prev")}
          </button>
          <button className="btn primary" disabled={step === STEPS - 1} onClick={() => set({ step: step + 1 })}>
            {t("copo.next")} <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
