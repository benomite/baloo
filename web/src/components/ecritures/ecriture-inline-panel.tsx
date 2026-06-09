'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, Landmark, Loader2, Lock, X } from 'lucide-react';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { JustificatifsCard } from '@/components/ecritures/justificatifs-card';
import { SyncDraftButton } from '@/components/ecritures/sync-draft-button';
import { ResyncEcritureButton } from '@/components/ecritures/resync-ecriture-button';
import { DeleteDraftButton } from '@/components/ecritures/delete-draft-button';
import { EcritureStatePair } from '@/components/shared/status-badge';
import { PendingButton } from '@/components/shared/pending-button';
import { Alert } from '@/components/ui/alert';
import { updateEcriture, updateEcritureStatus, fetchEcritureDetail } from '@/lib/actions/ecritures';
import { computeReadiness } from '@/lib/sync-readiness';
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

type Detail = { ecriture: Ecriture; justifsBundle: EcritureJustifsBundle; pendingDepots: DepotEnriched[] };

export function EcritureInlinePanel({
  ecriture: rowEcriture,
  onCollapse,
  categories,
  topCategoryIds,
  unites,
  modesPaiement,
  activites,
  cartes,
}: {
  ecriture: Ecriture;
  onCollapse: () => void;
  categories: Category[];
  topCategoryIds: string[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
}) {
  // Chargement DIRECT du détail (écriture fraîche + justifs + dépôts) à
  // l'ouverture — aucune navigation, aucun re-render de toute la page.
  // Chaque panneau est monté pour UNE écriture (instance fraîche par ligne
  // ouverte) → un seul fetch au montage. `detail` part à null → spinner.
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchEcritureDetail(rowEcriture.id).then((d) => {
      if (!cancelled && d) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [rowEcriture.id]);

  // Écriture affichée : la fraîche dès qu'elle est là, sinon celle de la
  // ligne (form + cycle de vie éditables tout de suite). Bundle justifs :
  // null tant que le fetch n'a pas répondu → spinner visible dans le panneau.
  const ecriture = detail?.ecriture ?? rowEcriture;
  const bundle = detail
    ? { justifsBundle: detail.justifsBundle, pendingDepots: detail.pendingDepots }
    : null;

  const updateAction = updateEcriture.bind(null, ecriture.id);
  const totalJustifs = bundle
    ? bundle.justifsBundle.direct.length +
      bundle.justifsBundle.viaRemboursement.reduce(
        (sum, r) => sum + r.justifs.length + r.rib.length,
        0,
      )
    : null;
  // On ne signale « justif manquant » que si le bundle est chargé (sinon on
  // ne sait pas encore).
  const justifMissing =
    ecriture.type === 'depense' &&
    ecriture.justif_attendu === 1 &&
    totalJustifs === 0;
  const readiness = computeReadiness(ecriture, {
    categories,
    unites,
    modesPaiement,
    activites,
  });

  return (
    <div className="rounded-xl border border-border-soft bg-bg-elevated shadow-sm p-3.5 my-1 text-left max-h-[72vh] overflow-y-auto">
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border-soft">
        <Link
          href={`/ecritures/${ecriture.id}`}
          className="font-mono text-[11.5px] text-fg-subtle hover:text-brand hover:underline shrink-0"
          title={`Ouvrir ${ecriture.id} en page complète`}
        >
          {ecriture.id}
        </Link>
        <EcritureStatePair
          hasJustif={!!ecriture.has_justificatif}
          comptawebSynced={ecriture.comptaweb_synced === 1}
        />
        <Link
          href={`/ecritures/${ecriture.id}`}
          className="inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline"
        >
          <ExternalLink size={10} strokeWidth={2} />
          Page complète
        </Link>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Replier"
          className="ml-auto inline-flex items-center justify-center size-6 rounded text-fg-subtle hover:bg-muted hover:text-fg transition-colors"
        >
          <X size={15} strokeWidth={2} />
        </button>
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

      {/* ÉTAT — bandeau qui dit clairement où on en est */}
      <ReadinessBanner
        readiness={readiness}
        justifMissing={justifMissing}
      />

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

      {/* JUSTIFICATIFS — après le form. Chargés en différé : « chargement… »
          tant que le bundle n'a pas atterri. */}
      <div className="mt-4">
        {bundle ? (
          <JustificatifsCard
            entityId={ecriture.id}
            bundle={bundle.justifsBundle}
            justifAttendu={ecriture.justif_attendu === 1}
            numeroPiece={ecriture.numero_piece}
            type={ecriture.type}
            pendingDepots={bundle.pendingDepots}
            ecritureAmountCents={ecriture.amount_cents}
            ecritureDate={ecriture.date_ecriture}
          />
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-fg-muted py-3">
            <Loader2 size={14} className="animate-spin" />
            Chargement des justificatifs…
          </div>
        )}
      </div>

      {/* CYCLE DE VIE — en bas, après le travail. Séparation visuelle nette. */}
      <div className="mt-5 pt-3 border-t border-border-soft">
        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide font-medium text-fg-subtle mb-2">
          Cycle de vie
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ecriture.status === 'draft' && (
            <form action={updateEcritureStatus.bind(null, ecriture.id, 'pending_sync')}>
              <PendingButton variant="outline" size="sm">
                Valider
              </PendingButton>
            </form>
          )}
          {ecriture.status === 'pending_sync' && !ecriture.comptaweb_ecriture_id && (
            <form action={updateEcritureStatus.bind(null, ecriture.id, 'mirror')}>
              <PendingButton variant="outline" size="sm">
                Marquer miroir CW
              </PendingButton>
            </form>
          )}
          {!ecriture.comptaweb_ecriture_id && <SyncDraftButton ecritureId={ecriture.id} />}
          {ecriture.comptaweb_ecriture_id != null && (
            <ResyncEcritureButton ecritureId={ecriture.id} />
          )}
          {ecriture.status !== 'draft' && !ecriture.comptaweb_ecriture_id && (
            <form
              action={updateEcritureStatus.bind(null, ecriture.id, 'draft')}
              className="ml-auto"
            >
              <PendingButton variant="ghost" size="sm">
                Repasser brouillon
              </PendingButton>
            </form>
          )}
          {/* Suppression réservée aux brouillons locaux. Garde-fous serveur. */}
          {ecriture.status === 'draft' && (
            <div className="ml-auto">
              <DeleteDraftButton ecritureId={ecriture.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadinessBanner({
  readiness,
  justifMissing,
}: {
  readiness: ReturnType<typeof computeReadiness>;
  justifMissing: boolean;
}) {
  // 3 niveaux visuels :
  //   - synced     → vert tendre, icône lock (immutable)
  //   - ready      → vert vif, icône check (clic pour sync)
  //   - incomplete → ambre, icône warning + liste précise
  if (readiness.level === 'synced') {
    return (
      <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-800 dark:text-emerald-300">
          <Lock size={13} strokeWidth={2.25} />
          {readiness.message}
        </div>
        <p className="text-[11.5px] text-emerald-700/90 dark:text-emerald-400/80 mt-0.5 ml-5">
          Les champs synchronisables sont verrouillés.
        </p>
      </div>
    );
  }

  if (readiness.level === 'ready') {
    return (
      <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 size={13} strokeWidth={2.25} />
          {readiness.message}
        </div>
        <p className="text-[11.5px] text-emerald-700/90 dark:text-emerald-400/80 mt-0.5 ml-5">
          Tous les champs requis sont mappés Comptaweb.
          {justifMissing && ' Justificatif manquant (non bloquant pour la sync).'}
        </p>
      </div>
    );
  }

  // incomplete
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-amber-900 dark:text-amber-300 mb-1.5">
        <AlertTriangle size={13} strokeWidth={2.25} />
        À compléter avant synchronisation Comptaweb
      </div>
      <ul className="ml-5 space-y-0.5 mb-1">
        {readiness.missingFields.map((m) => (
          <li
            key={m}
            className="text-[12px] text-amber-900 dark:text-amber-200 list-disc list-inside"
          >
            {m}
          </li>
        ))}
        {justifMissing && (
          <li className="text-[12px] text-amber-700 dark:text-amber-300/80 list-disc list-inside italic">
            justificatif (non bloquant pour sync, mais à fournir)
          </li>
        )}
      </ul>
    </div>
  );
}
