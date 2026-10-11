import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Palette, Save, Trash2, Upload } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { applyStyle, loadStyles, parseStyleFile, saveStyles, styleFile, styleFrom, type PressStyle } from "../lib/pressStyles";
import { slugify } from "../lib/ids";

/** Estilos de imprenta propios: guardar, aplicar y compartir la maquetación. */
export default function PressStyles() {
  const t = useT();
  const edit = useStore((s) => s.editManifest);
  const toast = useStore((s) => s.toast);
  const [styles, setStyles] = useState<PressStyle[]>([]);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  useEffect(() => void loadStyles().then(setStyles), []);
  const store = async (list: PressStyle[]) => {
    setStyles(list);
    await saveStyles(list).catch((e) => toast(errorText(e), "error"));
  };
  const current = styles.find((s) => s.id === pick);

  return (
    <section>
      <h3>
        <Palette size={15} /> {t("pst.title")}
      </h3>
      <p className="muted">{t("pst.hint")}</p>
      <div className="row-wrap">
        <select className="select" style={{ maxWidth: 240 }} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{styles.length ? t("pst.choose") : t("pst.none")}</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!current}
          onClick={() => {
            edit((mm) => applyStyle(current!, mm.publish, mm.compile));
            toast(t("pst.applied", { s: current!.name }));
          }}
        >
          {t("pst.apply")}
        </button>
        <button
          className="icon-btn"
          disabled={!current}
          title={t("pst.export")}
          onClick={async () => {
            const path = await save({ defaultPath: `${slugify(current!.name) || "estilo"}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
            if (path) await api.fileWriteText(path, styleFile(current!)).then(() => toast(t("exp.done")), (e) => toast(errorText(e), "error"));
          }}
        >
          <Download size={15} />
        </button>
        <button className="icon-btn danger" disabled={!current} title={t("pst.delete")} onClick={() => void store(styles.filter((s) => s.id !== pick)).then(() => setPick(""))}>
          <Trash2 size={15} />
        </button>
        <button
          className="icon-btn"
          title={t("pst.import")}
          onClick={async () => {
            const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
            if (typeof path !== "string") return;
            try {
              const st = parseStyleFile(await api.fileReadText(path));
              await store([...styles, st]);
              setPick(st.id);
              toast(t("pst.imported", { s: st.name }));
            } catch {
              toast(t("pst.bad"), "error");
            }
          }}
        >
          <Upload size={15} />
        </button>
      </div>
      <div className="row-wrap">
        <input className="input" style={{ maxWidth: 240 }} placeholder={t("pst.namePh")} value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn"
          disabled={!name.trim()}
          onClick={async () => {
            const m = useStore.getState().project!.manifest;
            const st = styleFrom(name.trim(), m.publish, m.compile);
            await store([...styles.filter((s) => s.name !== st.name), st]);
            setPick(st.id);
            setName("");
            toast(t("pst.saved", { s: st.name }));
          }}
        >
          <Save size={14} /> {t("pst.save")}
        </button>
      </div>
    </section>
  );
}
