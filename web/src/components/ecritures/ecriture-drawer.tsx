'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Landmark } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { JustificatifsCard } from '@/components/ecritures/justificatifs-card';
import { SyncDraftButton } from '@/components/ecritures/sync-draft-button';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { Amount } from '@/components/shared/amount';
import { PendingButton } from '@/components/shared/pending-button';
import { Alert } from '@/components/ui/alert';
import { updateEcriture, updateEcritureStatus } from '@/lib/actions/ecritures';
import { type EcritureJustifsBundle } from '@/lib/queries/justificatifs';
import { type DepotEnriched } from '@/lib/services/depots';
import type {
  Ecriture,
  Category,
  Unite,
  ModePaiement,
  Activite,
  Carte,
} from '@/lib/types';

// Drawer d'édition rapide d'une écriture. Composition refined utility,
// hiérarchie verticale claire :
//   1. header sticky (id + status + montant + close)
//   2. badge "ligne bancaire" si applicable
//   3. justificatifs (en haut, info clé pour décider)
//   4. barre d'actions de status (Valider / Sync / Repasser brouillon)
//   5. formulaire d'édition (Identité + Imputation + Notes)

export function EcritureDrawer({
  ecriture,
  justifsBundle,
  pendingDepots,
  categories,
  topCategoryIds,
  unites,
  modesPaiement,
  activites,
  cartes,
}: {
  ecriture: Ecriture;
  justifsBundle: EcritureJustifsBundle;
  pendingDepots: DepotEnriched[];
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
  const cleanDescription = (raw: string) => raw.replace(/\s+/g, ' ').trim();

  return (
    <Drawer
      open
      onClose={close}
      title={
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/ecritures/${ecriture.id}`}
            className="font-mono text-[11.5px] text-fg-subtle hover:text-brand hover:underline shrink-0"
            title={`Ouvrir ${ecriture.id} en page complète`}
          >
            {ecriture.id}
          </Link>
          <EcritureStatusBadge status={ecriture.status} />
          <span className="ml-auto tabular-nums text-[18px] font-semibold tracking-tight">
            <Amount
              cents={ecriture.amount_cents}
              tone={ecriture.type === 'depense' ? 'negative' : 'positive'}
            />
          </span>
        </div>
      }
    >
      {/* Eyebrow : description tronquée + lien deep */}
      <div className="-mt-1 mb-4 pb-3 border-b border-border-soft">
        <h2 className="text-[15px] font-semibold text-fg leading-snug truncate">
          {cleanDescription(ecriture.description)}
        </h2>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-[12px] text-fg-muted tabular-nums">
            {ecriture.date_ecriture}
          </span>
          <Link
            href={`/ecritures/${ecriture.id}`}
            className="inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline"
          >
            <ExternalLink size={10} strokeWidth={2} />
            Page complète
          </Link>
        </div>
      </div>

      {/* Origine bancaire */}
      {ecriture.ligne_bancaire_id && (
        <Alert variant="info" icon={Landmark} className="mb-4 text-[12.5px]">
          Issue de la ligne bancaire{' '}
          <code className="font-mono text-[11.5px] font-medium">
            #{ecriture.ligne_bancaire_id}
          </code>
          {ecriture.ligne_bancaire_sous_index !== null && (
            <>
              {' '}sous-ligne{' '}
              <code className="font-mono text-[11.5px] font-medium">
                {ecriture.ligne_bancaire_sous_index}
              </code>
            </>
          )}
          {ecriture.comptaweb_ecriture_id && (
            <>
              {' '}· synchronisée Comptaweb (id{' '}
              <code className="font-mono text-[11.5px] font-medium">
                {ecriture.comptaweb_ecriture_id}
              </code>
              )
            </>
          )}
        </Alert>
      )}

      {/* JUSTIFS — affiché en premier car c'est l'info qui conditionne
          souvent la décision (compléter, valider, sync) */}
      <div className="mb-4">
        <JustificatifsCard
          entityId={ecriture.id}
          bundle={justifsBundle}
          justifAttendu={ecriture.justif_attendu === 1}
          numeroPiece={ecriture.numero_piece}
          type={ecriture.type}
          pendingDepots={pendingDepots}
          ecritureAmountCents={ecriture.amount_cents}
          ecritureDate={ecriture.date_ecriture}
        />
      </div>

      {/* ACTIONS DE STATUS — barre dédiée, accents brand pour le primaire */}
      <div className="mb-5 flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-lg border border-border-soft bg-bg-sunken/40">
        <span className="text-[10.5px] uppercase tracking-wide font-medium text-fg-subtle mr-1">
          Cycle de vie
        </span>
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
              Marquer saisie CW
            </PendingButton>
          </form>
        )}
        {!ecriture.comptaweb_ecriture_id && <SyncDraftButton ecritureId={ecriture.id} />}
        {ecriture.status !== 'brouillon' && !ecriture.comptaweb_ecriture_id && (
          <form
            action={updateEcritureStatus.bind(null, ecriture.id, 'brouillon')}
            className="ml-auto"
          >
            <PendingButton variant="ghost" size="sm">
              Repasser brouillon
            </PendingButton>
          </form>
        )}
      </div>

      {/* FORMULAIRE D'ÉDITION */}
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
    </Drawer>
  );
}
