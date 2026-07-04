'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { JustificatifsCard } from '@/components/ecritures/justificatifs-card';
import { PanelHeader } from '@/components/ecritures/panel-header';
import { PanelReadonlySummary } from '@/components/ecritures/panel-readonly-summary';
import { PanelImputation } from '@/components/ecritures/panel-imputation';
import { PanelRelance } from '@/components/ecritures/panel-relance';
import { CwAssistActions, type CwAssistPayload } from '@/components/ecritures/cw-assist-actions';
import { ResyncEcritureButton } from '@/components/ecritures/resync-ecriture-button';
import { DeleteDraftButton } from '@/components/ecritures/delete-draft-button';
import { PanelValiderButton } from '@/components/ecritures/panel-valider-button';
import { PanelMoreMenu } from '@/components/ecritures/panel-more-menu';
import { updateEcriture, updateEcritureField, fetchEcritureDetail } from '@/lib/actions/ecritures';
import { computeReadiness } from '@/lib/sync-readiness';
import { panelViewModel } from '@/components/ecritures/panel-view-model';
import { type EcritureJustifsBundle } from '@/lib/queries/justificatifs';
import { type DepotEnriched, type DepotForSharing } from '@/lib/services/depots';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

type Detail = {
  ecriture: Ecriture;
  justifsBundle: EcritureJustifsBundle;
  pendingDepots: DepotEnriched[];
  shareableDepots: DepotForSharing[];
};

