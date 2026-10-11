import { X } from "lucide-react";
import { useStore } from "../store";

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const drop = useStore((s) => s.dropToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <p>{t.text}</p>
          <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => drop(t.id)} aria-label="Cerrar">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
