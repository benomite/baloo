'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { MoreHorizontal, Eye, FlagTriangleRight, Landmark, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { syncDraftToComptaweb } from '@/lib/actions/drafts';
import { updateEcritureStatus } from '@/lib/actions/ecritures';
import type { Ecriture } from '@/lib/types';

// Menu ⋯ des actions SECONDAIRES / rares du cycle de vie, sorties de la barre
// principale pour ne garder que « Valider ». Popover maison (clic dehors +
// Échap), pattern cohérent avec la popover de sync.

export function PanelMoreMenu({
  ecriture,
  onDone,
}: {
  ecriture: Ecriture;
  // Rafraîchit/ferme après une action de statut.
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const inCw = ecriture.comptaweb_ecriture_id != null;

  const preview = () =>
    startTransition(async () => {
      const res = await syncDraftToComptaweb(ecriture.id, { dryRun: true });
      if (res.ok) toast.success(res.message);
      else if (res.missingFields?.length) toast.warning(res.message);
      else toast.error(res.message);
      setOpen(false);
    });

  const setStatus = (status: 'pending_sync' | 'mirror' | 'draft', label: string) => () =>
    startTransition(async () => {
      await updateEcritureStatus(ecriture.id, status);
      toast.success(label);
      setOpen(false);
      onDone?.();
    });

  // Rien à proposer une fois l'écriture réellement dans CW (id CW posé).
  const items: Array<{ icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void }> = [];
  if (!inCw) {
    items.push({ icon: Eye, label: 'Prévisualiser la sync Comptaweb', onClick: preview });
    if (ecriture.status === 'draft') {
      items.push({
        icon: FlagTriangleRight,
        label: 'Marquer prêt sans créer dans CW',
        onClick: setStatus('pending_sync', 'Marqué prêt (pas créé dans Comptaweb).'),
      });
    }
    if (ecriture.status === 'pending_sync') {
      items.push({
        icon: Landmark,
        label: 'Marquer miroir CW (déjà créé à la main)',
        onClick: setStatus('mirror', 'Marqué miroir Comptaweb.'),
      });
    }
    if (ecriture.status !== 'draft') {
      items.push({ icon: Undo2, label: 'Repasser en brouillon', onClick: setStatus('draft', 'Repassé en brouillon.') });
    }
  }

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-label="Plus d’actions"
        aria-expanded={open}
        className="inline-flex items-center justify-center size-7 rounded-md border border-border text-fg-muted hover:bg-fg/[0.05] hover:text-fg transition-colors disabled:opacity-60"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-1.5 z-50 min-w-[16rem] rounded-lg border border-border bg-bg-elevated shadow-lg p-1 text-[12.5px]"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={it.onClick}
              className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-fg hover:bg-fg/[0.05] disabled:opacity-60"
            >
              <it.icon size={14} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
