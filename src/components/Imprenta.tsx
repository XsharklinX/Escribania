import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { BookOpen, Download, FileText, ImagePlus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { Kit, Manifest, PublishOptions, Submission } from "../types";
import { tNow, useT, type TKey } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { collectPieces, type Piece } from "../lib/compile";
import { flushAll } from "../lib/saver";
import { bookTypst, coverTypst, manuscriptTypst, proofTypst, screenplayTypst } from "../lib/typst";
import { walk } from "../lib/tree";
import { epubChapters, epubCss } from "../lib/epub";
import { kitDocx, manuscriptDocx } from "../lib/docxExtra";
import { markdownToPlain } from "../lib/markdown";
import { spineWidth, TRIMS } from "../lib/model";
import { importFiles, IMAGE_EXT, useAsset } from "../lib/assets";
import { slugify, newId } from "../lib/ids";
import Spreads from "./Spreads";
import PressStyles from "./PressStyles";
import { countWords, formatNumber } from "../lib/words";

type Tab = "book" | "manuscript" | "cover" | "kit" | "subs";

async function pieces(keepReview = false): Promise<Piece[]> {
  const p = useStore.getState().project!;
  await flushAll();
  return (await collectPieces(p.manifest, p.manifest.compile, (f) => api.textRead(p.root, f), tNow("exp.glossaryTitle"), keepReview)).pieces;
}

function labels() {
  return { toc: tNow("pub.tocTitle"), rights: tNow("pub.rightsDefault"), acknowledgments: tNow("pub.acknowledgments"), about: tNow("pub.about") };
}

async function saveAs(name: string, ext: string): Promise<string | null> {
  return save({ defaultPath: `${slugify(name) || "libro"}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
}

function done(path: string) {
  useStore.getState().toast(`${tNow("exp.done")}: ${path}`);
  void revealItemInDir(path).catch(() => {});
}

/** Vista previa en PDF del último documento compuesto. */
function usePreview() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const load = async () => {
    const bytes = await api.typesetLast();
    setUrl(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
  };
  return { url, load };
}

export default function Imprenta() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("book");
  const tabs: [Tab, TKey][] = [
    ["book", "pub.tab.book"],
    ["manuscript", "pub.tab.manuscript"],
    ["cover", "pub.tab.cover"],
    ["kit", "pub.tab.kit"],
    ["subs", "pub.tab.subs"],
  ];
  return (
    <div className="view press-view">
      <div className="view-head">
        <h2>{t("view.imprenta")}</h2>
        <div className="seg">
          {tabs.map(([id, k]) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {t(k)}
            </button>
          ))}
        </div>
      </div>
      {tab === "book" && <BookTab />}
      {tab === "manuscript" && <ManuscriptTab />}
      {tab === "cover" && <CoverTab />}
      {tab === "kit" && <KitTab />}
      {tab === "subs" && <SubmissionsTab />}
    </div>
  );
}

function useFonts() {
  const root = useStore((s) => s.project!.root);
  const [fonts, setFonts] = useState<string[]>(["Libertinus Serif"]);
  useEffect(() => void api.typesetFonts(root).then(setFonts, () => {}), [root]);
  return fonts;
}

function Preview({ url, busy, pages, error, onCompose }: { url: string | null; busy: boolean; pages: number | null; error: string; onCompose: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"spreads" | "pdf">("spreads");
  return (
    <div className="press-preview">
      <div className="press-bar">
        <button className="btn primary" disabled={busy} onClick={onCompose}>
          <RefreshCw size={15} className={busy ? "spin" : ""} /> {busy ? t("pub.composing") : t("pub.preview")}
        </button>
        {pages !== null && <span className="muted">{t("pub.pages", { n: pages })}</span>}
        <span className="spacer" />
        <div className="seg small">
          <button className={mode === "spreads" ? "on" : ""} onClick={() => setMode("spreads")}>
            {t("sp.spreads")}
          </button>
          <button className={mode === "pdf" ? "on" : ""} onClick={() => setMode("pdf")}>
            PDF
          </button>
        </div>
      </div>
      {error && <p className="error-text pad">{error}</p>}
      {url ? mode === "pdf" || !pages ? <iframe title="PDF" src={url} /> : <Spreads pages={pages} version={url} /> : <div className="editor-empty">{t("pub.previewHint")}</div>}
    </div>
  );
}

function BookTab() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const root = useStore((s) => s.project!.root);
  const lang = useStore((s) => s.settings.lang);
  const edit = useStore((s) => s.editManifest);
  const fonts = useFonts();
  const { url, load } = usePreview();
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState("");
  const p = m.publish;
  const set = (patch: Partial<PublishOptions>) => edit((mm) => void Object.assign(mm.publish, patch));
  const cover = useAsset(p.cover || null);

  const compose = async (out: string | null) => {
    setBusy(true);
    setError("");
    try {
      const doc = bookTypst(useStore.getState().project!.manifest, await pieces(), lang, labels());
      const info = await api.typeset(root, doc.source, doc.files, out);
      setPages(info.pages);
      edit((mm) => void (mm.cover.pages = info.pages));
      if (out) done(out);
      else await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const exportEpub = async () => {
    const path = await saveAs(m.title, "epub");
    if (!path) return;
    try {
      const mm = useStore.getState().project!.manifest;
      const book = {
        id: mm.id,
        title: mm.title,
        author: mm.author,
        lang,
        publisher: mm.publish.publisher,
        description: mm.publish.description,
        isbn: mm.publish.isbn,
        css: epubCss(mm),
        chapters: epubChapters(mm, await pieces(), labels()),
        cover: mm.publish.cover || null,
        toc_title: t("pub.tocTitle"),
      };
      await api.epubBuild(root, book, path);
      done(path);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="press-split">
      <div className="press-form">
        <section>
          <h3>{t("pub.format")}</h3>
          <div className="grid2">
            <label className="field">
              <span>{t("pub.trim")}</span>
              <select className="select" value={p.trim} onChange={(e) => set({ trim: e.target.value })}>
                {TRIMS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("pub.font")}</span>
              <select className="select" value={p.font} onChange={(e) => set({ font: e.target.value })}>
                {[...new Set([p.font, ...fonts])].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("set.fontSize")}</span>
              <input className="input" type="number" min={8} max={16} step={0.5} value={p.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) || 11 })} />
            </label>
            <label className="field">
              <span>{t("set.lineHeight")}</span>
              <input className="input" type="number" min={1.1} max={2} step={0.05} value={p.leading} onChange={(e) => set({ leading: Number(e.target.value) || 1.35 })} />
            </label>
          </div>
          <div className="choice-grid">
            {(["classic", "modern", "romantic"] as const).map((s) => (
              <button key={s} className={`choice ${p.style === s ? "on" : ""}`} onClick={() => set({ style: s })}>
                <b>{t(`pub.style.${s}`)}</b>
                <small>{t(`pub.style.${s}.d`)}</small>
              </button>
            ))}
          </div>
          {(
            [
              ["dropCaps", "pub.dropCaps"],
              ["smallCaps", "pub.smallCaps"],
              ["headers", "pub.headers"],
              ["recto", "pub.recto"],
              ["toc", "pub.toc"],
              ["halfTitle", "pub.halfTitle"],
            ] as unknown as [keyof PublishOptions, TKey][]
          ).map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={Boolean(p[k])} onChange={(e) => set({ [k]: e.target.checked } as Partial<PublishOptions>)} />
              {t(label)}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={m.compile.folderTitles} onChange={(e) => edit((mm) => void (mm.compile.folderTitles = e.target.checked))} />
            {t("exp.folderTitles")}
          </label>
          <label className="check">
            <input type="checkbox" checked={m.compile.textTitles} onChange={(e) => edit((mm) => void (mm.compile.textTitles = e.target.checked))} />
            {t("exp.textTitles")}
          </label>
          <label className="field">
            <span>{t("exp.separator")}</span>
            <input className="input" style={{ maxWidth: 200 }} value={m.compile.separator} onChange={(e) => edit((mm) => void (mm.compile.separator = e.target.value))} />
          </label>
        </section>

        <PressStyles />

        <section>
          <h3>{t("pub.front")}</h3>
          <div className="grid2">
            <label className="field">
              <span>{t("pub.publisher")}</span>
              <input className="input" value={p.publisher} onChange={(e) => set({ publisher: e.target.value })} />
            </label>
            <label className="field">
              <span>ISBN</span>
              <input className="input" value={p.isbn} onChange={(e) => set({ isbn: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>{t("pub.copyright")}</span>
            <textarea className="textarea" rows={2} value={p.copyright} placeholder={t("pub.rightsDefault")} onChange={(e) => set({ copyright: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("pub.dedication")}</span>
            <textarea className="textarea" rows={2} value={p.dedication} onChange={(e) => set({ dedication: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("pub.epigraph")}</span>
            <textarea className="textarea" rows={2} value={p.epigraph} onChange={(e) => set({ epigraph: e.target.value })} />
          </label>
          <input className="input" placeholder={t("pub.epigraphSource")} value={p.epigraphSource} onChange={(e) => set({ epigraphSource: e.target.value })} />
        </section>

        <section>
          <h3>{t("pub.back")}</h3>
          <label className="field">
            <span>{t("pub.acknowledgments")}</span>
            <textarea className="textarea" rows={3} value={p.acknowledgments} onChange={(e) => set({ acknowledgments: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("pub.about")}</span>
            <textarea className="textarea" rows={3} value={p.aboutAuthor} onChange={(e) => set({ aboutAuthor: e.target.value })} />
          </label>
        </section>

        <section>
          <h3>EPUB</h3>
          <label className="field">
            <span>{t("pub.description")}</span>
            <textarea className="textarea" rows={3} value={p.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <div className="cover-pick">
            {cover ? <img src={cover} alt="" /> : <span className="muted">{t("pub.noCover")}</span>}
            <button
              className="btn"
              onClick={async () => {
                const [img] = await importFiles("recursos", ["jpg", "jpeg", "png"], false);
                if (img) set({ cover: img.rel });
              }}
            >
              <ImagePlus size={14} /> {t("pub.coverImage")}
            </button>
          </div>
        </section>

        <div className="press-actions">
          <button className="btn primary" disabled={busy} onClick={async () => {
            const path = await saveAs(m.title, "pdf");
            if (path) await compose(path);
          }}>
            <Download size={15} /> {t("pub.exportPdf")}
          </button>
          <button className="btn" onClick={() => void exportEpub()}>
            <BookOpen size={15} /> {t("pub.exportEpub")}
          </button>
        </div>
      </div>
      <Preview url={url} busy={busy} pages={pages} error={error} onCompose={() => void compose(null)} />
    </div>
  );
}

function ManuscriptTab() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const root = useStore((s) => s.project!.root);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const fonts = useFonts();
  const { url, load } = usePreview();
  const [paper, setPaper] = useState<"a4" | "us-letter">(settings.lang === "es" ? "a4" : "us-letter");
  const [font, setFont] = useState("Courier New");
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState("");
  const c = settings.contact;
  const setC = (patch: Partial<typeof c>) => setSettings({ contact: { ...c, ...patch } });
  const hasScript = JSON.stringify(m.sections.manuscript).includes('"screenplay":true');
  const l = { by: t("ms.by"), words: t("ms.words"), end: t("ms.end") };

  const run = async (kind: "ms" | "script" | "proof", out: string | null) => {
    setBusy(true);
    setError("");
    try {
      const ps = await pieces();
      const titles: Record<string, string> = {};
      walk(m.sections.manuscript, (n) => void (titles[n.id] = n.title));
      const source =
        kind === "ms"
          ? manuscriptTypst(m, ps, settings, { paper, font }, settings.lang, l.end, l.by, l.words)
          : kind === "proof"
            ? proofTypst(m, ps, titles, settings.lang, { scene: t("proof.scene"), page: t("proof.page"), notes: t("proof.notes") })
            : screenplayTypst(m, scriptParagraphs(ps), l.by);
      const info = await api.typeset(root, source, {}, out);
      setPages(info.pages);
      if (out) done(out);
      else await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="press-split">
      <div className="press-form">
        <section>
          <h3>{t("ms.contact")}</h3>
          <p className="muted">{t("ms.contactHint")}</p>
          <label className="field">
            <span>{t("ms.legalName")}</span>
            <input className="input" value={c.legalName} placeholder={m.author} onChange={(e) => setC({ legalName: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("ms.address")}</span>
            <textarea className="textarea" rows={2} value={c.address} onChange={(e) => setC({ address: e.target.value })} />
          </label>
          <div className="grid2">
            <label className="field">
              <span>{t("ms.email")}</span>
              <input className="input" value={c.email} onChange={(e) => setC({ email: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("ms.phone")}</span>
              <input className="input" value={c.phone} onChange={(e) => setC({ phone: e.target.value })} />
            </label>
          </div>
        </section>
        <section>
          <h3>{t("ms.format")}</h3>
          <div className="grid2">
            <label className="field">
              <span>{t("ms.paper")}</span>
              <select className="select" value={paper} onChange={(e) => setPaper(e.target.value as typeof paper)}>
                <option value="a4">A4</option>
                <option value="us-letter">US Letter</option>
              </select>
            </label>
            <label className="field">
              <span>{t("pub.font")}</span>
              <select className="select" value={font} onChange={(e) => setFont(e.target.value)}>
                {[...new Set(["Courier New", "Times New Roman", ...fonts])].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">{t("ms.hint")}</p>
        </section>
        <div className="press-actions">
          <button className="btn primary" disabled={busy} onClick={async () => {
            const path = await saveAs(m.title + " manuscrito", "pdf");
            if (path) await run("ms", path);
          }}>
            <Download size={15} /> PDF
          </button>
          <button
            className="btn"
            onClick={async () => {
              const path = await saveAs(m.title + " manuscrito", "docx");
              if (!path) return;
              try {
                await api.fileWriteBytes(path, await manuscriptDocx(m, await pieces(), settings, l, settings.lang));
                done(path);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            <FileText size={15} /> Word (.docx)
          </button>
        </div>
        <section>
          <h3>{t("proof.title")}</h3>
          <p className="muted">{t("proof.hint")}</p>
          <div className="press-actions">
            <button className="btn" disabled={busy} onClick={() => void run("proof", null)}>
              {t("pub.preview")}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const path = await saveAs(m.title + " " + t("proof.file"), "pdf");
                if (path) await run("proof", path);
              }}
            >
              <Download size={15} /> PDF
            </button>
          </div>
        </section>
        {hasScript && (
          <section>
            <h3>{t("ms.script")}</h3>
            <p className="muted">{t("ms.scriptHint")}</p>
            <div className="press-actions">
              <button className="btn" onClick={() => void run("script", null)}>
                {t("pub.preview")}
              </button>
              <button className="btn" onClick={async () => {
                const path = await saveAs(m.title + " guion", "pdf");
                if (path) await run("script", path);
              }}>
                <Download size={15} /> PDF
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const path = await saveAs(m.title, "fountain");
                  if (!path) return;
                  const { toFountain } = await import("../lib/screenplay");
                  await api.fileWriteText(path, toFountain(m.title, m.author, scriptParagraphs(await pieces())));
                  done(path);
                }}
              >
                Fountain
              </button>
            </div>
          </section>
        )}
      </div>
      <Preview url={url} busy={busy} pages={pages} error={error} onCompose={() => void run("ms", null)} />
    </div>
  );
}

/** Párrafos de los textos en modo guion, en texto plano. */
export function scriptParagraphs(ps: Piece[]): string[] {
  const out: string[] = [];
  for (const x of ps) {
    if (x.kind !== "text" || !x.screenplay) continue;
    for (const para of x.md.split(/\n\n+/)) out.push(markdownToPlain(para));
  }
  return out;
}

function CoverTab() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const root = useStore((s) => s.project!.root);
  const edit = useStore((s) => s.editManifest);
  const c = m.cover;
  const set = (patch: Partial<Manifest["cover"]>) => edit((mm) => void Object.assign(mm.cover, patch));
  const front = useAsset(c.front || null);
  const back = useAsset(c.back || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const trim = TRIMS.find((x) => x.id === m.publish.trim) ?? TRIMS[3];
  const spine = spineWidth(c.pages, c.paper);
  const W = trim.w * 2 + spine + 0.25;
  const H = trim.h + 0.25;
  const scale = 560 / W;

  const pick = async (key: "front" | "back") => {
    const [img] = await importFiles("recursos", IMAGE_EXT.filter((e) => e !== "svg"), false);
    if (img) set({ [key]: img.rel });
  };

  const exportPdf = async () => {
    const path = await saveAs(m.title + " cubierta", "pdf");
    if (!path) return;
    setBusy(true);
    setError("");
    try {
      const files: Record<string, string> = {};
      if (c.front) files.front = c.front;
      if (c.back) files.back = c.back;
      const doc = coverTypst(m, { front: c.front || undefined, back: c.back || undefined });
      await api.typeset(root, doc.source, files, path);
      done(path);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const inch = (v: number) => `${(v * 2.54).toFixed(2)} cm`;
  return (
    <div className="press-split">
      <div className="press-form">
        <section>
          <h3>{t("cover.calc")}</h3>
          <div className="grid2">
            <label className="field">
              <span>{t("cover.pages")}</span>
              <input className="input" type="number" min={0} value={c.pages || ""} onChange={(e) => set({ pages: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
            <label className="field">
              <span>{t("cover.paper")}</span>
              <select className="select" value={c.paper} onChange={(e) => set({ paper: e.target.value as Manifest["cover"]["paper"] })}>
                <option value="cream">{t("cover.cream")}</option>
                <option value="white">{t("cover.white")}</option>
                <option value="color">{t("cover.color")}</option>
              </select>
            </label>
          </div>
          <div className="spine-info">
            <div>
              <span className="k">{t("cover.spine")}</span>
              <b>{inch(spine)}</b>
            </div>
            <div>
              <span className="k">{t("cover.full")}</span>
              <b>
                {inch(W)} × {inch(H)}
              </b>
            </div>
            <div>
              <span className="k">{t("pub.trim")}</span>
              <b>{trim.label}</b>
            </div>
          </div>
          <p className="muted">{t("cover.pagesHint")}</p>
        </section>
        <section>
          <h3>{t("cover.design")}</h3>
          <div className="grid2">
            <label className="field">
              <span>{t("cover.bg")}</span>
              <input type="color" className="color" value={c.bg} onChange={(e) => set({ bg: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("cover.fg")}</span>
              <input type="color" className="color" value={c.fg} onChange={(e) => set({ fg: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>{t("cover.titleSize")}</span>
            <input type="range" min={24} max={80} value={c.titleSize} onChange={(e) => set({ titleSize: Number(e.target.value) })} />
          </label>
          <div className="press-actions">
            <button className="btn" onClick={() => void pick("front")}>
              <ImagePlus size={14} /> {t("cover.front")}
            </button>
            <button className="btn" onClick={() => void pick("back")}>
              <ImagePlus size={14} /> {t("cover.back")}
            </button>
            {(c.front || c.back) && (
              <button className="btn" onClick={() => set({ front: "", back: "" })}>
                <X size={14} /> {t("cover.clearImages")}
              </button>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={c.showSpine} onChange={(e) => set({ showSpine: e.target.checked })} />
            {t("cover.spineText")}
          </label>
          <label className="field">
            <span>{t("cover.blurb")}</span>
            <textarea className="textarea" rows={6} value={c.blurb} placeholder={m.publish.description} onChange={(e) => set({ blurb: e.target.value })} />
          </label>
        </section>
        <div className="press-actions">
          <button className="btn primary" disabled={busy} onClick={() => void exportPdf()}>
            <Download size={15} /> {t("cover.export")}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="press-preview cover-stage">
        <div className="cover-wrap" style={{ width: W * scale, height: H * scale, background: c.bg, color: c.fg }}>
          <div className="cv-back" style={{ width: (trim.w + 0.125) * scale }}>
            {back && <img src={back} alt="" />}
            <p style={{ padding: `${0.9 * scale}px ${0.6 * scale}px` }}>{c.blurb || m.publish.description}</p>
            <span className="cv-barcode" style={{ width: 2 * scale, height: 1.2 * scale, right: 0.6 * scale, bottom: 0.7 * scale }} />
          </div>
          <div className="cv-spine" style={{ width: spine * scale }}>
            {c.showSpine && spine >= 0.25 && (
              <span>
                {m.title} · {m.author}
              </span>
            )}
          </div>
          <div className="cv-front" style={{ width: (trim.w + 0.125) * scale }}>
            {front && <img src={front} alt="" />}
            <b style={{ fontSize: (c.titleSize * scale) / 72, top: 1.2 * scale }}>{m.title}</b>
            <em style={{ bottom: 0.9 * scale }}>{m.author}</em>
          </div>
          <span className="cv-bleed" style={{ inset: 0.125 * scale }} />
        </div>
        <p className="muted">{t("cover.guides")}</p>
      </div>
    </div>
  );
}

const KIT_TARGETS: Record<keyof Kit, [number, number]> = {
  logline: [15, 40],
  shortSynopsis: [100, 300],
  longSynopsis: [500, 1200],
  query: [250, 450],
  comps: [0, 120],
  bio: [50, 150],
};

function KitTab() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const lang = useStore((s) => s.settings.lang);
  const words = useStore((s) => s.words);
  const edit = useStore((s) => s.editManifest);
  const k = m.kit;
  const keys = Object.keys(KIT_TARGETS) as (keyof Kit)[];
  const labelsK = Object.fromEntries(keys.map((x) => [x, t(`kit.${x}` as TKey)])) as Record<keyof Kit, string>;
  const total = Object.values(words).reduce((a, b) => a + b, 0);

  const template = () =>
    t("kit.queryTemplate")
      .replace("{title}", m.title)
      .replace("{words}", formatNumber(Math.round(total / 1000) * 1000, lang))
      .replace("{author}", m.author);

  return (
    <div className="kit">
      {keys.map((key) => {
        const n = countWords(k[key]);
        const [lo, hi] = KIT_TARGETS[key];
        const state = !n ? "" : n < lo ? "short" : n > hi ? "long" : "ok";
        return (
          <section key={key} className="kit-field">
            <div className="kit-head">
              <h3>{labelsK[key]}</h3>
              <span className={`kit-count ${state}`}>
                {n} / {lo ? `${lo}–${hi}` : `≤${hi}`} {t("ed.words")}
              </span>
              {key === "query" && !k.query && (
                <button className="btn" onClick={() => edit((mm) => void (mm.kit.query = template()))}>
                  {t("kit.useTemplate")}
                </button>
              )}
            </div>
            <p className="muted">{t(`kit.${key}.hint` as TKey)}</p>
            <textarea className="textarea kit-text" rows={key === "logline" ? 2 : key === "longSynopsis" ? 14 : 6} value={k[key]} onChange={(e) => edit((mm) => void (mm.kit[key] = e.target.value))} />
          </section>
        );
      })}
      <div className="press-actions">
        <button
          className="btn primary"
          onClick={async () => {
            const path = await saveAs(m.title + " kit", "docx");
            if (!path) return;
            await api.fileWriteBytes(path, await kitDocx(m, k, labelsK));
            done(path);
          }}
        >
          <Download size={15} /> {t("kit.export")}
        </button>
      </div>
    </div>
  );
}

const STATUS: Submission["status"][] = ["draft", "sent", "partial", "full", "offer", "rejected", "silent"];

function SubmissionsTab() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const edit = useStore((s) => s.editManifest);
  const subs = m.submissions;
  const set = (id: string, patch: Partial<Submission>) => edit((mm) => void Object.assign(mm.submissions.find((x) => x.id === id)!, patch));
  const count = (s: Submission["status"]) => subs.filter((x) => x.status === s).length;
  return (
    <div className="subs">
      <div className="subs-summary">
        {STATUS.map((s) => (
          <div key={s} className={`sub-pill st-${s}`}>
            <b>{count(s)}</b> {t(`sub.status.${s}` as TKey)}
          </div>
        ))}
        <span className="spacer" />
        <button
          className="btn primary"
          onClick={() =>
            edit((mm) => void mm.submissions.unshift({ id: newId(), to: "", kind: "agent", sent: new Date().toISOString().slice(0, 10), status: "sent", reply: "", notes: "" }))
          }
        >
          <Plus size={15} /> {t("sub.add")}
        </button>
      </div>
      {subs.length === 0 ? (
        <p className="muted pad">{t("sub.none")}</p>
      ) : (
        <div className="table-wrap">
          <table className="outline">
            <thead>
              <tr>
                <th>{t("sub.to")}</th>
                <th>{t("sub.kind")}</th>
                <th>{t("sub.sent")}</th>
                <th>{t("sub.status")}</th>
                <th>{t("sub.reply")}</th>
                <th>{t("insp.notes")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input className="cell" value={s.to} placeholder={t("sub.toPh")} onChange={(e) => set(s.id, { to: e.target.value })} />
                  </td>
                  <td>
                    <select className="cell" value={s.kind} onChange={(e) => set(s.id, { kind: e.target.value as Submission["kind"] })}>
                      {(["agent", "publisher", "contest", "other"] as const).map((k) => (
                        <option key={k} value={k}>
                          {t(`sub.kind.${k}` as TKey)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="cell" type="date" value={s.sent} onChange={(e) => set(s.id, { sent: e.target.value })} />
                  </td>
                  <td>
                    <select className={`cell st-${s.status}`} value={s.status} onChange={(e) => set(s.id, { status: e.target.value as Submission["status"] })}>
                      {STATUS.map((x) => (
                        <option key={x} value={x}>
                          {t(`sub.status.${x}` as TKey)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="cell" type="date" value={s.reply} onChange={(e) => set(s.id, { reply: e.target.value })} />
                  </td>
                  <td>
                    <input className="cell" value={s.notes} onChange={(e) => set(s.id, { notes: e.target.value })} />
                  </td>
                  <td>
                    <button className="icon-btn danger" onClick={() => edit((mm) => void (mm.submissions = mm.submissions.filter((x) => x.id !== s.id)))}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
