import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createRemboursement } from '@/lib/actions/remboursements';
import { listUnites, listModesPaiement } from '@/lib/queries/reference';

export default async function NouveauRemboursementPage() {
  const unites = await listUnites();
  const modes = await listModesPaiement();

  return (
    <div>
      <PageHeader title="Nouveau remboursement" />
      <form action={createRemboursement} className="space-y-4 max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="demandeur">Demandeur</Label>
            <Input id="demandeur" name="demandeur" required placeholder="Prénom Nom" />
          </div>
          <div>
            <Label htmlFor="date_depense">Date de la dépense</Label>
            <Input type="date" id="date_depense" name="date_depense" required defaultValue={new Date().toISOString().split('T')[0]} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="montant">Montant</Label>
            <Input id="montant" name="montant" required placeholder="42,50" />
          </div>
          <div>
            <Label htmlFor="nature">Nature</Label>
            <Input id="nature" name="nature" required placeholder="transport, intendance..." />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="unite_id">Unité</Label>
            <select name="unite_id" id="unite_id" className="w-full border rounded px-3 py-2">
              <option value="">— Aucune —</option>
              {unites.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="mode_paiement_id">Mode de remboursement</Label>
            <select name="mode_paiement_id" id="mode_paiement_id" className="w-full border rounded px-3 py-2">
              <option value="">— Par défaut (virement) —</option>
              {modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={3} />
        </div>
        <Button type="submit">Créer</Button>
      </form>
    </div>
  );
}
