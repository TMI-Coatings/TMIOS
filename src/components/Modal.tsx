import { useEffect, useRef } from "react";

/** The demo's dialog: header, scrolling body, footer. Esc or Close shuts it. */
export function Modal({ title, sub, onClose, children, footer }: { title: React.ReactNode; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title">
      <div className="dh">
        <div>
          <b id="dlg-title" style={{ fontSize: 19 }}>
            {title}
          </b>
          {sub && <div className="note">{sub}</div>}
        </div>
        <button className="ghost" onClick={() => ref.current?.close()} aria-label="Close">
          Close
        </button>
      </div>
      <div className="db">{children}</div>
      {footer && <div className="df">{footer}</div>}
    </dialog>
  );
}
