'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { SyncDraftButton } from '@/components/ecritures/sync-draft-button';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { Amount } from '@/components/shared/amount';
import { PendingButton } from '@/components/shared/pending-button';
import { updateEcriture, updateEcritureStatus } from '@/lib/actions/ecritures';
import type {
  Ecriture,
  Category,
  Unite,
  ModePaiement,
  Activite,
  Carte,
} from '@/lib/types';

// Édition rapide d'une écriture sans changer de page. La liste reste
// visible derrière le backdrop. Fermer = retire ?detail= de l'URL.
//
// Pour les actions complexes (justifs / relance / dépôts), un lien
// "Voir tous les détails" envoie vers la page complète /ecritures/[id].

export function EcritureDrawer({
  ecriture,
  categories,
  topCategoryIds,
  unites,
  modesPaiement,
  activites,
  cartes,
}: {
  ecriture: Ecriture;
  categories: Category[];
  topCategoryIds: string[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const close = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete('detail');
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const updateAction = updateEcriture.bind(null, ecriture.id);

  return (
    <Drawer
      open
      onClose={close}
      title={
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/ecritures/${ecriture.id}`}
            className="font-mono text-[12px] text-fg-muted hover:text-brand hover:underline truncate"
            title={`Ouvrir ${ecriture.id} en page complète`}
          >
            {ecriture.id}
          </Link>
          <EcritureStatusBadge status={ecriture.status} />
          <Amount
            cents={ecriture.amount_cents}
            tone={ecriture.type === 'depense' ? 'negative' : 'positive'}
            className="text-[15px] font-semibold tabular-nums ml-auto"
          />
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/ecritures/${ecriture.id}`}
            className="inline-flex items-center gap-1.5 text-[12px] text-brand hover:underline"
          >
            <ExternalLink size={11} strokeWidth={2} />
            Justificatifs & relance
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {ecriture.status === 'brouillon' && (
              <form action={updateEcritureStatus.bind(null, ecriture.id, 'valide')}>
                <PendingButton variant="outline" size="sm">
                  Valider
                </PendingButton>
              </form>
            )}
            {ecriture.status === 'valide' && !ecriture.comptaweb_ecriture_id && (
              <form action={updateEcritureStatus.bind(null, ecriture.id, 'saisie_comptaweb')}>
                <PendingButton variant="outline" size="sm">
                  Marquer saisie CW (sans sync)
                </PendingButton>
              </form>
            )}
            {!ecriture.comptaweb_ecriture_id && <SyncDraftButton ecritureId={ecriture.id} />}
            {ecriture.status !== 'brouillon' && !ecriture.comptaweb_ecriture_id && (
              <form action={updateEcritureStatus.bind(null, ecriture.id, 'brouillon')}>
                <PendingButton variant="ghost" size="sm">
                  Repasser brouillon
                </PendingButton>
              </form>
            )}
          </div>
        </div>

        <EcritureForm
          action={updateAction}
          categories={categories}
          topCategoryIds={topCategoryIds}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
          ecriture={ecriture}
        />
      </div>
    </Drawer>
  );
}
