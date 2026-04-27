import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { getOverview } from '@/lib/queries/overview';
import { formatAmount } from '@/lib/format';

export default async function DashboardPage() {
  const data = await getOverview();

  return (
    <div>
      <PageHeader title="Tableau de bord" />

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Dépenses</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{data.totalDepensesFormatted}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Recettes</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{data.totalRecettesFormatted}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Solde</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${data.solde >= 0 ? 'text-green-600' : 'text-red-600'}`}>{data.soldeFormatted}</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Remboursements en attente</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.remboursementsEnAttente.count}</div>
            <p className="text-sm text-muted-foreground">{data.remboursementsEnAttente.totalFormatted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Sans justificatif</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.alertes.depensesSansJustificatif}</div>
            <p className="text-sm text-muted-foreground">dépenses</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Non saisies Comptaweb</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.alertes.nonSyncComptaweb}</div>
            <p className="text-sm text-muted-foreground">écritures validées</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader><CardTitle>Par unité</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unité</TableHead>
                <TableHead className="text-right">Dépenses</TableHead>
                <TableHead className="text-right">Recettes</TableHead>
                <TableHead className="text-right">Solde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.parUnite.map(u => (
                <TableRow key={u.code}>
                  <TableCell className="font-medium">{u.code} — {u.name}</TableCell>
                  <TableCell className="text-right text-red-600">{formatAmount(u.depenses)}</TableCell>
                  <TableCell className="text-right text-green-600">{formatAmount(u.recettes)}</TableCell>
                  <TableCell className={`text-right font-medium ${u.solde >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatAmount(u.solde)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.dernierImport ? (
        <p className="text-sm text-muted-foreground">
          Dernier import Comptaweb : {data.dernierImport.date} ({data.dernierImport.fichier})
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun import Comptaweb. <a href="/import" className="underline">Importer un CSV</a></p>
      )}
    </div>
  );
}
