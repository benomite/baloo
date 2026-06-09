'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Amount } from '@/components/shared/amount';
import { linkDepotToEcriture, linkRembToEcriture, rejectMatchForEcriture } from '@/lib/actions/depots';
import type { EcritureMatch } from '@/lib/services/ecriture-match';

// Bannière « un dépôt / remboursement semble correspondre ». Dépliable
// (clic → détails pour vérifier le match), « Lier » en place (toast +
// refresh) et « Ignorer » (ne plus proposer cette paire — persisté côté
// serveur, masqué côté client). Admin only (pools fournis aux admins).
export function EcritureMatchBanner({
  match,
  ecritureId,
  refreshRow,
}: {
  match: EcritureMatch;
  ecritureId: string;
  // Rafraîchit la ligne après liaison (les infos recopiées — unité/catégorie
  // — apparaissent sans recharger la page).
  refreshRow?: (id: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  const isDepot = match.kind === 'depot';

  const lier = () =>
    startTransition(async () => {
      const res = isDepot
        ? await linkDepotToEcriture(match.id, ecritureId)
        : await linkRembToEcriture(match.id, ecritureId);
      if (res.ok) {
        toast.success('Rattaché à l’écriture.');
        // Masquage immédiat + rafraîchissement de la ligne : les infos
        // recopiées depuis le dépôt/remboursement (unité/catégorie) et le
        // lien apparaissent sans recharger toute la liste.
        setDismissed(true);
        void refreshRow?.(ecritureId);
      } else {
        toast.error(res.error ?? 'Liaison impossible.');
      }
    });

  const ignorer = () =>
    startTransition(async () => {
      const res = await rejectMatchForEcriture(ecritureId, match.kind, match.id);
      if (res.ok) {
        setDismissed(true);
      } else {
        toast.error(res.error ?? 'Action impossible.');
      }
    });

  if (dismissed) return null;

  return (
    <div className="rounded-md bg-amber-50 dark:bg-amber-950/25 text-amber-900 dark:text-amber-200">
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
        <Link2 size={13} strokeWidth={2} className="shrink-0" />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex items-center gap-1 text-left hover:underline"
          aria-expanded={open}
        >
          <span className="truncate">
            {isDepot ? (
              <>Un dépôt <b className="font-medium">« {match.label} »</b> semble correspondre</>
            ) : (
              <>Un remboursement de <b className="font-medium">{match.label}</b> semble correspondre</>
            )}
          </span>
          <ChevronDown size={12} strokeWidth={2.25} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <div className="ml-auto shrink-0 flex items-center gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={ignorer}
            title="Ne plus proposer cette correspondance"
          >
            Ignorer
          </Button>
          <Button size="xs" disabled={pending} onClick={lier}>Lier</Button>
        </div>
      </div>
      {open && (
        <dl className="mx-2.5 mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-amber-200/60 dark:border-amber-900/40 pt-1.5 text-[11.5px]">
          <dt className="text-amber-700/80 dark:text-amber-300/70">Montant</dt>
          <dd className="tabular-nums font-medium">
            {match.amountCents != null ? <Amount cents={match.amountCents} /> : '—'}
          </dd>
          <dt className="text-amber-700/80 dark:text-amber-300/70">Date</dt>
          <dd className="tabular-nums">{match.date ?? '—'}</dd>
          <dt className="text-amber-700/80 dark:text-amber-300/70">Unité</dt>
          <dd>{match.uniteCode ?? '—'}</dd>
          <dt className="text-amber-700/80 dark:text-amber-300/70">{isDepot ? 'Catégorie' : 'Statut'}</dt>
          <dd>{match.detail ?? '—'}</dd>
        </dl>
      )}
    </div>
  );
}
