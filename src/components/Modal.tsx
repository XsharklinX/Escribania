import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export default function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [props]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-label={props.title} style={props.wide ? { width: "min(760px, 100%)" } : undefined}>
        <header>
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>
        {props.children}
        {props.footer && <footer>{props.footer}</footer>}
      </div>
    </div>
  );
}
