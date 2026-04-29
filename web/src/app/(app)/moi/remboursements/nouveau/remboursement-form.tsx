'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface UniteOption {
  id: string;
  code: string;
  name: string;
}

interface DefaultIdentity {
  prenom: string;
  nom: string;
  email: string;
}

interface Props {
  action: (formData: FormData) => Promise<void>;
  unites: UniteOption[];
  scopeUniteId: string | null;
  defaultIdentity: DefaultIdentity;
  today: string;
}

interface Ligne {
  key: number;
  date: string;
  montant: string;
  nature: string;
}

let _rowSeq = 0;
function newRow(today: string): Ligne {
  return { key: ++_rowSeq, date: today, montant: '', nature: '' };
}

export function RemboursementForm({
  action,
  unites,
  scopeUniteId,
  defaultIdentity,
  today,
}: Props) {
  const [lignes, setLignes] = useState<Ligne[]>(() => [newRow(today)]);

  const total = lignes
    .reduce((s, l) => {
      const v = parseFloat(l.montant.replace(',', '.').replace(/\s/g, ''));
      return s + (isFinite(v) ? v : 0);
    }, 0);

  const updateLigne = (key: number, patch: Partial<Ligne>) => {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removeLigne = (key: number) => {
    setLignes((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  };

  return (
    <form action={action} encType="multipart/form-data" className="space-y-6">
      <fieldset className="space-y-3 border rounded p-4">
        <legend className="text-sm font-semibold px-2">Demandeur</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="prenom">Prénom</Label>
            <Input id="prenom" name="prenom" defaultValue={defaultIdentity.prenom} required />
          </div>
          <div>
            <Label htmlFor="nom">Nom</Label>
            <Input id="nom" name="nom" defaultValue={defaultIdentity.nom} required />
          </div>
        </div>
        <div>
          <Label htmlFor="email">Email *</Label>
          <Input id="email" name="email" type="email" defaultValue={defaultIdentity.email} required />
        </div>
      </fieldset>

      <fieldset className="space-y-3 border rounded p-4">
        <legend className="text-sm font-semibold px-2">Détail des dépenses</legend>
        <input type="hidden" name="ligne_count" value={lignes.length} />
        <div className="space-y-3">
          {lignes.map((l, i) => (
            <div key={l.key} className="grid grid-cols-[100px_1fr_110px_auto] gap-2 items-end">
              <div>
                {i === 0 && <Label className="text-xs">Date</Label>}
                <Input
                  type="date"
                  name={`ligne_${i}_date`}
                  required
                  value={l.date}
                  onChange={(e) => updateLigne(l.key, { date: e.target.value })}
                />
              </div>
              <div>
                {i === 0 && <Label className="text-xs">Nature</Label>}
                <Input
                  name={`ligne_${i}_nature`}
                  required
                  placeholder="Ex. tickets métro, péage, intendance"
                  value={l.nature}
                  onChange={(e) => updateLigne(l.key, { nature: e.target.value })}
                />
              </div>
              <div>
                {i === 0 && <Label className="text-xs">Montant TTC</Label>}
                <Input
                  name={`ligne_${i}_montant`}
                  required
                  inputMode="decimal"
                  placeholder="42,50"
                  value={l.montant}
                  onChange={(e) => updateLigne(l.key, { montant: e.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeLigne(l.key)}
                disabled={lignes.length === 1}
                aria-label="Supprimer la ligne"
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center pt-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLignes((prev) => [...prev, newRow(today)])}>
            + Ajouter une ligne
          </Button>
          <div className="text-sm">
            <span className="text-muted-foreground">Total : </span>
            <span className="font-semibold">{total.toFixed(2).replace('.', ',')} €</span>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border rounded p-4">
        <legend className="text-sm font-semibold px-2">Justificatifs</legend>
        <p className="text-xs text-muted-foreground">
          Joins toutes les photos / PDF de tickets, factures et reçus. Tu peux en sélectionner plusieurs d&apos;un coup.
        </p>
        <Input id="justifs" name="justifs" type="file" accept="image/*,application/pdf" multiple required />
      </fieldset>

      <fieldset className="space-y-3 border rounded p-4">
        <legend className="text-sm font-semibold px-2">Coordonnées bancaires</legend>
        <div>
          <Label htmlFor="rib_texte">IBAN / BIC (texte)</Label>
          <Textarea id="rib_texte" name="rib_texte" rows={2} placeholder="FR76 ... · BIC ... · Banque ..." />
        </div>
        <div>
          <Label htmlFor="rib_file">RIB (fichier — optionnel si IBAN renseigné)</Label>
          <Input id="rib_file" name="rib_file" type="file" accept="image/*,application/pdf" />
        </div>
      </fieldset>

      {!scopeUniteId && unites.length > 0 && (
        <div>
          <Label htmlFor="unite_id">Unité concernée (optionnel)</Label>
          <select id="unite_id" name="unite_id" className="w-full border rounded px-3 py-2 bg-background">
            <option value="">— Aucune / groupe —</option>
            {unites.map((u) => (
              <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <Label htmlFor="notes">Notes (optionnel)</Label>
        <Textarea id="notes" name="notes" rows={2} placeholder="Précisions libres" />
      </div>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="certif" required className="mt-1" />
        <span>Je certifie l&apos;exactitude des informations ci-dessus.</span>
      </label>

      <Button type="submit">Envoyer la demande</Button>
    </form>
  );
}
