import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { EcritureStatusBadge } from '@/components/shared/status-badge';
import { listEcritures } from '@/lib/queries/ecritures';
import { listCategories, listUnites } from '@/lib/queries/reference';
import { formatAmount } from '@/lib/format';
import { EcritureFilters } from '@/components/ecritures/ecriture-filters';
import { ScanDraftsButton } from '@/components/ecritures/scan-drafts-button';

export default async function EcrituresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const filters = {
    type: params.type || undefined,
    unite_id: params.unite_id || undefined,
    category_id: params.category_id || undefined,
    status: params.status || undefined,
    search: params.search || undefined,
    incomplete: params.incomplete === '1',
    from_bank: params.from_bank === '1',
    limit: 200,
  };
  const { ecritures, total } = listEcritures(filters);
  const categories = listCategories();
  const unites = listUnites();

  const presetQS = (preset: 'all' | 'incomplete' | 'from_bank') => {
    const sp = new URLSearchParams();
    if (preset === 'incomplete') sp.set('incomplete', '1');
    if (preset === 'from_bank') sp.set('from_bank', '1');
    return sp.toString() ? `?${sp.toString()}` : '';
  };

  return (
    <div>
      <PageHeader title="Écritures">
        <ScanDraftsButton />
        <Link href="/ecritures/nouveau"><Button>Nouvelle écriture</Button></Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={`/ecritures${presetQS('all')}`}>
          <Button variant={!filters.incomplete && !filters.from_bank ? 'default' : 'outline'} size="sm">Toutes</Button>
        </Link>
        <Link href={`/ecritures${presetQS('incomplete')}`}>
          <Button variant={filters.incomplete ? 'default' : 'outline'} size="sm">À compléter</Button>
        </Link>
        <Link href={`/ecritures${presetQS('from_bank')}`}>
          <Button variant={filters.from_bank ? 'default' : 'outline'} size="sm">Issues de la banque</Button>
        </Link>
      </div>

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
            <TableHead>À compléter</TableHead>
            <TableHead className="text-center">Src</TableHead>
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
              <TableCell className="text-xs">
                {e.missing_fields && e.missing_fields.length > 0 ? (
                  <span className="inline-flex flex-wrap gap-1">
                    {e.missing_fields.map((f) => (
                      <span key={f} className="inline-block rounded bg-orange-100 text-orange-800 px-1.5 py-0.5">{f}</span>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-center" title={e.ligne_bancaire_id ? `Ligne bancaire ${e.ligne_bancaire_id}${e.ligne_bancaire_sous_index !== null ? ` sous-ligne ${e.ligne_bancaire_sous_index}` : ''}` : ''}>
                {e.ligne_bancaire_id ? '🏦' : '—'}
              </TableCell>
              <TableCell className="text-center">{e.comptaweb_synced ? '✓' : '—'}</TableCell>
              <TableCell className="text-center">
                {e.has_justificatif ? (
                  <span title="Justificatif rattaché">📎</span>
                ) : e.justif_attendu === 0 ? (
                  <span title="Justificatif non attendu" className="text-muted-foreground">🚫</span>
                ) : e.numero_piece ? (
                  <span title={`En attente — code Comptaweb ${e.numero_piece}`} className="text-amber-600">⌛</span>
                ) : (
                  <span title="Justificatif manquant" className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {ecritures.length === 0 && (
            <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Aucune écriture</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
