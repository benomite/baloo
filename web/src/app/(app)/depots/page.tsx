import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { listDepots, listCandidateEcritures, type DepotEnriched } from '@/lib/services/depots';
import { rejectDepot, attachDepotToEcriture } from '@/lib/actions/depots';
import { formatAmount } from '@/lib/format';
import { Amount } from '@/components/shared/amount';
import { DataField } from '@/components/shared/field';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { Alert } from '@/components/ui/alert';

interface SearchParams {
  error?: string;
  rejected?: string;
  attached?: string;
}

// `formatAmount` est encore utilisé pour les `<option>` (texte uniquement,
// pas de JSX possible) — ailleurs, on préfère <Amount/>.

function formatDate(date: string | null): string {
  if (!date) return '—';
  return date;
}

export default async function DepotsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const params = await searchParams;
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
    <div>
      <PageHeader title="Dépôts à traiter" />

      {params.error && <Alert variant="error" className="mb-4">{params.error}</Alert>}
      {params.rejected && <Alert variant="warning" className="mb-4">Dépôt {params.rejected} rejeté.</Alert>}
      {params.attached && <Alert variant="success" className="mb-4">Dépôt {params.attached} rattaché à une écriture.</Alert>}

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
  return (
    <li className="border rounded-lg p-4 bg-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="font-semibold">{depot.titre}</h3>
          {depot.description && (
            <p className="text-sm text-muted-foreground mt-1">{depot.description}</p>
          )}
          <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <DataField label="Déposé par" value={depot.submitter_name ?? depot.submitter_email} />
            <DataField label="Montant" value={depot.amount_cents !== null ? <Amount cents={depot.amount_cents} /> : '—'} />
            <DataField label="Date" value={formatDate(depot.date_estimee)} />
            <DataField label="Unité" value={depot.unite_code ?? '—'} />
            <DataField label="Catégorie" value={depot.category_name ?? '—'} />
            <DataField label="Carte" value={depot.carte_label ?? '—'} />
            <DataField label="Déposé le" value={depot.created_at.slice(0, 10)} />
            <DataField
              label="Justif"
              value={
                depot.justif_path ? (
                  <Link
                    href={`/api/justificatifs/${depot.justif_path}`}
                    className="text-blue-600 underline"
                    target="_blank"
                  >
                    Voir
                  </Link>
                ) : (
                  '— manquant'
                )
              }
            />
          </dl>
        </div>
      </div>

      <div className="mt-4 flex gap-2 flex-wrap">
        <details className="flex-1 min-w-[260px] border rounded p-2">
          <summary className="cursor-pointer text-sm font-medium">Rattacher à une écriture</summary>
          <form action={attachDepotToEcriture} className="mt-3 space-y-2">
            <input type="hidden" name="depot_id" value={depot.id} />
            <Label htmlFor={`ecriture-${depot.id}`} className="text-xs">Écriture candidate</Label>
            <select
              id={`ecriture-${depot.id}`}
              name="ecriture_id"
              required
              className="w-full border rounded px-2 py-1 text-sm bg-background"
              defaultValue=""
            >
              <option value="" disabled>— Choisir une écriture —</option>
              {candidates.length === 0 && <option disabled>(aucune écriture sans justif ne matche)</option>}
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.date_ecriture} · {formatAmount(c.amount_cents)} · {c.description.slice(0, 50)}
                  {c.unite_code ? ` (${c.unite_code})` : ''}
                </option>
              ))}
            </select>
            <PendingButton size="sm">Rattacher</PendingButton>
            <p className="text-xs text-muted-foreground">
              Tolérance ±10 % sur le montant et ±15 jours sur la date.
            </p>
          </form>
        </details>

        <details className="flex-1 min-w-[260px] border rounded p-2">
          <summary className="cursor-pointer text-sm font-medium text-red-600">Rejeter</summary>
          <form action={rejectDepot} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={depot.id} />
            <Label htmlFor={`motif-${depot.id}`} className="text-xs">Motif du rejet</Label>
            <Input
              id={`motif-${depot.id}`}
              name="motif"
              required
              placeholder="Ex. justif illisible, hors scope, doublon"
            />
            <PendingButton variant="destructive" size="sm">Rejeter</PendingButton>
          </form>
        </details>
      </div>
    </li>
  );
}

