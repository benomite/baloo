import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/shared/amount';
import { StatCard } from '@/components/shared/stat-card';
import { getOverview } from '@/lib/queries/overview';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  FileQuestion,
  Scale,
  Upload,
} from 'lucide-react';

export default async function DashboardPage() {
  const ctx = await getCurrentContext();
  requireNotParent(ctx.role);
  const data = await getOverview();

  return (
    <div>
      <PageHeader title="Tableau de bord" />

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Dépenses"
          icon={ArrowDownCircle}
          value={<Amount cents={data.totalDepenses} tone="negative" />}
        />
        <StatCard
          label="Recettes"
          icon={ArrowUpCircle}
          value={<Amount cents={data.totalRecettes} tone="positive" />}
        />
        <StatCard
          label="Solde"
          icon={Scale}
          value={<Amount cents={data.solde} tone="signed" />}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Remb. en attente"
          icon={Clock}
          value={data.remboursementsEnAttente.count}
          sublabel={data.remboursementsEnAttente.totalFormatted}
        />
        <StatCard
          label="Sans justificatif"
          icon={FileQuestion}
          value={data.alertes.depensesSansJustificatif}
          sublabel="dépenses"
        />
        <StatCard
          label="Non saisies Comptaweb"
          icon={Upload}
          value={data.alertes.nonSyncComptaweb}
          sublabel="écritures validées"
        />
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
                  <TableCell className="text-right"><Amount cents={u.depenses} tone="negative" /></TableCell>
                  <TableCell className="text-right"><Amount cents={u.recettes} tone="positive" /></TableCell>
                  <TableCell className="text-right font-medium"><Amount cents={u.solde} tone="signed" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.dernierImport ? (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-muted-foreground/70" />
          Dernier import Comptaweb : {data.dernierImport.date} ({data.dernierImport.fichier})
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Aucun import Comptaweb. <a href="/import" className="underline underline-offset-2 hover:text-foreground">Importer un CSV</a>
        </p>
      )}
    </div>
  );
}
