import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { RemboursementStatusBadge } from '@/components/shared/status-badge';
import { listRemboursements } from '@/lib/queries/remboursements';
import { formatAmount } from '@/lib/format';

export default async function RemboursementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const remboursements = listRemboursements({
    status: params.status || undefined,
    unite_id: params.unite_id || undefined,
    search: params.search || undefined,
  });

  return (
    <div>
      <PageHeader title="Remboursements">
        <Link href="/remboursements/nouveau"><Button>Nouveau remboursement</Button></Link>
      </PageHeader>

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
          </TableRow>
        </TableHeader>
        <TableBody>
          {remboursements.map(r => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">{r.date_depense}</TableCell>
              <TableCell>
                <Link href={`/remboursements/${r.id}`} className="hover:underline font-medium">{r.demandeur}</Link>
              </TableCell>
              <TableCell>{r.nature}</TableCell>
              <TableCell className="text-right font-medium">{formatAmount(r.amount_cents)}</TableCell>
              <TableCell>{r.unite_code ?? '—'}</TableCell>
              <TableCell><RemboursementStatusBadge status={r.status} /></TableCell>
              <TableCell>{r.justificatif_status === 'oui' ? '✓' : r.justificatif_status === 'en_attente' ? '⏳' : '✗'}</TableCell>
            </TableRow>
          ))}
          {remboursements.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Aucun remboursement</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
