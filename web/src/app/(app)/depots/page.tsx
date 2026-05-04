import Link from 'next/link';
import { ChevronDown, FileText, Link2, Paperclip, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/shared/field';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import {
  listDepots,
  listCandidateEcritures,
  listAllAttachableEcritures,
  listCandidateRemboursements,
  listAllAttachableRemboursements,
  type DepotEnriched,
} from '@/lib/services/depots';
import {
  rejectDepot,
  attachDepotToEcriture,
  attachDepotToRemboursement,
} from '@/lib/actions/depots';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';

interface SearchParams {
  error?: string;
  rejected?: string;
  attached?: string;
}

export default async function DepotsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);
  const depots = await listDepots({ groupId: ctx.groupId }, { statut: 'a_traiter' });

  // Préchargement : suggestions matching ±10 % / ±15 j par dépôt + listes
  // élargies partagées (écritures + remboursements actifs du groupe).
  const [candidates, allEcritures, rembCandidates, allRembs] = await Promise.all([
    Promise.all(
      depots.map((d) =>
        listCandidateEcritures(
          { groupId: ctx.groupId },
          { amount_cents: d.amount_cents, date_estimee: d.date_estimee },
        ),
      ),
    ),
    listAllAttachableEcritures({ groupId: ctx.groupId }),
    Promise.all(
      depots.map((d) =>
        listCandidateRemboursements(
          { groupId: ctx.groupId },
          { amount_cents: d.amount_cents, date_estimee: d.date_estimee },
        ),
      ),
    ),
    listAllAttachableRemboursements({ groupId: ctx.groupId }),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Dépôts à traiter"
        subtitle={
          depots.length > 0
            ? `${depots.length} justificatif${depots.length > 1 ? 's' : ''} en attente de rapprochement.`
            : undefined
        }
      />

      {params.error && (
        <Alert variant="error" className="mb-4">
          {params.error}
        </Alert>
      )}
      {params.rejected && (
        <Alert variant="warning" className="mb-4">
          Dépôt <code className="font-mono text-[12.5px] font-medium">{params.rejected}</code> rejeté.
        </Alert>
      )}
      {params.attached && (
        <Alert variant="success" className="mb-4">
          Dépôt <code className="font-mono text-[12.5px] font-medium">{params.attached}</code> rattaché.
        </Alert>
      )}

      {depots.length === 0 ? (
        <EmptyState
          emoji="🐻"
          title="Boîte vide, ours satisfait"
          description="Tous les justificatifs déposés ont été traités. Profite-en pour respirer."
        />
      ) : (
        <ul className="divide-y divide-border-soft rounded-xl border border-border-soft bg-bg-elevated overflow-hidden shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          {depots.map((d, idx) => (
            <DepotRow
              key={d.id}
              depot={d}
              candidates={candidates[idx]}
              allEcritures={allEcritures}
              rembCandidates={rembCandidates[idx]}
              allRembs={allRembs}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DepotRow({
  depot,
  candidates,
  allEcritures,
  rembCandidates,
  allRembs,
}: {
  depot: DepotEnriched;
  candidates: Awaited<ReturnType<typeof listCandidateEcritures>>;
  allEcritures: Awaited<ReturnType<typeof listAllAttachableEcritures>>;
  rembCandidates: Awaited<ReturnType<typeof listCandidateRemboursements>>;
  allRembs: Awaited<ReturnType<typeof listAllAttachableRemboursements>>;
}) {
  const candidateIds = new Set(candidates.map((c) => c.id));
  const others = allEcritures.filter((e) => !candidateIds.has(e.id));
  const ecritureLabel = (
    c: Awaited<ReturnType<typeof listCandidateEcritures>>[number],
  ) => {
    const desc =
      c.description.length > 50
        ? c.description.slice(0, 50) + '…'
        : c.description;
    const unite = c.unite_code ? ` (${c.unite_code})` : '';
    const justifMark =
      c.existing_justifs_count > 0
        ? ` · ${c.existing_justifs_count} justif${c.existing_justifs_count > 1 ? 's' : ''} déjà`
        : '';
    return `${c.date_ecriture} · ${formatAmount(c.amount_cents)} · ${desc}${unite}${justifMark}`;
  };

  const rembCandidateIds = new Set(rembCandidates.map((r) => r.id));
  const otherRembs = allRembs.filter((r) => !rembCandidateIds.has(r.id));
  const rembLabel = (
    r: Awaited<ReturnType<typeof listCandidateRemboursements>>[number],
  ) => {
    const date = r.date_depense ?? '?';
    const unite = r.unite_code ? ` (${r.unite_code})` : '';
    const justifMark =
      r.existing_justifs_count > 0
        ? ` · ${r.existing_justifs_count} justif${r.existing_justifs_count > 1 ? 's' : ''} déjà`
        : '';
    return `${date} · ${formatAmount(r.total_cents)} · ${r.demandeur}${unite}${justifMark}`;
  };

  // Métadonnées en chips discrètes pour mieux scanner.
  const chips = [
    depot.date_estimee && { label: depot.date_estimee, mono: true },
    depot.unite_code && { label: depot.unite_code, accent: true },
    depot.category_name && { label: depot.category_name },
    depot.carte_label && { label: depot.carte_label },
  ].filter(Boolean) as { label: string; mono?: boolean; accent?: boolean }[];

  return (
    <li className="group/row relative px-4 py-3.5 transition-colors hover:bg-bg-sunken/40">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          {/* Header : titre + déposeur, montant aligné à droite */}
          <div className="flex items-baseline gap-3">
            <h3 className="font-semibold text-[14px] text-fg leading-tight truncate flex-1 min-w-0">
              {depot.titre}
            </h3>
            {depot.amount_cents !== null && (
              <span className="tabular-nums font-semibold text-[15px] text-fg shrink-0">
                <Amount cents={depot.amount_cents} />
              </span>
            )}
          </div>

          {depot.description && (
            <p className="mt-0.5 text-[12.5px] text-fg-muted truncate">
              {depot.description}
            </p>
          )}

          {/* Chips métadonnées + déposeur + lien fichier */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
              à traiter
            </span>
            {chips.map((c, i) => (
              <span
                key={i}
                className={cn(
                  'inline-block rounded px-1.5 py-0.5 text-[11px]',
                  c.mono && 'tabular-nums',
                  c.accent
                    ? 'bg-brand-50 text-brand font-medium'
                    : 'bg-bg-sunken text-fg-muted',
                )}
              >
                {c.label}
              </span>
            ))}
            <span className="text-[11px] text-fg-subtle">
              · {depot.submitter_name ?? depot.submitter_email}
            </span>
            {depot.justif_path && (
              <Link
                href={`/api/justificatifs/${depot.justif_path}`}
                target="_blank"
                rel="noopener"
                className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline underline-offset-2"
              >
                <Paperclip size={11} strokeWidth={1.75} />
                voir le fichier
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Barre d'actions : 1 disclosure "Rattacher" + 1 "Rejeter", à droite */}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
        <details className="group/attach relative" name={`actions-${depot.id}`}>
          <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2.5 py-1 text-[12px] font-medium text-brand transition-colors hover:bg-brand/15 group-open/attach:bg-brand group-open/attach:text-white">
            <Link2 size={12} strokeWidth={2} />
            Rattacher
            <ChevronDown size={11} strokeWidth={2.25} className="transition-transform group-open/attach:rotate-180" />
          </summary>
          <div className="mt-3 rounded-lg border border-border-soft bg-bg p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <AttachPanel
              label="à une écriture comptable"
              footer="Suggestions = ±10 % sur le montant, ±15 jours sur la date."
            >
              <form action={attachDepotToEcriture} className="space-y-2.5">
                <input type="hidden" name="depot_id" value={depot.id} />
                <NativeSelect
                  id={`ecriture-${depot.id}`}
                  name="ecriture_id"
                  required
                  defaultValue=""
                  aria-label="Écriture candidate"
                >
                  <option value="" disabled>
                    — Choisir une écriture —
                  </option>
                  <optgroup
                    label={
                      candidates.length > 0
                        ? `Suggestions (${candidates.length})`
                        : 'Suggestions (aucune)'
                    }
                  >
                    {candidates.length === 0 && (
                      <option disabled>(rien ne matche dans la tolérance)</option>
                    )}
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {ecritureLabel(c)}
                      </option>
                    ))}
                  </optgroup>
                  {others.length > 0 && (
                    <optgroup label={`Toutes les écritures (${others.length} dernières)`}>
                      {others.map((c) => (
                        <option key={c.id} value={c.id}>
                          {ecritureLabel(c)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </NativeSelect>
                <div className="flex justify-end">
                  <PendingButton size="sm">Rattacher</PendingButton>
                </div>
              </form>
            </AttachPanel>

            <AttachPanel
              label="à une demande de remboursement"
              footer="Demandes actives uniquement (non clôturées)."
            >
              <form action={attachDepotToRemboursement} className="space-y-2.5">
                <input type="hidden" name="depot_id" value={depot.id} />
                <NativeSelect
                  id={`remb-${depot.id}`}
                  name="remboursement_id"
                  required
                  defaultValue=""
                  aria-label="Demande de remboursement"
                >
                  <option value="" disabled>
                    — Choisir une demande —
                  </option>
                  <optgroup
                    label={
                      rembCandidates.length > 0
                        ? `Suggestions (${rembCandidates.length})`
                        : 'Suggestions (aucune)'
                    }
                  >
                    {rembCandidates.length === 0 && (
                      <option disabled>(rien ne matche dans la tolérance)</option>
                    )}
                    {rembCandidates.map((r) => (
                      <option key={r.id} value={r.id}>
                        {rembLabel(r)}
                      </option>
                    ))}
                  </optgroup>
                  {otherRembs.length > 0 && (
                    <optgroup label={`Toutes les demandes actives (${otherRembs.length})`}>
                      {otherRembs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {rembLabel(r)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </NativeSelect>
                <div className="flex justify-end">
                  <PendingButton size="sm">Rattacher</PendingButton>
                </div>
              </form>
            </AttachPanel>
          </div>
        </details>

        <details className="group/reject relative" name={`actions-${depot.id}`}>
          <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-fg-muted transition-colors hover:bg-destructive/10 hover:text-destructive group-open/reject:bg-destructive group-open/reject:text-white">
            <X size={12} strokeWidth={2} />
            Rejeter
          </summary>
          <form
            action={rejectDepot}
            className="mt-3 rounded-lg border border-border-soft bg-bg p-3 flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="id" value={depot.id} />
            <Field
              label="Motif du rejet"
              htmlFor={`motif-${depot.id}`}
              required
              className="flex-1 min-w-[200px] m-0"
            >
              <Input
                id={`motif-${depot.id}`}
                name="motif"
                required
                placeholder="Ex. justif illisible, hors scope, doublon"
              />
            </Field>
            <PendingButton variant="destructive" size="sm">
              Rejeter
            </PendingButton>
          </form>
        </details>
      </div>
    </li>
  );
}

function AttachPanel({
  label,
  footer,
  children,
}: {
  label: string;
  footer: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-fg-subtle font-medium mb-1.5">
        <FileText size={10} strokeWidth={2} />
        Rattacher {label}
      </div>
      {children}
      <p className="mt-1.5 text-[10.5px] text-fg-subtle">{footer}</p>
    </div>
  );
}
