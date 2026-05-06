'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ExternalLink, Landmark, Lock } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { JustificatifsCard } from '@/components/ecritures/justificatifs-card';
import { SyncDraftButton } from '@/components/ecritures/sync-draft-button';
import { EcritureStatePair } from '@/components/shared/status-badge';
import { Amount } from '@/components/shared/amount';
import { PendingButton } from '@/components/shared/pending-button';
import { Alert } from '@/components/ui/alert';
import { updateEcriture, updateEcritureStatus } from '@/lib/actions/ecritures';
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
          <EcritureStatePair
            hasJustif={!!ecriture.has_justificatif}
            comptawebSynced={ecriture.comptaweb_synced === 1}
          />
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

      {/* CYCLE DE VIE — en bas, après le travail. Séparation visuelle nette. */}
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
