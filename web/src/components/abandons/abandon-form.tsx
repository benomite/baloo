'use client';

import { Download, FileText, Info } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { FileMultiUploader } from '@/components/ui/file-multi-uploader';
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

interface Props {
  action: (formData: FormData) => Promise<void>;
  unites: UniteOption[];
  today: string;
  // Identité du donateur : préremplie avec l'utilisateur connecté
  // mais toujours modifiable (utile pour saisie pour autrui).
  defaultIdentity: Identity;
  scopeUniteId?: string | null;
  // Suggestions de nature (historique du user).
  natureSuggestions?: string[];
  // Afficher l'info-box SGDF de téléchargement du formulaire.
  showSgdfInfo?: boolean;
  submitLabel?: string;
}

export function AbandonForm({
  action,
  unites,
  today,
  defaultIdentity,
  scopeUniteId,
  natureSuggestions = [],
  showSgdfInfo = false,
  submitLabel = 'Enregistrer le don',
}: Props) {
  return (
    <form action={action} encType="multipart/form-data" className="space-y-6">
      {showSgdfInfo && (
        <Alert variant="info" icon={Info} className="mb-6">
          <div className="space-y-2">
            <p className="font-medium">Avant de remplir, télécharge le formulaire SGDF :</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <a
                href="/docs/formulaire_abandon.xlsx"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline underline-offset-2"
              >
                <Download size={13} strokeWidth={2} />
                Formulaire à compléter (xlsx)
              </a>
              <a
                href="/docs/fiche_abandon.pdf"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline underline-offset-2"
              >
                <FileText size={13} strokeWidth={2} />
                Notice explicative SGDF
              </a>
            </div>
            <p className="text-[12.5px] leading-relaxed">
              Remplis-le, signe-le, puis dépose-le ici (xlsx ou PDF scanné) avec tes justificatifs.
            </p>
          </div>
        </Alert>
      )}

      <Section
        title="Donateur"
        subtitle="Prérempli avec ton compte — modifiable si tu saisis pour quelqu'un d'autre."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Prénom" htmlFor="prenom" required>
            <Input id="prenom" name="prenom" defaultValue={defaultIdentity.prenom} required />
          </Field>
          <Field label="Nom" htmlFor="nom" required>
            <Input id="nom" name="nom" defaultValue={defaultIdentity.nom} required />
          </Field>
        </div>
        <Field label="Email" htmlFor="email" hint="optionnel — utile pour notifier le CERFA">
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaultIdentity.email}
            placeholder="prenom.nom@..."
          />
        </Field>
      </Section>

      <Section title="La dépense" subtitle="Quoi, combien, quand.">
        <Field label="Nature de la dépense" htmlFor="nature" required>
          <Input
            id="nature"
            name="nature"
            required
            placeholder="Ex. Frais km camp bleu — août 2025"
            list={natureSuggestions.length > 0 ? 'nature-suggestions' : undefined}
          />
          {natureSuggestions.length > 0 && (
            <datalist id="nature-suggestions">
              {natureSuggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Montant TTC" htmlFor="montant" required hint="format 42,50">
            <Input
              id="montant"
              name="montant"
              required
              placeholder="42,50"
              inputMode="decimal"
              className="tabular-nums"
            />
          </Field>
          <Field
            label="Date de la dépense"
            htmlFor="date_depense"
            required
            hint="détermine l'année fiscale"
          >
            <Input
              id="date_depense"
              name="date_depense"
              type="date"
              required
              defaultValue={today}
            />
          </Field>
        </div>
        {!scopeUniteId && unites.length > 0 && (
          <Field label="Unité concernée" htmlFor="unite_id" hint="optionnel">
            <NativeSelect id="unite_id" name="unite_id" defaultValue="">
              <option value="">— Aucune / groupe —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </Section>

      <Section
        title="Feuille d'abandon signée"
        subtitle="Le formulaire SGDF rempli et signé (xlsx ou PDF). Document officiel envoyé au national pour émettre le CERFA."
      >
        <Field label="Fichier" htmlFor="feuille">
          <Input
            id="feuille"
            name="feuille"
            type="file"
            accept="application/pdf,image/*,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[13px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
          />
        </Field>
      </Section>

      <Section title="Justificatifs" subtitle="Tickets, factures, copie carte grise, etc. — optionnels.">
        <FileMultiUploader
          name="justifs"
          accept="image/*,application/pdf"
          helpText="Tu peux glisser-déposer plusieurs fichiers."
        />
      </Section>

      <Section title="Notes" subtitle="Pour mémoire — optionnel.">
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder="Ex. importé d'Airtable, signé RG le 26/01/2026..."
        />
      </Section>

      <div className="flex justify-end pt-2">
        <PendingButton size="lg" pendingLabel="Création…">
          {submitLabel}
        </PendingButton>
      </div>
    </form>
  );
}
