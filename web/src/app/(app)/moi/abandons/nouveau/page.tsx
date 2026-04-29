import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentContext } from '@/lib/context';
import { listUnites } from '@/lib/queries/reference';
import { createMyAbandon } from '@/lib/actions/abandons';

interface SearchParams {
  error?: string;
}

export default async function MyNouveauAbandonPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  if (ctx.role === 'parent') redirect('/moi');

  const params = await searchParams;
  const unites = await listUnites();
  const today = new Date().toISOString().split('T')[0];
  const defaultUnite = ctx.scopeUniteId ?? '';

  return (
    <div className="max-w-2xl">
      <PageHeader title="Abandon de frais (don au groupe)" />

      <p className="text-sm text-muted-foreground mb-6">
        Tu as avancé des frais pour le groupe et tu souhaites en faire don plutôt que d&apos;être
        remboursé ? Tu recevras un reçu fiscal (CERFA) qui te permet de déduire 66 % du montant
        de tes impôts. Joins le justificatif de la dépense.
      </p>

      {params.error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {params.error}
        </p>
      )}

      <form action={createMyAbandon} encType="multipart/form-data" className="space-y-4">
        <div>
          <Label htmlFor="file">Justificatif (photo ou PDF) *</Label>
          <Input id="file" name="file" type="file" accept="image/*,application/pdf" required />
        </div>

        <div>
          <Label htmlFor="nature">Nature de la dépense *</Label>
          <Input id="nature" name="nature" required placeholder="Ex. tickets de métro, achat goûter, matériel" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="montant">Montant TTC *</Label>
            <Input id="montant" name="montant" required placeholder="42,50" inputMode="decimal" />
          </div>
          <div>
            <Label htmlFor="date_depense">Date de la dépense *</Label>
            <Input id="date_depense" name="date_depense" type="date" required defaultValue={today} />
          </div>
        </div>

        {!ctx.scopeUniteId && (
          <div>
            <Label htmlFor="unite_id">Unité concernée (optionnel)</Label>
            <select
              id="unite_id"
              name="unite_id"
              defaultValue={defaultUnite}
              className="w-full border rounded px-3 py-2 bg-background"
            >
              <option value="">— Aucune / groupe —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label htmlFor="notes">Notes (optionnel)</Label>
          <Textarea id="notes" name="notes" rows={2} />
        </div>

        <Button type="submit">Déclarer l&apos;abandon</Button>
      </form>
    </div>
  );
}
