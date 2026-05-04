import Link from 'next/link';
import { HandCoins, Inbox, Paperclip, Receipt, XCircle } from 'lucide-react';
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
        <ul className="divide-y divide-border-soft rounded-lg border border-border-soft bg-bg-elevated overflow-hidden">
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

  const meta = [
    depot.date_estimee,
    depot.unite_code,
    depot.category_name,
    depot.submitter_name ?? depot.submitter_email,
    depot.carte_label,
  ].filter(Boolean) as string[];

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-[13.5px] text-fg flex-1 min-w-0 truncate">
          {depot.titre}
        </span>
        {depot.amount_cents !== null && (
          <span className="tabular-nums font-medium text-[13.5px] text-fg">
            <Amount cents={depot.amount_cents} />
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <Inbox size={10} strokeWidth={2.25} />
          à traiter
        </span>
      </div>

      {(depot.description || meta.length > 0) && (
        <div className="mt-0.5 text-[12px] text-fg-muted flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {depot.description && <span className="italic">{depot.description}</span>}
          {meta.map((m, i) => (
            <span key={i} className="tabular-nums">
              {i > 0 || depot.description ? '· ' : ''}
              {m}
            </span>
          ))}
          {depot.justif_path && (
            <Link
              href={`/api/justificatifs/${depot.justif_path}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-brand hover:underline underline-offset-2"
            >
              · <Paperclip size={11} strokeWidth={1.75} /> fichier
            </Link>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
        <ActionDetails
          label="Rattacher à une écriture"
          icon={<Receipt size={12} strokeWidth={2} />}
          tone="brand"
        >
          <form action={attachDepotToEcriture} className="space-y-3 mt-2">
            <input type="hidden" name="depot_id" value={depot.id} />
            <Field label="Écriture candidate" htmlFor={`ecriture-${depot.id}`} required>
              <NativeSelect
                id={`ecriture-${depot.id}`}
                name="ecriture_id"
                required
                defaultValue=""
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
            </Field>
            <p className="text-[11px] text-fg-subtle">
              Suggestions = ±10 % sur le montant, ±15 jours sur la date.
            </p>
            <div className="flex justify-end">
              <PendingButton size="sm">Rattacher</PendingButton>
            </div>
          </form>
        </ActionDetails>

        <ActionDetails
          label="Rattacher à une demande"
          icon={<HandCoins size={12} strokeWidth={2} />}
          tone="brand"
        >
          <form action={attachDepotToRemboursement} className="space-y-3 mt-2">
            <input type="hidden" name="depot_id" value={depot.id} />
            <Field label="Demande de remboursement" htmlFor={`remb-${depot.id}`} required>
              <NativeSelect
                id={`remb-${depot.id}`}
                name="remboursement_id"
                required
                defaultValue=""
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
            </Field>
            <p className="text-[11px] text-fg-subtle">
              Demandes encore actives (pas terminées ni refusées).
              Suggestions = ±10 % sur le total, ±15 jours sur la date.
            </p>
            <div className="flex justify-end">
              <PendingButton size="sm">Rattacher</PendingButton>
            </div>
          </form>
        </ActionDetails>

        <ActionDetails
          label="Rejeter"
          icon={<XCircle size={12} strokeWidth={2} />}
          tone="destructive"
        >
          <form action={rejectDepot} className="space-y-3 mt-2">
            <input type="hidden" name="id" value={depot.id} />
            <Field label="Motif du rejet" htmlFor={`motif-${depot.id}`} required>
              <Input
                id={`motif-${depot.id}`}
                name="motif"
                required
                placeholder="Ex. justif illisible, hors scope, doublon"
              />
            </Field>
            <div className="flex justify-end">
              <PendingButton variant="destructive" size="sm">
                Rejeter
              </PendingButton>
            </div>
          </form>
        </ActionDetails>
      </div>
    </li>
  );
}

function ActionDetails({
  label,
  icon,
  tone,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  tone: 'brand' | 'destructive';
  children: React.ReactNode;
}) {
  const summaryClass =
    tone === 'destructive'
      ? 'text-destructive hover:underline'
      : 'text-brand hover:underline';
  return (
    <details className="group w-full">
      <summary
        className={`cursor-pointer list-none inline-flex items-center gap-1 font-medium underline-offset-2 ${summaryClass}`}
      >
        <span className="transition-transform group-open:rotate-90 inline-block">▸</span>
        {icon}
        {label}
      </summary>
      <div className="mt-2 pl-4 border-l border-border-soft">{children}</div>
    </details>
  );
}
