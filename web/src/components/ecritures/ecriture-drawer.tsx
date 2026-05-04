'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ExternalLink, Landmark } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { JustificatifsCard } from '@/components/ecritures/justificatifs-card';
import { SyncDraftButton } from '@/components/ecritures/sync-draft-button';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { Amount } from '@/components/shared/amount';
import { PendingButton } from '@/components/shared/pending-button';
import { Alert } from '@/components/ui/alert';
import { updateEcriture, updateEcritureStatus } from '@/lib/actions/ecritures';
import { computeMissingFields } from '@/lib/services/ecritures';
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

// Drawer d'édition rapide. Priorité info repensée pour le process
// trésorier (compléter une écriture le plus vite possible) :
//   1. Header : id + status + montant (lecture en 1 coup d'œil)
//   2. Eyebrow : description, date, lien page complète
//   3. Origine bancaire (si applicable)
//   4. Bandeau "À COMPLÉTER" si missing fields — info actionnable
//   5. Form d'édition complet (le travail principal)
//   6. Justificatifs (souvent à compléter aussi)
//   7. Cycle de vie (Valider, Sync, Repasser brouillon) — en bas, après
//      la décision de sauver

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
  const totalJustifs =
    justifsBundle.direct.length +
    justifsBundle.viaRemboursement.reduce(
      (sum, r) => sum + r.justifs.length + r.rib.length,
      0,
    );
  const missing = computeMissingFields({
    ...ecriture,
    has_justificatif: totalJustifs > 0,
  });

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
      {/* Eyebrow : description + date + lien deep */}
      <div className="-mt-1 mb-3 pb-3 border-b border-border-soft">
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
        <Alert variant="info" icon={Landmark} className="mb-3 text-[12.5px]">
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

      {/* À COMPLÉTER — bandeau actionnable si missing fields */}
      {missing.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-amber-900 dark:text-amber-300 mb-1.5">
            <AlertTriangle size={12} strokeWidth={2.25} />
            À compléter ({missing.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 px-2 py-0.5 text-[11.5px] font-medium"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* FORMULAIRE D'ÉDITION (priorité : c'est le travail principal) */}
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

      {/* JUSTIFICATIFS — après le form (souvent à enrichir) */}
      <div className="mt-5">
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

      {/* CYCLE DE VIE — en bas, après le travail. Sépaation visuelle nette. */}
      <div className="mt-6 pt-4 border-t border-border-soft">
        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide font-medium text-fg-subtle mb-2">
          Cycle de vie
        </div>
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
      </div>
    </Drawer>
  );
}
