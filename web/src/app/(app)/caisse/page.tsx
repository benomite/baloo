import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { listMouvementsCaisse } from '@/lib/queries/caisse';
import { listUnites, listActivites } from '@/lib/queries/reference';
import { createMouvementCaisse } from '@/lib/actions/caisse';
import { Amount } from '@/components/shared/amount';
import { StatCard } from '@/components/shared/stat-card';
import { Coins } from 'lucide-react';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';

export default async function CaissePage() {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);
  const [{ mouvements, solde }, unites, activites] = await Promise.all([
    listMouvementsCaisse(),
    listUnites(),
    listActivites(),
  ]);

  return (
    <div>
      <PageHeader title="Caisse" />

      <div className="mb-6 max-w-xs">
        <StatCard
          label="Solde caisse"
          icon={Coins}
          value={<Amount cents={solde} tone="signed" />}
        />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Nouveau mouvement</CardTitle></CardHeader>
        <CardContent>
          <form action={createMouvementCaisse} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="sens">Sens</Label>
                <select id="sens" name="sens" defaultValue="sortie" className="w-full border rounded px-3 py-2 bg-background">
                  <option value="entree">↗ Entrée (recette)</option>
                  <option value="sortie">↘ Sortie (dépense)</option>
                </select>
              </div>
              <div>
                <Label htmlFor="montant">Montant</Label>
                <Input id="montant" name="montant" required placeholder="15,00" inputMode="decimal" />
              </div>
              <div>
                <Label htmlFor="date_mouvement">Date</Label>
                <Input type="date" id="date_mouvement" name="date_mouvement" required defaultValue={new Date().toISOString().split('T')[0]} />
              </div>
              <div>
                <Label htmlFor="unite_id">Unité (optionnel)</Label>
                <select id="unite_id" name="unite_id" className="w-full border rounded px-3 py-2 bg-background">
                  <option value="">— Groupe —</option>
                  {unites.map((u) => (
                    <option key={u.id} value={u.id}>{u.code}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" required placeholder="Ex. quête camp été" />
              </div>
              <div>
                <Label htmlFor="activite_id">Activité (optionnel)</Label>
                <select id="activite_id" name="activite_id" className="w-full border rounded px-3 py-2 bg-background">
                  <option value="">— Aucune —</option>
                  {activites.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
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
            <TableHead>Unité</TableHead>
            <TableHead>Activité</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead className="text-right">Solde après</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mouvements.map(m => (
            <TableRow key={m.id}>
              <TableCell>{m.date_mouvement}</TableCell>
              <TableCell>{m.description}</TableCell>
              <TableCell>{m.unite_code ?? '—'}</TableCell>
              <TableCell>{m.activite_name ?? '—'}</TableCell>
              <TableCell className="text-right font-medium"><Amount cents={m.amount_cents} tone="signed" /></TableCell>
              <TableCell className="text-right">{m.solde_apres_cents != null ? <Amount cents={m.solde_apres_cents} tone="muted" /> : '—'}</TableCell>
            </TableRow>
          ))}
          {mouvements.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Aucun mouvement</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
