"use client";

import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function CenteredModal({ open, onClose, eyebrow, title, label, closeLabel, children, footer }: {
  open: boolean; onClose: () => void; eyebrow: string; title: string; label: string;
  closeLabel: string; children: ReactNode; footer?: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="centered-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <section className="centered-modal-panel" role="dialog" aria-modal="true" aria-label={label}>
        <header className="centered-modal-header">
          <div><small>{eyebrow}</small><h2>{title}</h2></div>
          <button type="button" aria-label={closeLabel} onClick={() => closeRef.current()}><X size={18}/></button>
        </header>
        <div className="centered-modal-scroll">{children}</div>
        {footer && <div className="centered-modal-footer">{footer}</div>}
      </section>
    </div>, document.body,
  );
}
