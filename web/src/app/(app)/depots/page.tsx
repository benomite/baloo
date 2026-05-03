import Link from 'next/link';
import { Inbox, Paperclip, Receipt, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { Section } from '@/components/shared/section';
import { Field, DataField } from '@/components/shared/field';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { listDepots, listCandidateEcritures, type DepotEnriched } from '@/lib/services/depots';
import { rejectDepot, attachDepotToEcriture } from '@/lib/actions/depots';
import { formatAmount } from '@/lib/format';

interface SearchParams {
  error?: string;
  rejected?: string;
  attached?: string;
}

// `formatAmount` est encore utilisé pour les `<option>` (texte uniquement,
// pas de JSX possible) — ailleurs, on préfère <Amount/>.

export default async function DepotsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);
  const depots = await listDepots({ groupId: ctx.groupId }, { statut: 'a_traiter' });

  // Pour chaque dépôt, on précharge les candidats. N+1 acceptable pour
  // le volume attendu (rarement > 30 dépôts en attente).
  const candidates = await Promise.all(
    depots.map((d) =>
      listCandidateEcritures(
        { groupId: ctx.groupId },
        { amount_cents: d.amount_cents, date_estimee: d.date_estimee },
      ),
    ),
  );

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
          Dépôt <code className="font-mono text-[12.5px] font-medium">{params.rejected}</code>{' '}
          rejeté.
        </Alert>
      )}
      {params.attached && (
        <Alert variant="success" className="mb-4">
          Dépôt <code className="font-mono text-[12.5px] font-medium">{params.attached}</code>{' '}
          rattaché à une écriture.
        </Alert>
      )}

      {depots.length === 0 ? (
        <EmptyState
          emoji="🐻"
          title="Boîte vide, ours satisfait"
          description="Tous les justificatifs déposés ont été traités. Profite-en pour respirer."
        />
      ) : (
        <ul className="space-y-4">
          {depots.map((d, idx) => (
            <DepotCard key={d.id} depot={d} candidates={candidates[idx]} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DepotCard({
  depot,
  candidates,
}: {
  depot: DepotEnriched;
  candidates: Awaited<ReturnType<typeof listCandidateEcritures>>;
}) {
  const justifLink = depot.justif_path ? (
    <Link
      href={`/api/justificatifs/${depot.justif_path}`}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1.5 text-brand hover:underline underline-offset-2"
    >
      <Paperclip size={12} strokeWidth={1.75} />
      Voir le fichier
    </Link>
  ) : (
    <span className="text-fg-subtle italic">manquant</span>
  );

  return (
    <li>
      <Section
        title={depot.titre}
        subtitle={depot.description ?? undefined}
        action={
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            <Inbox size={11} strokeWidth={2.25} />à traiter
          </span>
        }
      >
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-[12.5px]">
          <DataField
            label="Déposé par"
            value={depot.submitter_name ?? depot.submitter_email}
          />
          <DataField
            label="Montant"
            value={
              depot.amount_cents !== null ? (
                <span className="tabular-nums font-medium text-fg">
                  <Amount cents={depot.amount_cents} />
                </span>
              ) : (
                '—'
              )
            }
          />
          <DataField
            label="Date estimée"
            value={
              <span className="tabular-nums">{depot.date_estimee ?? '—'}</span>
            }
          />
          <DataField label="Unité" value={depot.unite_code ?? '—'} />
          <DataField label="Catégorie" value={depot.category_name ?? '—'} />
          <DataField label="Carte" value={depot.carte_label ?? '—'} />
          <DataField
            label="Déposé le"
            value={
              <span className="tabular-nums">{depot.created_at.slice(0, 10)}</span>
            }
          />
          <DataField label="Justif" value={justifLink} />
        </dl>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border-soft">
          <details className="rounded-md border border-border-soft bg-bg-sunken/40 px-3 py-2.5 group">
            <summary className="cursor-pointer text-[13px] font-medium text-fg list-none flex items-center gap-1.5">
              <Receipt size={13} strokeWidth={2} className="text-brand" />
              Rattacher à une écriture
            </summary>
            <form action={attachDepotToEcriture} className="mt-3 space-y-3">
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
                  {candidates.length === 0 && (
                    <option disabled>(aucune écriture sans justif ne matche)</option>
                  )}
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.date_ecriture} · {formatAmount(c.amount_cents)} ·{' '}
                      {c.description.length > 50
                        ? c.description.slice(0, 50) + '…'
                        : c.description}
                      {c.unite_code ? ` (${c.unite_code})` : ''}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <p className="text-[11.5px] text-fg-subtle">
                Tolérance ±10 % sur le montant et ±15 jours sur la date.
              </p>
              <div className="flex justify-end">
                <PendingButton size="sm">Rattacher</PendingButton>
              </div>
            </form>
          </details>

          <details className="rounded-md border border-border-soft bg-bg-sunken/40 px-3 py-2.5 group">
            <summary className="cursor-pointer text-[13px] font-medium text-destructive list-none flex items-center gap-1.5">
              <XCircle size={13} strokeWidth={2} />
              Rejeter
            </summary>
            <form action={rejectDepot} className="mt-3 space-y-3">
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
          </details>
        </div>
      </Section>
    </li>
  );
}
