'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop oscuro con blur */}
      <div
        className="fixed inset-0 animate-fade-in bg-black/75 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Caja modal centrada y por encima de todo */}
      <section className="glass-strong relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col animate-sheet-up overflow-hidden rounded-3xl p-5 shadow-2xl sm:p-6">
        <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="text-lg font-semibold text-pebble">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-2 text-jade transition hover:bg-white/10 hover:text-pebble"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto pr-1">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}
