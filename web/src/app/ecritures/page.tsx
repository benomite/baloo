import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { listEcritures } from '@/lib/queries/ecritures';
import { listCategories, listUnites } from '@/lib/queries/reference';
import { formatAmount } from '@/lib/format';
import { EcritureFilters } from '@/components/ecritures/ecriture-filters';

export default async function EcrituresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const filters = {
    type: params.type || undefined,
    unite_id: params.unite_id || undefined,
    category_id: params.category_id || undefined,
    status: params.status || undefined,
    search: params.search || undefined,
    limit: 100,
  };
  const { ecritures, total } = listEcritures(filters);
  const categories = listCategories();
  const unites = listUnites();

  return (
    <div>
      <PageHeader title="Écritures">
        <Link href="/ecritures/nouveau"><Button>Nouvelle écriture</Button></Link>
      </PageHeader>

      <EcritureFilters categories={categories} unites={unites} current={params} />

      <p className="text-sm text-muted-foreground mb-4">{total} écriture{total > 1 ? 's' : ''}</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead>Unité</TableHead>
            <TableHead>Catégorie</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-center">CW</TableHead>
            <TableHead className="text-center">Just.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ecritures.map(e => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap">{e.date_ecriture}</TableCell>
              <TableCell>
                <Link href={`/ecritures/${e.id}`} className="hover:underline">{e.description}</Link>
              </TableCell>
              <TableCell className={`text-right whitespace-nowrap font-medium ${e.type === 'depense' ? 'text-red-600' : 'text-green-600'}`}>
                {e.type === 'depense' ? '-' : '+'}{formatAmount(e.amount_cents)}
              </TableCell>
              <TableCell>{e.unite_code ?? '—'}</TableCell>
              <TableCell className="text-sm">{e.category_name ?? '—'}</TableCell>
              <TableCell><EcritureStatusBadge status={e.status} /></TableCell>
              <TableCell className="text-center">{e.comptaweb_synced ? '✓' : '—'}</TableCell>
              <TableCell className="text-center">{e.has_justificatif ? '📎' : '—'}</TableCell>
            </TableRow>
          ))}
          {ecritures.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Aucune écriture</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