export function EcritureInlinePanel({
  ecriture: rowEcriture,
  ecritureId,
  onCollapse,
  refreshRow,
  onValidate,
  isAdmin = false,
  focusSection,
  reloadSignal,
  categories,
  topCategoryIds,
  unites,
  modesPaiement,
  activites,
  cartes,
}: {
  // Fournie quand le panneau s'ouvre sous une ligne. Absente en mode autonome
  // (épinglé via ?open) : on prend alors l'écriture fraîche du fetch.
  ecriture?: Ecriture;
  ecritureId: string;
  onCollapse: () => void;
  refreshRow?: (id: string) => void | Promise<void>;
  // Flux de validation optimiste du parent (verrou ligne + retrait au succès).
  // Fourni quand le panneau est inline sous une ligne ; absent en autonome.
  onValidate?: (id: string) => void;
  isAdmin?: boolean;
  focusSection?: 'justif';
  // En mode autonome (épinglé) : bump ce signal pour re-fetcher le détail
  // après une édition (pas de refreshRow de ligne dans ce cas).
  reloadSignal?: number;
  categories: Category[];
  topCategoryIds: string[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchEcritureDetail(ecritureId).then((d) => {
      if (!cancelled && d) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [ecritureId, reloadSignal]);

  // Écriture affichée : la ligne si fournie (mise à jour via refreshRow),
  // sinon l'écriture fraîche du fetch (mode autonome/épinglé).
  const ecriture = rowEcriture ?? detail?.ecriture ?? null;

  const justifRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusSection === 'justif' && detail) justifRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusSection, detail]);

  if (!ecriture) {
    return (
      <div className="rounded-xl border border-border-soft bg-bg-elevated shadow-sm p-4 my-1 flex items-center gap-2 text-[12px] text-fg-muted">
        <Loader2 size={14} className="animate-spin" /> Chargement…
      </div>
    );
  }

  const vm = panelViewModel(ecriture);
  const readiness = computeReadiness(ecriture, { categories, unites, modesPaiement, activites });
  const totalJustifs = detail
    ? detail.justifsBundle.direct.length +
      detail.justifsBundle.viaRemboursement.reduce((s, r) => s + r.justifs.length + r.rib.length, 0)
    : null;
  const justifMissing =
    ecriture.type === 'depense' && ecriture.justif_attendu === 1 && totalJustifs === 0 && !ecriture.remboursement_id;

  const onRename = async (v: string) => {
    const r = await updateEcritureField(ecriture.id, 'description', v);
    if (r.ok) void refreshRow?.(ecriture.id);
    return r;
  };

  const justifBlock = (
    <div ref={justifRef}>
      {detail ? (
        <JustificatifsCard
          entityId={ecriture.id}
          bundle={detail.justifsBundle}
          justifAttendu={ecriture.justif_attendu === 1}
          numeroPiece={ecriture.numero_piece}
          type={ecriture.type}
          pendingDepots={detail.pendingDepots}
          shareableDepots={detail.shareableDepots}
          ecritureAmountCents={ecriture.amount_cents}
          ecritureDate={ecriture.date_ecriture}
          defaultOpenActions={focusSection === 'justif'}
        />
      ) : (
        <div className="flex items-center gap-2 text-[12px] text-fg-muted py-3">
          <Loader2 size={14} className="animate-spin" /> Chargement des justificatifs…
        </div>
      )}
      {isAdmin && justifMissing && (
        <div className="mt-2">
          <PanelRelance ecritureId={ecriture.id} defaultOpen={focusSection === 'justif'} />
        </div>
      )}
    </div>
  );

  const cwPayload: CwAssistPayload = {
    date_ecriture: ecriture.date_ecriture,
    description: ecriture.description,
    amount_cents: ecriture.amount_cents,
    type: ecriture.type,
    category_id: ecriture.category_id,
    mode_paiement_id: ecriture.mode_paiement_id,
    unite_id: ecriture.unite_id,
    activite_id: ecriture.activite_id,
    carte_id: ecriture.carte_id,
    numero_piece: ecriture.numero_piece,
    notes: ecriture.notes,
    justif_attendu: ecriture.justif_attendu === 1,
  };

  return (
    <div className="rounded-xl border border-border-soft bg-bg-elevated shadow-sm p-3.5 my-1 text-left max-h-[72vh] overflow-y-auto">
      <PanelHeader ecriture={ecriture} vm={vm} readiness={readiness} onRename={onRename} onCollapse={onCollapse} />

      {vm.mode === 'readonly' ? (
        <div className="space-y-4">
          <PanelReadonlySummary ecriture={ecriture} />
          {justifBlock}
          <div className="pt-3 border-t border-border-soft space-y-3">
            <CwAssistActions payload={cwPayload} />
            <div className="flex flex-wrap items-center gap-2">
              {ecriture.comptaweb_ecriture_id != null && <ResyncEcritureButton ecritureId={ecriture.id} />}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* JUSTIF D'ABORD (le travail restant se fait sur la ligne) */}
          {justifBlock}

          {/* Rappel d'imputation en chips — pour un brouillon banque. En saisie
              manuelle, l'identité est le travail → on passe direct au form. */}
          {vm.mode === 'edit-bank' && (
            <PanelImputation
              ecriture={ecriture}
              categories={categories}
              unites={unites}
              modesPaiement={modesPaiement}
              activites={activites}
              cartes={cartes}
              editable={vm.editable}
              missingFields={readiness.missingFields}
              refreshRow={refreshRow}
            />
          )}

          {/* Détails / édition complète. Ouvert d'emblée en saisie manuelle
              (identité prioritaire), replié pour un brouillon banque. */}
          <details open={vm.showIdentityInline} className="group">
            <summary className="flex items-center gap-1.5 cursor-pointer list-none text-[12px] font-medium text-fg-muted hover:text-fg py-1">
              <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
              {vm.showIdentityInline ? 'Champs de l’écriture' : 'Éditer les champs (date, montant, type, notes…)'}
            </summary>
            <div className="pt-2">
              <EcritureForm
                action={async (fd) => {
                  await updateEcriture(ecriture.id, fd);
                  await refreshRow?.(ecriture.id);
                }}
                categories={categories}
                topCategoryIds={topCategoryIds}
                unites={unites}
                modesPaiement={modesPaiement}
                activites={activites}
                cartes={cartes}
                ecriture={ecriture}
              />
              <div className="mt-3">
                <CwAssistActions payload={cwPayload} />
              </div>
            </div>
          </details>

          {/* Barre d'action collante : UN seul « Valider » (= crée dans
              Comptaweb, comme la ligne). Le reste (prévisualiser, marquer
              prêt/miroir, repasser brouillon) dans le menu ⋯. */}
          <div className="sticky bottom-0 -mx-3.5 -mb-3.5 mt-1 px-3.5 py-2.5 bg-bg-elevated/95 backdrop-blur border-t border-border-soft flex flex-wrap items-center gap-2">
            {!ecriture.comptaweb_ecriture_id && (
              <PanelValiderButton
                ecritureId={ecriture.id}
                disabled={readiness.level === 'incomplete'}
                missing={readiness.missingFields}
                onValidate={onValidate}
                onDone={onCollapse}
              />
            )}
            {ecriture.comptaweb_ecriture_id != null && <ResyncEcritureButton ecritureId={ecriture.id} />}
            <div className="ml-auto flex items-center gap-2">
              <PanelMoreMenu ecriture={ecriture} onDone={() => void refreshRow?.(ecriture.id)} />
              {ecriture.status === 'draft' && <DeleteDraftButton ecritureId={ecriture.id} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
