'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { Link2, Paperclip, X } from 'lucide-react';
import { Amount } from '@/components/shared/amount';
import { PendingButton } from '@/components/shared/pending-button';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  lierEcritureJustif,
  markerJustifNonAttendu,
  rejeterDepotInbox,
} from '@/lib/actions/inbox';
import type {
  InboxEcriture,
  InboxJustif,
  InboxPeriod,
} from '@/lib/queries/inbox';

// Sélection croisée + modale de confirmation pour les liaisons
// "louches" (écart de montant > 5 % ou écart de date > 30 j). Le
// matching reste possible sans contrainte (cas demande déc. → paiement
// mai), la modale n'est qu'un garde-fou ergonomique contre le clic
// raté.

const MODAL_AMOUNT_THRESHOLD_PCT = 5;
const MODAL_DATE_THRESHOLD_DAYS = 30;

interface Props {
  ecritures: InboxEcriture[];
  justifs: InboxJustif[];
  period: InboxPeriod;
  includeRecettes: boolean;
  truncated: number;
}

export function InboxBoard({
  ecritures,
  justifs,
  period,
  includeRecettes,
  truncated,
}: Props) {
  const [selEcr, setSelEcr] = useState<string | null>(null);
  const [selJustif, setSelJustif] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [, startLink] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const ecr = ecritures.find((e) => e.id === selEcr) ?? null;
  const justif = justifs.find((j) => j.id === selJustif) ?? null;
  const canLier = ecr !== null && justif !== null;

  let amountDiffPct = 0;
  let dateDiffDays = 0;
  if (ecr && justif) {
    const eAmount = Math.abs(ecr.amount_cents);
    if (justif.amount_cents != null && eAmount > 0) {
      const jAmount = Math.abs(justif.amount_cents);
      amountDiffPct = Math.round((Math.abs(eAmount - jAmount) / eAmount) * 100);
    }
    if (justif.date_estimee) {
      dateDiffDays = Math.round(
        Math.abs(
          new Date(ecr.date_ecriture).getTime() -
            new Date(justif.date_estimee).getTime(),
        ) /
          (1000 * 60 * 60 * 24),
      );
    }
  }
  const needsConfirm =
    canLier &&
    (amountDiffPct > MODAL_AMOUNT_THRESHOLD_PCT ||
      dateDiffDays > MODAL_DATE_THRESHOLD_DAYS);

  function tryLier() {
    if (!canLier) return;
    if (needsConfirm) {
      setConfirmOpen(true);
      return;
    }
    submit();
  }

  function submit() {
    setConfirmOpen(false);
    startLink(() => {
      formRef.current?.requestSubmit();
    });
  }

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 pb-24 sm:pb-20">
        <EcrituresColumn
          ecritures={ecritures}
          truncated={truncated}
          period={period}
          includeRecettes={includeRecettes}
          selectedId={selEcr}
          onToggle={(id) => {
            setSelEcr((prev) => (prev === id ? null : id));
          }}
          highlightedAgainst={justif}
        />
        <JustifsColumn
          justifs={justifs}
          period={period}
          includeRecettes={includeRecettes}
          selectedId={selJustif}
          onToggle={(id) => {
            setSelJustif((prev) => (prev === id ? null : id));
          }}
          highlightedAgainst={ecr}
        />
      </div>

      {/* Form caché qui porte la soumission ; les hiddens reflètent
          la sélection courante. */}
      <form ref={formRef} action={lierEcritureJustif} className="hidden">
        <input type="hidden" name="ecriture_id" value={selEcr ?? ''} />
        <input type="hidden" name="depot_id" value={selJustif ?? ''} />
        <input type="hidden" name="return_period" value={period} />
        <input
          type="hidden"
          name="return_recettes"
          value={includeRecettes ? '1' : '0'}
        />
      </form>

      {canLier && (
        <FloatingLinkBar
          ecriture={ecr!}
          justif={justif!}
          amountDiffPct={amountDiffPct}
          dateDiffDays={dateDiffDays}
          onLier={tryLier}
          onCancel={() => {
            setSelEcr(null);
            setSelJustif(null);
          }}
        />
      )}

      {confirmOpen && canLier && (
        <ConfirmModal
          ecriture={ecr!}
          justif={justif!}
          amountDiffPct={amountDiffPct}
          dateDiffDays={dateDiffDays}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={submit}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Colonnes
// ────────────────────────────────────────────────────────────────────

function EcrituresColumn({
  ecritures,
  truncated,
  period,
  includeRecettes,
  selectedId,
  onToggle,
  highlightedAgainst,
}: {
  ecritures: InboxEcriture[];
  truncated: number;
  period: InboxPeriod;
  includeRecettes: boolean;
  selectedId: string | null;
  onToggle: (id: string) => void;
  highlightedAgainst: InboxJustif | null;
}) {
  return (
    <section>
      <SectionTitle
        icon="🏦"
        label={`Écritures sans justif (${ecritures.length}${truncated > 0 ? `+${truncated}` : ''})`}
        sub="Lignes remontées de la banque. Clique pour sélectionner."
      />
      {ecritures.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-soft px-4 py-6 text-center text-[13px] text-fg-muted">
          Aucune écriture en attente de justif sur cette période.
        </p>
      ) : (
        <ul className="divide-y divide-border-soft rounded-xl border border-border-soft bg-bg-elevated overflow-hidden">
          {ecritures.map((ecr) => {
            const isSelected = selectedId === ecr.id;
            const score = highlightedAgainst
              ? proximityHint(ecr, highlightedAgainst)
              : null;
            return (
              <li key={ecr.id}>
                <div
                  className={cn(
                    'group/row relative px-4 py-3 transition-colors',
                    isSelected
                      ? 'bg-brand-50 ring-2 ring-inset ring-brand'
                      : score === 'good'
                        ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                        : 'hover:bg-bg-sunken/40',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(ecr.id)}
                    aria-pressed={isSelected}
                    className="block w-full text-left"
                  >
                    <EcritureSummary ecriture={ecr} />
                  </button>
                  <form
                    action={markerJustifNonAttendu}
                    className="absolute right-2 top-2 opacity-0 group-hover/row:opacity-100 transition-opacity"
                  >
                    <input type="hidden" name="ecriture_id" value={ecr.id} />
                    <input type="hidden" name="return_period" value={period} />
                    <input
                      type="hidden"
                      name="return_recettes"
                      value={includeRecettes ? '1' : '0'}
                    />
                    <PendingButton
                      size="sm"
                      variant="ghost"
                      title="Cette écriture n'a pas besoin de justif"
                    >
                      <X size={11} strokeWidth={2} className="mr-1" />
                      Pas de justif
                    </PendingButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {truncated > 0 && (
        <p className="mt-2 text-[12px] text-fg-subtle">
          {truncated} écriture{truncated > 1 ? 's' : ''} plus ancienne
          {truncated > 1 ? 's' : ''} masquée{truncated > 1 ? 's' : ''} —{' '}
          {period !== 'tout' ? (
            <Link href="/inbox?period=tout" className="text-brand underline">
              voir tout l’historique
            </Link>
          ) : (
            'élargis ton filtre ou marque-en certaines comme "Pas de justif".'
          )}
        </p>
      )}
    </section>
  );
}

function JustifsColumn({
  justifs,
  period,
  includeRecettes,
  selectedId,
  onToggle,
  highlightedAgainst,
}: {
  justifs: InboxJustif[];
  period: InboxPeriod;
  includeRecettes: boolean;
  selectedId: string | null;
  onToggle: (id: string) => void;
  highlightedAgainst: InboxEcriture | null;
}) {
  return (
    <section>
      <SectionTitle
        icon="📎"
        label={`Justifs orphelins (${justifs.length})`}
        sub="Reçus déposés par les chefs. Clique pour sélectionner."
      />
      {justifs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-soft px-4 py-6 text-center text-[13px] text-fg-muted">
          Aucun justif en attente d&apos;écriture.
        </p>
      ) : (
        <ul className="divide-y divide-border-soft rounded-xl border border-border-soft bg-bg-elevated overflow-hidden">
          {justifs.map((j) => {
            const isSelected = selectedId === j.id;
            const score = highlightedAgainst
              ? proximityHintReverse(j, highlightedAgainst)
              : null;
            return (
              <li key={j.id}>
                <div
                  className={cn(
                    'group/row relative px-4 py-3 transition-colors',
                    isSelected
                      ? 'bg-brand-50 ring-2 ring-inset ring-brand'
                      : score === 'good'
                        ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                        : 'hover:bg-bg-sunken/40',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(j.id)}
                    aria-pressed={isSelected}
                    className="block w-full text-left"
                  >
                    <JustifSummary justif={j} />
                  </button>
                  <form
                    action={rejeterDepotInbox}
                    className="absolute right-2 top-2 opacity-0 group-hover/row:opacity-100 transition-opacity"
                  >
                    <input type="hidden" name="depot_id" value={j.id} />
                    <input type="hidden" name="return_period" value={period} />
                    <input
                      type="hidden"
                      name="return_recettes"
                      value={includeRecettes ? '1' : '0'}
                    />
                    <PendingButton
                      size="sm"
                      variant="ghost"
                      title="Ce justif n'est pas pour Baloo"
                    >
                      <X size={11} strokeWidth={2} className="mr-1" />
                      Pas pour Baloo
                    </PendingButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Bouton flottant + modale
// ────────────────────────────────────────────────────────────────────

function FloatingLinkBar({
  ecriture,
  justif,
  amountDiffPct,
  dateDiffDays,
  onLier,
  onCancel,
}: {
  ecriture: InboxEcriture;
  justif: InboxJustif;
  amountDiffPct: number;
  dateDiffDays: number;
  onLier: () => void;
  onCancel: () => void;
}) {
  const showWarn =
    amountDiffPct > MODAL_AMOUNT_THRESHOLD_PCT ||
    dateDiffDays > MODAL_DATE_THRESHOLD_DAYS;
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center pointer-events-none">
      <div className="pointer-events-auto rounded-xl border border-border bg-bg-elevated shadow-lg px-4 py-3 flex flex-wrap items-center gap-3 max-w-[min(92vw,640px)]">
        <span className="text-[12.5px] text-fg-muted">
          {formatAmount(Math.abs(ecriture.amount_cents))}{' '}
          <span className="text-fg-subtle">vs</span>{' '}
          {justif.amount_cents != null
            ? formatAmount(Math.abs(justif.amount_cents))
            : '?'}
          {showWarn && (
            <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10.5px] font-medium dark:bg-amber-950/30 dark:text-amber-200">
              ⚠ {amountDiffPct > 0 && `${amountDiffPct} %`}
              {amountDiffPct > 0 && dateDiffDays > 0 && ' · '}
              {dateDiffDays > 0 && `${dateDiffDays} j`}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] text-fg-muted hover:text-fg underline-offset-2 hover:underline"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onLier}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-brand text-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-brand/90 transition-colors"
        >
          <Link2 size={12} strokeWidth={2.25} />
          Lier ces 2
        </button>
      </div>
    </div>
  );
}

function ConfirmModal({
  ecriture,
  justif,
  amountDiffPct,
  dateDiffDays,
  onCancel,
  onConfirm,
}: {
  ecriture: InboxEcriture;
  justif: InboxJustif;
  amountDiffPct: number;
  dateDiffDays: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-bg-elevated shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold text-fg">Lier ces deux éléments ?</h2>
        <p className="mt-1 text-[12.5px] text-fg-muted">
          L&apos;écart est inhabituel — vérifie que c&apos;est bien la même opération.
        </p>
        <ul className="mt-3 space-y-1.5 text-[12.5px]">
          {amountDiffPct > MODAL_AMOUNT_THRESHOLD_PCT && (
            <li className="text-amber-900 dark:text-amber-200">
              ⚠ Écart de montant : {amountDiffPct} %
            </li>
          )}
          {dateDiffDays > MODAL_DATE_THRESHOLD_DAYS && (
            <li className="text-amber-900 dark:text-amber-200">
              ⚠ Écart de date : {dateDiffDays} jours
            </li>
          )}
        </ul>
        <div className="mt-4 rounded-lg border border-border-soft bg-bg-sunken/40 p-3 space-y-2 text-[12.5px]">
          <div>
            <span className="text-fg-subtle">Banque :</span> {ecriture.date_ecriture}
            {' · '}
            <span className="font-medium tabular-nums">
              <Amount
                cents={ecriture.amount_cents}
                tone={ecriture.type === 'depense' ? 'negative' : 'positive'}
              />
            </span>
            <div className="text-fg-muted truncate">{ecriture.description}</div>
          </div>
          <div>
            <span className="text-fg-subtle">Justif :</span>{' '}
            {justif.date_estimee ?? '?'}
            {' · '}
            <span className="font-medium tabular-nums">
              {justif.amount_cents != null ? (
                <Amount cents={justif.amount_cents} />
              ) : (
                '?'
              )}
            </span>
            <div className="text-fg-muted truncate">{justif.titre}</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-fg-muted hover:bg-fg/[0.04]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-brand text-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-brand/90"
          >
            Oui, lier quand même
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sous-composants & helpers
// ────────────────────────────────────────────────────────────────────

function SectionTitle({
  icon,
  label,
  sub,
}: {
  icon: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-[13px] font-semibold tracking-tight text-fg flex items-center gap-2">
        <span aria-hidden>{icon}</span>
        {label}
      </h2>
      <p className="text-[12px] text-fg-subtle">{sub}</p>
    </div>
  );
}

function EcritureSummary({ ecriture }: { ecriture: InboxEcriture }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0 pr-24">
      <span className="tabular-nums text-[12px] text-fg-subtle shrink-0">
        {ecriture.date_ecriture}
      </span>
      <span className="flex-1 min-w-0 truncate text-[13px] text-fg">
        {ecriture.description}
      </span>
      {ecriture.unite_code && (
        <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10.5px] font-medium text-brand">
          {ecriture.unite_code}
        </span>
      )}
      <span className="tabular-nums font-semibold text-[13.5px] shrink-0">
        <Amount
          cents={ecriture.amount_cents}
          tone={ecriture.type === 'depense' ? 'negative' : 'positive'}
        />
      </span>
    </div>
  );
}

function JustifSummary({ justif }: { justif: InboxJustif }) {
  const submitter = justif.submitter_name ?? justif.submitter_email;
  return (
    <div className="min-w-0 pr-24">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="flex-1 min-w-0 truncate text-[13px] text-fg">
          {justif.titre}
        </span>
        {justif.amount_cents != null && (
          <span className="tabular-nums font-semibold text-[13.5px] shrink-0">
            <Amount cents={justif.amount_cents} />
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
        <span>{submitter}</span>
        {justif.date_estimee && (
          <span className="tabular-nums">· {justif.date_estimee}</span>
        )}
        {justif.unite_code && (
          <span className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand">
            {justif.unite_code}
          </span>
        )}
        {justif.justif_path && (
          <Link
            href={`/api/justificatifs/${justif.justif_path}`}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto inline-flex items-center gap-1 text-brand hover:underline underline-offset-2"
          >
            <Paperclip size={11} strokeWidth={1.75} />
            voir
          </Link>
        )}
      </div>
    </div>
  );
}

// "Bons candidats" mis en surbrillance verte douce dès qu'on a sélectionné
// un élément de l'autre côté : montant ±10 % et date ±15 j.
function proximityHint(ecr: InboxEcriture, j: InboxJustif): 'good' | null {
  if (j.amount_cents == null || j.date_estimee == null) return null;
  const eA = Math.abs(ecr.amount_cents);
  const jA = Math.abs(j.amount_cents);
  if (eA === 0) return null;
  const amountOk = Math.abs(eA - jA) / eA <= 0.1;
  const dateOk =
    Math.abs(
      new Date(ecr.date_ecriture).getTime() -
        new Date(j.date_estimee).getTime(),
    ) /
      (1000 * 60 * 60 * 24) <=
    15;
  return amountOk && dateOk ? 'good' : null;
}

function proximityHintReverse(j: InboxJustif, ecr: InboxEcriture): 'good' | null {
  return proximityHint(ecr, j);
}
