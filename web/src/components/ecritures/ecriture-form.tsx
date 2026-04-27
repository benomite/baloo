'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Category, Unite, ModePaiement, Activite, Carte, Ecriture } from '@/lib/types';

export function EcritureForm({ action, categories, unites, modesPaiement, activites, cartes, ecriture }: {
  action: (formData: FormData) => void;
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  ecriture?: Ecriture;
}) {
  const amountStr = ecriture ? `${Math.floor(ecriture.amount_cents / 100)},${String(ecriture.amount_cents % 100).padStart(2, '0')}` : '';
  const locked = ecriture?.status === 'saisie_comptaweb';

  return (
    <form action={action} className="space-y-4 max-w-2xl">
      {locked && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          🔒 Écriture synchronisée Comptaweb — les champs sync sont en lecture seule. Seuls les justificatifs, le flag « justif attendu » et les notes restent modifiables.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="date_ecriture">Date</Label>
          <Input type="date" id="date_ecriture" name="date_ecriture" required defaultValue={ecriture?.date_ecriture ?? new Date().toISOString().split('T')[0]} disabled={locked} />
        </div>
        <div>
          <Label htmlFor="type">Type</Label>
          <select name="type" id="type" className="w-full border rounded px-3 py-2 disabled:bg-muted disabled:text-muted-foreground" defaultValue={ecriture?.type ?? 'depense'} disabled={locked}>
            <option value="depense">Dépense</option>
            <option value="recette">Recette</option>
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" required defaultValue={ecriture?.description ?? ''} disabled={locked} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="montant">Montant</Label>
          <Input id="montant" name="montant" required placeholder="42,50" defaultValue={amountStr} disabled={locked} />
        </div>
        <div>
          <Label htmlFor="unite_id">Unité</Label>
          <select name="unite_id" id="unite_id" className="w-full border rounded px-3 py-2 disabled:bg-muted disabled:text-muted-foreground" defaultValue={ecriture?.unite_id ?? ''} disabled={locked}>
            <option value="">— Aucune —</option>
            {unites.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="category_id">Catégorie</Label>
          <select name="category_id" id="category_id" className="w-full border rounded px-3 py-2 disabled:bg-muted disabled:text-muted-foreground" defaultValue={ecriture?.category_id ?? ''} disabled={locked}>
            <option value="">— Aucune —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="mode_paiement_id">Mode de paiement</Label>
          <select name="mode_paiement_id" id="mode_paiement_id" className="w-full border rounded px-3 py-2 disabled:bg-muted disabled:text-muted-foreground" defaultValue={ecriture?.mode_paiement_id ?? ''} disabled={locked}>
            <option value="">— Aucun —</option>
            {modesPaiement.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="activite_id">Activité</Label>
          <select name="activite_id" id="activite_id" className="w-full border rounded px-3 py-2 disabled:bg-muted disabled:text-muted-foreground" defaultValue={ecriture?.activite_id ?? ''} disabled={locked}>
            <option value="">— Aucune —</option>
            {activites.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="numero_piece">N° pièce</Label>
          <Input id="numero_piece" name="numero_piece" defaultValue={ecriture?.numero_piece ?? ''} placeholder="Code Comptaweb si document pas encore reçu" disabled={locked} />
        </div>
      </div>

      <div>
        <Label htmlFor="carte_id">Carte (si paiement par CB ou procurement)</Label>
        <select name="carte_id" id="carte_id" className="w-full border rounded px-3 py-2 disabled:bg-muted disabled:text-muted-foreground" defaultValue={ecriture?.carte_id ?? ''} disabled={locked}>
          <option value="">— Aucune —</option>
          {cartes.map(c => (
            <option key={c.id} value={c.id}>
              {c.type === 'procurement' ? 'Procurement' : 'CB'} — {c.porteur}
              {c.code_externe ? ` (${c.code_externe})` : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          Pré-rempli automatiquement pour les paiements procurement (reconnaissance du code dans l'intitulé bancaire).
        </p>
      </div>

      <div className="rounded border p-3 bg-muted/30">
        <label className="flex items-start gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            name="justif_attendu"
            defaultChecked={ecriture ? ecriture.justif_attendu === 1 : true}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Justificatif attendu pour cette écriture</span>
            <span className="block text-muted-foreground text-xs mt-0.5">
              Cocher = justif requis (tant qu'un fichier n'est pas rattaché, l'écriture reste dans « À compléter »). Décocher pour un prélèvement auto SGDF / flux territoire qui n'aura pas de pièce.
            </span>
          </span>
        </label>
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={ecriture?.notes ?? ''} />
      </div>

      <Button type="submit">{ecriture ? 'Enregistrer' : 'Créer'}</Button>
    </form>
  );
}
