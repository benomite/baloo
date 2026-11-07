import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { getCurrentContext } from '@/lib/context';
import { requireCanSubmit } from '@/lib/auth/access';
import { listDepots } from '@/lib/services/depots';
import { DepotStatutBadge } from '@/components/depots/depot-statut-badge';

interface SearchParams {
  error?: string;
}

// « Mes dépôts » : les justificatifs soumis par l'utilisateur courant, tous
// statuts confondus (le motif d'un rejet est visible sur le détail).
export default async function MesDepotsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, sp] = await Promise.all([getCurrentContext(), searchParams]);
  requireCanSubmit(ctx.role);
  const depots = await listDepots(
    { groupId: ctx.groupId },
    { submitted_by_user_id: ctx.userId },
  );

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Mes dépôts"
        subtitle={
          depots.length > 0
            ? `${depots.length} justificatif${depots.length > 1 ? 's' : ''} déposé${depots.length > 1 ? 's' : ''}.`
            : undefined
        }
        actions={
          <Link href="/depot">
            <Button>
              <Plus size={15} strokeWidth={2.25} />
              Nouveau dépôt
            </Button>
          </Link>
        }
      />

      {sp.error && (
        <Alert variant="error" className="mb-4">
          {sp.error}
        </Alert>
      )}

      {depots.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="Aucun dépôt"
          description="Les justificatifs que tu déposes apparaîtront ici."
        />
      ) : (
        <ul className="divide-y divide-border-soft rounded-xl border border-border-soft bg-bg-elevated overflow-hidden">
          {depots.map((d) => (
            <li key={d.id}>
              <Link
                href={`/depots/${d.id}`}
                className="flex items-baseline gap-3 px-4 py-3 transition-colors hover:bg-bg-sunken/40"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[14px] text-fg truncate">{d.titre}</div>
                  <div className="mt-0.5 text-[12px] text-fg-muted tabular-nums">
                    {d.date_estimee ?? d.created_at.slice(0, 10)}
                    {d.unite_code ? ` · ${d.unite_code}` : ''}
                  </div>
                </div>
                <DepotStatutBadge statut={d.statut} />
                {d.amount_cents !== null && (
                  <span className="tabular-nums font-semibold text-[14px] text-fg shrink-0">
                    <Amount cents={d.amount_cents} />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
