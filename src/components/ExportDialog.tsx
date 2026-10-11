import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { chapterPage, indexPage, webChapters } from "../lib/web";
import { betaHtml } from "../lib/beta";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore } from "../store";
import type { CompileOptions } from "../types";
import { useT } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { flushAll } from "../lib/saver";
import { collectPieces, toDocx, toHtml, toMarkdown, toPlainText } from "../lib/compile";
import { bookWords } from "../lib/tree";
import { formatNumber } from "../lib/words";
import { slugify } from "../lib/ids";
import Modal from "./Modal";
import { reviewDocx } from "../lib/docxExtra";
import { walk } from "../lib/tree";
import type { Comment } from "../types";

type Format = "docx" | "review" | "md" | "html" | "txt" | "web" | "beta";
const FORMATS: Format[] = ["docx", "review", "md", "html", "txt", "web", "beta"];

export default function ExportDialog() {
  const t = useT();
  const project = useStore((s) => s.project)!;
  const words = useStore((s) => s.words);
  const lang = useStore((s) => s.settings.lang);
  const edit = useStore((s) => s.editManifest);
  const toast = useStore((s) => s.toast);
  const m = project.manifest;
  const opts = m.compile;
  const [format, setFormat] = useState<Format>("docx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [webExt, setWebExt] = useState<"html" | "md">("html");
  const close = () => useStore.setState({ dialog: null });
  const setOpt = (patch: Partial<CompileOptions>) => edit((mm) => void Object.assign(mm.compile, patch));

  useEffect(() => {
    void collectPieces(m, opts, async () => "").then((r) => setCount(r.texts));
  }, [m, opts]);

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await flushAll();
      const { pieces, texts } = await collectPieces(m, opts, (f) => api.textRead(project.root, f), t("exp.glossaryTitle"), format === "review");
      if (!texts) {
        setError(t("exp.empty"));
        return;
      }
      if (format === "web") {
        const dir = await open({ directory: true, multiple: false, title: t("exp.webDir") });
        if (typeof dir !== "string") return;
        const sep = dir.includes("\\") ? "\\" : "/";
        const chapters = webChapters(m, pieces, opts.separator);
        for (let i = 0; i < chapters.length; i++) {
          const c = chapters[i];
          const text = webExt === "md" ? c.md : chapterPage(m, c, lang, { prev: chapters[i - 1], next: chapters[i + 1], index: t("exp.webIndex") });
          await api.fileWriteText(`${dir}${sep}${c.file}.${webExt}`, text);
        }
        await api.fileWriteText(`${dir}${sep}index.${webExt}`, indexPage(m, chapters, lang, webExt));
        toast(t("exp.webDone", { n: chapters.length }));
        void revealItemInDir(`${dir}${sep}index.${webExt}`).catch(() => {});
        close();
        return;
      }
      if (format === "beta") {
        const path = await save({ defaultPath: `${slugify(m.title) || "libro"}-lectores.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
        if (!path) return;
        const keys = ["intro", "name", "namePh", "comment", "save", "cancel", "download", "notes", "empty", "remove", "placeholder", "saved"] as const;
        const labels = Object.fromEntries(keys.map((k) => [k, t(`beta.${k}`)])) as Record<(typeof keys)[number], string>;
        await api.fileWriteText(path, betaHtml(m, pieces, lang, labels));
        toast(`${t("exp.done")}: ${path}`);
        void revealItemInDir(path).catch(() => {});
        close();
        return;
      }
      const path = await save({
        defaultPath: `${slugify(m.title) || "libro"}${format === "review" ? "-revision" : ""}.${format === "review" ? "docx" : format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format === "review" ? "docx" : format] }],
      });
      if (!path) return;
      if (format === "docx") await api.fileWriteBytes(path, await toDocx(m, opts, pieces));
      else if (format === "review") {
        const comments: Record<string, Comment[]> = {};
        walk(m.sections.manuscript, (n) => {
          if (n.comments?.length) comments[n.id] = n.comments;
        });
        await api.fileWriteBytes(path, await reviewDocx(m, pieces, comments));
      }
      else if (format === "md") await api.fileWriteText(path, toMarkdown(m, opts, pieces));
      else if (format === "html") await api.fileWriteText(path, toHtml(m, opts, pieces));
      else await api.fileWriteText(path, toPlainText(m, opts, pieces));
      toast(`${t("exp.done")}: ${path}`);
      void revealItemInDir(path).catch(() => {});
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("exp.title")}
      onClose={close}
      footer={
        <>
          <span className="muted" style={{ marginRight: "auto", alignSelf: "center" }}>
            {count !== null && t("exp.summary", { n: count, w: formatNumber(bookWords(m, words), lang) })}
          </span>
          <button className="btn" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {t("exp.go")}
          </button>
        </>
      }
    >
      <div className="body">
        <div className="field">
          <span>{t("exp.format")}</span>
          <div className="choice-grid">
            {FORMATS.map((f) => (
              <button key={f} className={`choice ${format === f ? "on" : ""}`} onClick={() => setFormat(f)}>
                <b>{t(`exp.${f}`)}</b>
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input id="exp-title" type="checkbox" checked={opts.titlePage} onChange={(e) => setOpt({ titlePage: e.target.checked })} />
          {t("exp.titlePage")}
        </label>
        <label className="check">
          <input id="exp-folders" type="checkbox" checked={opts.folderTitles} onChange={(e) => setOpt({ folderTitles: e.target.checked })} />
          {t("exp.folderTitles")}
        </label>
        <label className="check">
          <input id="exp-texts" type="checkbox" checked={opts.textTitles} onChange={(e) => setOpt({ textTitles: e.target.checked })} />
          {t("exp.textTitles")}
        </label>
        {m.codex.some((e) => e.kind === "term") && (
          <label className="check">
            <input id="exp-glossary" type="checkbox" checked={opts.glossary} onChange={(e) => setOpt({ glossary: e.target.checked })} />
            {t("exp.glossary")}
          </label>
        )}
        <label className="field">
          <span>{t("exp.separator")}</span>
          <input id="exp-sep" className="input" value={opts.separator} onChange={(e) => setOpt({ separator: e.target.value })} style={{ maxWidth: 200 }} />
        </label>
        {format === "web" && (
          <div className="field">
            <span>{t("exp.webFormat")}</span>
            <div className="seg">
              <button className={webExt === "html" ? "on" : ""} onClick={() => setWebExt("html")}>
                HTML
              </button>
              <button className={webExt === "md" ? "on" : ""} onClick={() => setWebExt("md")}>
                Markdown
              </button>
            </div>
            <small className="muted">{t("exp.webHint")}</small>
          </div>
        )}
        {format === "beta" && <p className="muted">{t("exp.betaHint")}</p>}
        {format === "docx" && (
          <>
            <label className="check">
              <input id="exp-break" type="checkbox" checked={opts.chapterPageBreak} onChange={(e) => setOpt({ chapterPageBreak: e.target.checked })} />
              {t("exp.pageBreak")}
            </label>
            <label className="check">
              <input id="exp-ms" type="checkbox" checked={opts.manuscriptFormat} onChange={(e) => setOpt({ manuscriptFormat: e.target.checked })} />
              {t("exp.manuscript")}
            </label>
            {!opts.manuscriptFormat && (
              <label className="field">
                <span>{t("exp.font")}</span>
                <select id="exp-font" className="select" value={opts.font} onChange={(e) => setOpt({ font: e.target.value })} style={{ maxWidth: 260 }}>
                  {["Times New Roman", "Garamond", "Georgia", "Book Antiqua", "Cambria", "Courier New"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}
