import { Usb } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../lib/i18n";
import { bookWords, locate, wordsOf } from "../lib/tree";
import { formatNumber } from "../lib/words";
import { pace, useJournal } from "../lib/journal";
import { useUpdate } from "../lib/updater";
import { useSync } from "../lib/sync";
import { CloudConflicts } from "./SyncDialogs";
import { useState } from "react";

export default function StatusBar() {
  const t = useT();
  const m = useStore((s) => s.project!.manifest);
  const words = useStore((s) => s.words);
  const selected = useStore((s) => s.selected);
  const lang = useStore((s) => s.settings.lang);
  const save = useStore((s) => s.saveState);
  const start = useStore((s) => s.sessionStart);
  const portable = useStore((s) => s.info?.portable);
  const loc = selected ? locate(m, selected) : null;
  const book = bookWords(m, words);
  const session = book - start;
  const f = (n: number) => formatNumber(n, lang);
  const journal = useJournal((s) => s.journal);
  const p = pace(m, book, journal);
  const up = useUpdate((s) => (s.phase === "ready" || s.phase === "available" ? s.release?.version : null));
  const upReady = useUpdate((s) => s.phase === "ready");
  const cloud = useSync((s) => s.conflicts.length);
  const [showCloud, setShowCloud] = useState(false);

  return (
    <div className="statusbar">
      {loc?.node.type === "text" && (
        <span>
          {t("sb.text")} <b>{f(wordsOf(loc.node, words))}</b>
          {loc.node.target > 0 && ` / ${f(loc.node.target)}`}
        </span>
      )}
      {loc?.parent && (
        <span>
          {loc.parent.title} <b>{f(wordsOf(loc.parent, words))}</b>
        </span>
      )}
      <span>
        {t("sb.book")} <b>{f(book)}</b>
        {m.target.words > 0 && ` / ${f(m.target.words)}`}
      </span>
      <span>
        {t("sb.session")} <b>{session >= 0 ? "+" : "−"}{f(Math.abs(session))}</b>
      </span>
      {p && p.perDay > 0 && (
        <button className="sb-link" onClick={() => useStore.setState({ view: "termometro" })} title={t("goal.pace")}>
          {t("goal.today")} <b>{p.today >= 0 ? "+" : "−"}{f(Math.abs(p.today))}</b> / {f(p.perDay)}
        </button>
      )}
      {portable && (
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Usb size={12} /> {t("app.portable")}
        </span>
      )}
      {up && (
        <button className="sb-link sb-update" onClick={() => useUpdate.setState({ dialog: "offer" })}>
          {t(upReady ? "up.chip" : "up.chipAvail", { v: up })}
        </button>
      )}
      {cloud > 0 && (
        <button className="sb-link sb-warn" onClick={() => setShowCloud(true)}>
          {t("sync.chip", { n: cloud })}
        </button>
      )}
      {showCloud && <CloudConflicts onClose={() => setShowCloud(false)} />}
      <span className={`save ${save}`}>
        <i />
        {t(save === "saved" ? "sb.saved" : save === "saving" ? "sb.saving" : save === "pending" ? "sb.pending" : "sb.error")}
      </span>
    </div>
  );
}
