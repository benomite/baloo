'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Drawer minimal slide-in (depuis la droite par défaut). Utilisé pour
// l'édition rapide d'une écriture sans quitter la liste.
//
// API simple : open + onClose. Pas de focus trap parfait — pour les
// formulaires standards c'est suffisant.

export function Drawer({
  open,
  onClose,
  children,
  title,
  side = 'right',
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  side?: 'right' | 'left';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal
        className={cn(
          'fixed top-0 bottom-0 z-50 flex flex-col bg-bg-elevated shadow-2xl',
          'w-full sm:w-[640px] lg:w-[760px] max-w-full',
          'transition-transform duration-300 ease-out',
          side === 'right' ? 'right-0' : 'left-0',
          side === 'right'
            ? open ? 'translate-x-0' : 'translate-x-full'
            : open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {(title || true) && (
          <header className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border-soft shrink-0">
            <div className="min-w-0 flex-1">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-fg-muted hover:bg-bg-sunken hover:text-fg transition-colors"
              aria-label="Fermer"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </>
  );
}
