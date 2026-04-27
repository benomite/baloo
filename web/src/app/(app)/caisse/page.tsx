import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { listMouvementsCaisse } from '@/lib/queries/caisse';
import { createMouvementCaisse } from '@/lib/actions/caisse';
import { formatAmount } from '@/lib/format';

export default async function CaissePage() {
  const { mouvements, solde } = await listMouvementsCaisse();

  return (
    <div>
      <PageHeader title="Caisse" />

      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Solde caisse</CardTitle></CardHeader>
        <CardContent><div className={`text-3xl font-bold ${solde >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatAmount(solde)}</div></CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>Nouveau mouvement</CardTitle></CardHeader>
        <CardContent>
          <form action={createMouvementCaisse} className="flex items-end gap-4">
            <div>
              <Label htmlFor="date_mouvement">Date</Label>
              <Input type="date" id="date_mouvement" name="date_mouvement" required defaultValue={new Date().toISOString().split('T')[0]} />
            </div>
            <div className="flex-1">
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" required />
            </div>
            <div className="w-32">
              <Label htmlFor="montant">Montant</Label>
              <Input id="montant" name="montant" required placeholder="+15 ou -8,50" />
            </div>
            <Button type="submit">Ajouter</Button>
          </form>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead className="text-right">Solde après</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mouvements.map(m => (
            <TableRow key={m.id}>
              <TableCell>{m.date_mouvement}</TableCell>
              <TableCell>{m.description}</TableCell>
              <TableCell className={`text-right font-medium ${m.amount_cents >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatAmount(m.amount_cents)}</TableCell>
              <TableCell className="text-right">{m.solde_apres_cents != null ? formatAmount(m.solde_apres_cents) : '—'}</TableCell>
            </TableRow>
          ))}
          {mouvements.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Aucun mouvement</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
