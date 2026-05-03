import Link from 'next/link';
import { Unlink } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { RemboursementStatusBadge } from '@/components/shared/status-badge';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { TabLink } from '@/components/shared/tab-link';
import { listRemboursements } from '@/lib/queries/remboursements';
import { getDb } from '@/lib/db';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';

const ADMIN_ROLES = ['tresorier', 'RG'];

export default async function RemboursementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireNotParent(ctx.role);
  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const unlinkedFilter = params.unlinked === '1';

  // Compteur "à rattacher" affiché sur le tab pour donner la visibilité
  // sans devoir cliquer (utile pour le trésorier qui voit l'app
  // chaque jour). Visible aux admins seulement.
  const [remboursements, unlinkedCountRow] = await Promise.all([
    listRemboursements({
      status: params.status || undefined,
      unite_id: params.unite_id || undefined,
      search: params.search || undefined,
      unlinkedOnly: unlinkedFilter,
    }),
    isAdmin
      ? getDb()
          .prepare(
            `SELECT COUNT(*) AS n FROM remboursements
             WHERE group_id = ? AND ecriture_id IS NULL
               AND status IN ('virement_effectue', 'termine')`,
          )
          .get<{ n: number }>(ctx.groupId)
      : Promise.resolve(null),
  ]);
  const unlinkedCount = unlinkedCountRow?.n ?? 0;

  return (
    <div>
      <PageHeader title="Remboursements">
        <Link href="/moi/remboursements/nouveau">
          <Button>Nouvelle demande</Button>
        </Link>
      </PageHeader>

      {isAdmin && (
        <div className="mb-4 flex flex-wrap gap-6 border-b">
          <TabLink href="/remboursements" active={!unlinkedFilter}>
            Toutes
          </TabLink>
          <TabLink href="/remboursements?unlinked=1" active={unlinkedFilter}>
            <span className="inline-flex items-center gap-1.5">
              À rattacher
              {unlinkedCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 text-[10.5px] font-semibold px-1.5 min-w-[18px] h-[18px]">
                  {unlinkedCount}
                </span>
              )}
            </span>
          </TabLink>
        </div>
      )}

      {remboursements.length === 0 ? (
        unlinkedFilter ? (
          <EmptyState
            emoji="🎯"
            title="Tout est rattaché"
            description="Aucune demande virée n'attend d'écriture comptable. Bon boulot."
          />
        ) : (
          <EmptyState
            emoji="📭"
            title="Pas de remboursement à traiter"
            description="Personne n'a déposé de demande pour le moment. Tu peux en saisir une pour autrui."
            action={
              <Link href="/moi/remboursements/nouveau">
                <Button size="sm">Nouvelle demande</Button>
              </Link>
            }
          />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Demandeur</TableHead>
              <TableHead>Nature</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead>Unité</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Justif.</TableHead>
              {isAdmin && <TableHead>Écriture</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {remboursements.map((r) => {
              const needsLink =
                !r.ecriture_id &&
                (r.status === 'virement_effectue' || r.status === 'termine');
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{r.date_depense}</TableCell>
                  <TableCell>
                    <Link
                      href={`/remboursements/${r.id}`}
                      className="hover:underline font-medium"
                    >
                      {r.demandeur}
                    </Link>
                  </TableCell>
                  <TableCell>{r.nature}</TableCell>
                  <TableCell className="text-right font-medium">
                    <Amount cents={r.amount_cents} />
                  </TableCell>
                  <TableCell>{r.unite_code ?? '—'}</TableCell>
                  <TableCell>
                    <RemboursementStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    {r.justificatif_status === 'oui'
                      ? '✓'
                      : r.justificatif_status === 'en_attente'
                        ? '⏳'
                        : '✗'}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      {r.ecriture_id ? (
                        <Link
                          href={`/ecritures/${r.ecriture_id}`}
                          className="text-[12.5px] font-mono text-brand hover:underline"
                        >
                          {r.ecriture_id}
                        </Link>
                      ) : needsLink ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11.5px] text-amber-700 dark:text-amber-300"
                          title="Cette demande a été virée mais n'est pas liée à une écriture comptable."
                        >
                          <Unlink size={12} strokeWidth={2} />
                          à rattacher
                        </span>
                      ) : (
                        <span className="text-fg-subtle text-[12.5px]">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
