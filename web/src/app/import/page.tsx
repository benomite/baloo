import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/lib/db';
import { formatAmount } from '@/lib/format';

export default function ImportPage() {
  const imports = getDb().prepare(
    'SELECT * FROM comptaweb_imports ORDER BY import_date DESC'
  ).all() as { id: string; import_date: string; source_file: string; row_count: number; total_depenses_cents: number; total_recettes_cents: number }[];

  return (
    <div>
      <PageHeader title="Import Comptaweb" />

      <Card className="mb-8">
        <CardHeader><CardTitle>Importer un fichier CSV</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Exporte le fichier &quot;Gestion courante — Recettes/Dépenses&quot; depuis Comptaweb au format CSV,
            puis dépose-le dans le dossier <code>inbox/</code> et utilise le MCP <code>import_comptaweb_csv</code> via Claude Code.
          </p>
          <p className="text-sm text-muted-foreground">
            L&apos;import par upload direct dans cette interface arrive bientôt.
          </p>
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold mb-4">Imports précédents</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Fichier</TableHead>
            <TableHead className="text-right">Lignes</TableHead>
            <TableHead className="text-right">Dépenses</TableHead>
            <TableHead className="text-right">Recettes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {imports.map(i => (
            <TableRow key={i.id}>
              <TableCell>{i.import_date}</TableCell>
              <TableCell>{i.source_file}</TableCell>
              <TableCell className="text-right">{i.row_count}</TableCell>
              <TableCell className="text-right text-red-600">{formatAmount(i.total_depenses_cents)}</TableCell>
              <TableCell className="text-right text-green-600">{formatAmount(i.total_recettes_cents)}</TableCell>
            </TableRow>
          ))}
          {imports.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Aucun import</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
