import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentContext } from '@/lib/context';
import { requireCanSubmit } from '@/lib/auth/access';
import { listUnites, listCategories, listCartes } from '@/lib/queries/reference';
import { createDepot } from '@/lib/actions/depots';

interface SearchParams {
  error?: string;
  success?: string;
}

export default async function DepotPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getCurrentContext();
  requireCanSubmit(ctx.role);

  const params = await searchParams;
  const [unites, categories, cartes] = await Promise.all([
    listUnites(),
    listCategories(),
    listCartes(),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const defaultUnite = ctx.scopeUniteId ?? '';

  return (
    <div className="max-w-2xl">
      <PageHeader title="Déposer un justificatif" />

      <p className="text-sm text-muted-foreground mb-6">
        Photo ou PDF d&apos;un ticket / facture. Le trésorier rapprochera ensuite le justif avec
        l&apos;écriture comptable correspondante.
      </p>

      {params.error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {params.error}
        </p>
      )}
      {params.success && (
        <p className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Justificatif déposé (réf. <b>{params.success}</b>). Tu peux en déposer un autre ci-dessous.
        </p>
      )}

      <form action={createDepot} encType="multipart/form-data" className="space-y-4">
        <div>
          <Label htmlFor="file">Photo ou PDF du justificatif *</Label>
          <Input id="file" name="file" type="file" accept="image/*,application/pdf" required />
        </div>

        <div>
          <Label htmlFor="titre">Titre *</Label>
          <Input id="titre" name="titre" required placeholder="Ex. Tickets métro week-end éclais" />
        </div>

        <div>
          <Label htmlFor="description">Description (optionnel)</Label>
          <Textarea id="description" name="description" rows={2} placeholder="Détails utiles pour le trésorier" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="amount">Montant TTC (optionnel)</Label>
            <Input id="amount" name="amount" placeholder="42,50" inputMode="decimal" />
          </div>
          <div>
            <Label htmlFor="date_estimee">Date (optionnel)</Label>
            <Input id="date_estimee" name="date_estimee" type="date" defaultValue={today} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="category_id">Catégorie (optionnel)</Label>
            <select id="category_id" name="category_id" className="w-full border rounded px-3 py-2 bg-background">
              <option value="">— Aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="unite_id">Unité (optionnel)</Label>
            <select id="unite_id" name="unite_id" defaultValue={defaultUnite} className="w-full border rounded px-3 py-2 bg-background">
              <option value="">— Aucune —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="carte_id">Carte utilisée (si paiement carte)</Label>
          <select id="carte_id" name="carte_id" className="w-full border rounded px-3 py-2 bg-background">
            <option value="">— Aucune / Espèces / Virement —</option>
            {cartes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type === 'cb' ? 'CB' : 'Procurement'} · {c.porteur}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit">Déposer le justificatif</Button>
      </form>
    </div>
  );
}
