'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FileMultiUploader } from '@/components/ui/file-multi-uploader';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { PendingButton } from '@/components/shared/pending-button';

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

      {identityMode === 'editable' && (
        <Section title="Bénéficiaire" subtitle="À qui le virement va.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Prénom" htmlFor="prenom" required>
              <Input id="prenom" name="prenom" defaultValue={defaultIdentity.prenom} required />
            </Field>
            <Field label="Nom" htmlFor="nom" required>
              <Input id="nom" name="nom" defaultValue={defaultIdentity.nom} required />
            </Field>
          </div>
          <Field label="Email" htmlFor="email" required hint="pour les notifications de validation">
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={defaultIdentity.email}
              required
            />
          </Field>
        </Section>
      )}
      {identityMode === 'locked' && (
        <>
          <input type="hidden" name="prenom" value={defaultIdentity.prenom} />
          <input type="hidden" name="nom" value={defaultIdentity.nom} />
          <input type="hidden" name="email" value={defaultIdentity.email} />
        </>
      )}

      <Section
        title="Détail des dépenses"
        subtitle="Une ligne par ticket / facture. Le total se met à jour en direct."
        action={
          <div className="text-right">
            <div className="text-overline text-fg-subtle">Total</div>
            <div className="text-display-sm tabular-nums">
              {total.toFixed(2).replace('.', ',')}&nbsp;€
            </div>
          </div>
        }
      >
        <input type="hidden" name="ligne_count" value={lignes.length} />
        <div className="space-y-3">
          {lignes.map((l, i) => (
            <div
              key={l.key}
              className="grid grid-cols-[100px_1fr_110px_auto] sm:grid-cols-[120px_1fr_120px_auto] gap-2 sm:gap-3 items-end"
            >
              <Field label={i === 0 ? 'Date' : ''} htmlFor={`ligne_${i}_date`} required={i === 0}>
                <Input
                  type="date"
                  id={`ligne_${i}_date`}
                  name={`ligne_${i}_date`}
                  required
                  value={l.date}
                  onChange={(e) => updateLigne(l.key, { date: e.target.value })}
                />
              </Field>
              <Field label={i === 0 ? 'Nature' : ''} htmlFor={`ligne_${i}_nature`} required={i === 0}>
                <Input
                  id={`ligne_${i}_nature`}
                  name={`ligne_${i}_nature`}
                  required
                  placeholder="Ex. tickets métro, péage, intendance"
                  value={l.nature}
                  onChange={(e) => updateLigne(l.key, { nature: e.target.value })}
                />
              </Field>
              <Field
                label={i === 0 ? 'Montant TTC' : ''}
                htmlFor={`ligne_${i}_montant`}
                required={i === 0}
              >
                <Input
                  id={`ligne_${i}_montant`}
                  name={`ligne_${i}_montant`}
                  required
                  inputMode="decimal"
                  placeholder="42,50"
                  value={l.montant}
                  onChange={(e) => updateLigne(l.key, { montant: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeLigne(l.key)}
                disabled={lignes.length === 1}
                aria-label="Supprimer la ligne"
                className="mb-px text-fg-subtle hover:text-destructive"
              >
                <X size={15} strokeWidth={2} />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLignes((prev) => [...prev, newRow(today)])}
          className="mt-2"
        >
          <Plus size={14} strokeWidth={2} className="mr-1" />
          Ajouter une ligne
        </Button>
      </Section>

      <Section
        title="Justificatifs"
        subtitle={
          existingJustifsCount > 0
            ? `${existingJustifsCount} déjà attaché${existingJustifsCount > 1 ? 's' : ''} — ajoute pour compléter.`
            : 'Photos ou PDFs des tickets, factures, reçus.'
        }
      >
        <FileMultiUploader
          name="justifs"
          required={existingJustifsCount === 0}
          accept="image/*,application/pdf"
          helpText="Tu peux glisser-déposer plusieurs fichiers d'un coup."
        />
      </Section>

      <Section
        title="Coordonnées bancaires"
        subtitle="Pour le virement. Au moins l'IBAN ou un fichier RIB."
      >
        <Field label="IBAN / BIC (texte)" htmlFor="rib_texte">
          <Textarea
            id="rib_texte"
            name="rib_texte"
            rows={2}
            placeholder="FR76 ... · BIC ... · Banque ..."
            defaultValue={initialRibTexte ?? ''}
          />
        </Field>
        <Field label="RIB (fichier)" htmlFor="rib_file" hint="optionnel si IBAN renseigné">
          <Input
            id="rib_file"
            name="rib_file"
            type="file"
            accept="image/*,application/pdf"
            className="file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[13px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
          />
        </Field>
      </Section>

      <Section title="Détails" subtitle="Quelques infos pour aider le trésorier.">
        {!scopeUniteId && unites.length > 0 && (
          <Field label="Unité concernée" htmlFor="unite_id" hint="optionnel">
            <NativeSelect
              id="unite_id"
              name="unite_id"
              defaultValue={initialUniteId ?? ''}
            >
              <option value="">— Aucune / groupe —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label="Notes" htmlFor="notes" hint="optionnel">
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            placeholder="Précisions libres"
            defaultValue={initialNotes ?? ''}
          />
        </Field>
      </Section>

      <div className="rounded-lg border border-border bg-bg-sunken/60 px-4 py-3">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            name="certif"
            required
            className="mt-0.5 h-4 w-4 rounded border-border-strong text-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />
          <span className="text-[13px] text-fg-muted leading-relaxed">
            Je certifie l&apos;exactitude des informations ci-dessus et la réalité des dépenses
            engagées pour le compte du groupe.
          </span>
        </label>
      </div>

      <div className="flex justify-end pt-2">
        <PendingButton size="lg" pendingLabel="Envoi…">
          {submitLabel}
        </PendingButton>
      </div>
    </form>
  );
}

