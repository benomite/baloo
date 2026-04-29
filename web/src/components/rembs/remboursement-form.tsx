'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FileMultiUploader } from '@/components/ui/file-multi-uploader';

interface UniteOption {
  id: string;
  code: string;
  name: string;
}

interface Identity {
  prenom: string;
  nom: string;
  email: string;
}

interface InitialLigne {
  date_depense: string;
  amount_cents: number;
  nature: string;
}

interface Props {
  action: (formData: FormData) => Promise<void>;
  unites: UniteOption[];
  today: string;
  // 'locked' = identité cachée (auto depuis user connecté, mode "ma demande")
  // 'editable' = identité visible et modifiable (mode "saisie pour autrui" ou
  // édition d'une demande existante).
  identityMode: 'locked' | 'editable';
  defaultIdentity: Identity;
  scopeUniteId?: string | null;
  // Pré-remplissage en mode édition.
  initialLignes?: InitialLigne[];
  initialRibTexte?: string | null;
  initialNotes?: string | null;
  initialUniteId?: string | null;
  // S'il y a déjà des justifs attachés (mode édition), on relâche le
  // `required` sur l'uploader.
  existingJustifsCount?: number;
  submitLabel?: string;
  // Petite intro affichée au-dessus du form (optionnel).
  introNode?: React.ReactNode;
}

interface Ligne {
  key: number;
  date: string;
  montant: string;
  nature: string;
}

let _rowSeq = 0;
function newRow(today: string, init?: InitialLigne): Ligne {
  if (init) {
    return {
      key: ++_rowSeq,
      date: init.date_depense,
      montant: (init.amount_cents / 100).toFixed(2).replace('.', ','),
      nature: init.nature,
    };
  }
  return { key: ++_rowSeq, date: today, montant: '', nature: '' };
}

export function RemboursementForm({
  action,
  unites,
  today,
  identityMode,
  defaultIdentity,
  scopeUniteId,
  initialLignes,
  initialRibTexte,
  initialNotes,
  initialUniteId,
  existingJustifsCount = 0,
  submitLabel = 'Envoyer la demande',
  introNode,
}: Props) {
  const [lignes, setLignes] = useState<Ligne[]>(() => {
    if (initialLignes && initialLignes.length > 0) return initialLignes.map((l) => newRow(today, l));
    return [newRow(today)];
  });

  const total = lignes.reduce((s, l) => {
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
      {introNode}

      {identityMode === 'editable' ? (
        <fieldset className="space-y-3 border rounded p-4">
          <legend className="text-sm font-semibold px-2">Bénéficiaire</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="prenom">Prénom *</Label>
              <Input id="prenom" name="prenom" defaultValue={defaultIdentity.prenom} required />
            </div>
            <div>
              <Label htmlFor="nom">Nom *</Label>
              <Input id="nom" name="nom" defaultValue={defaultIdentity.nom} required />
            </div>
          </div>
          <div>
            <Label htmlFor="email">Email *</Label>
            <Input id="email" name="email" type="email" defaultValue={defaultIdentity.email} required />
          </div>
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="prenom" value={defaultIdentity.prenom} />
          <input type="hidden" name="nom" value={defaultIdentity.nom} />
          <input type="hidden" name="email" value={defaultIdentity.email} />
        </>
      )}

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
        <legend className="text-sm font-semibold px-2">
          Justificatifs
          {existingJustifsCount > 0 && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({existingJustifsCount} déjà attaché{existingJustifsCount > 1 ? 's' : ''} — ajoute pour compléter)
            </span>
          )}
        </legend>
        <FileMultiUploader
          name="justifs"
          required={existingJustifsCount === 0}
          accept="image/*,application/pdf"
          helpText="Photos / PDF de tickets, factures, reçus."
        />
      </fieldset>

      <fieldset className="space-y-3 border rounded p-4">
        <legend className="text-sm font-semibold px-2">Coordonnées bancaires</legend>
        <div>
          <Label htmlFor="rib_texte">IBAN / BIC (texte)</Label>
          <Textarea
            id="rib_texte"
            name="rib_texte"
            rows={2}
            placeholder="FR76 ... · BIC ... · Banque ..."
            defaultValue={initialRibTexte ?? ''}
          />
        </div>
        <div>
          <Label htmlFor="rib_file">RIB (fichier — optionnel si IBAN renseigné)</Label>
          <Input id="rib_file" name="rib_file" type="file" accept="image/*,application/pdf" />
        </div>
      </fieldset>

      {!scopeUniteId && unites.length > 0 && (
        <div>
          <Label htmlFor="unite_id">Unité concernée (optionnel)</Label>
          <select
            id="unite_id"
            name="unite_id"
            defaultValue={initialUniteId ?? ''}
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
        <Textarea id="notes" name="notes" rows={2} placeholder="Précisions libres" defaultValue={initialNotes ?? ''} />
      </div>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="certif" required className="mt-1" />
        <span>Je certifie l&apos;exactitude des informations ci-dessus.</span>
      </label>

      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}
