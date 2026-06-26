'use client';

import { useActionState, useState } from 'react';
import { Plus, X, Car } from 'lucide-react';
import { computeKmAmountCents, formatKmRate } from '@/lib/services/km';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { FileMultiUploader } from '@/components/ui/file-multi-uploader';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { PendingButton } from '@/components/shared/pending-button';
import { validateClientFile } from '@/lib/justif-allowed';

// État renvoyé par les server actions du form en cas d'échec de
// validation. `null` = pas encore soumis / succès (le succès redirige).
export type RembFormState = { error: string } | null;

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
  type?: 'depense' | 'km';
  distance_km_dixiemes?: number | null;
}

interface Props {
  // Server action au format `useActionState` : en cas d'erreur de
  // validation elle retourne `{ error }` (affiché inline, sans recharger
  // la page → le form n'est pas vidé) ; en cas de succès elle redirige.
  action: (state: RembFormState, formData: FormData) => Promise<RembFormState>;
  unites: UniteOption[];
  today: string;
  // Identité du bénéficiaire : préremplie avec l'utilisateur connecté
  // mais toujours modifiable.
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
  tauxKmMillicents: number;
}

interface Ligne {
  key: number;
  type: 'depense' | 'km';
  date: string;
  montant: string; // dépense
  km: string;      // kilométrique (saisie km)
  nature: string;
}

let _rowSeq = 0;
function newRow(today: string, init?: InitialLigne): Ligne {
  if (init) {
    const type = init.type === 'km' ? 'km' : 'depense';
    return {
      key: ++_rowSeq,
      type,
      date: init.date_depense,
      montant: type === 'depense' ? (init.amount_cents / 100).toFixed(2).replace('.', ',') : '',
      km: type === 'km' && init.distance_km_dixiemes != null
        ? (init.distance_km_dixiemes / 10).toString().replace('.', ',')
        : '',
      nature: init.nature,
    };
  }
  return { key: ++_rowSeq, type: 'depense', date: today, montant: '', km: '', nature: '' };
}

export function RemboursementForm({
  action,
  unites,
  today,
  defaultIdentity,
  scopeUniteId,
  initialLignes,
  initialRibTexte,
  initialNotes,
  initialUniteId,
  existingJustifsCount = 0,
  submitLabel = 'Envoyer la demande',
  introNode,
  tauxKmMillicents,
}: Props) {
  const [state, formAction] = useActionState(action, null);
  const [ribFileError, setRibFileError] = useState<string | null>(null);

  // Champs contrôlés : React réinitialise les inputs NON contrôlés d'un
  // `<form action>` après l'exécution de l'action (y compris sur erreur).
  // En les contrôlant, leur valeur survit à un retour `{ error }` → le
  // formulaire n'est jamais vidé.
  const [prenom, setPrenom] = useState(defaultIdentity.prenom);
  const [nom, setNom] = useState(defaultIdentity.nom);
  const [email, setEmail] = useState(defaultIdentity.email);
  const [ribTexte, setRibTexte] = useState(initialRibTexte ?? '');
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [uniteId, setUniteId] = useState(initialUniteId ?? '');
  const [certif, setCertif] = useState(false);

  const [lignes, setLignes] = useState<Ligne[]>(() => {
    if (initialLignes && initialLignes.length > 0) return initialLignes.map((l) => newRow(today, l));
    return [newRow(today)];
  });

  const ligneAmountCents = (l: Ligne): number => {
    if (l.type === 'km') {
      const km = parseFloat(l.km.replace(',', '.').replace(/\s/g, ''));
      if (!isFinite(km) || km <= 0) return 0;
      return computeKmAmountCents(Math.round(km * 10), tauxKmMillicents);
    }
    const v = parseFloat(l.montant.replace(',', '.').replace(/\s/g, ''));
    return isFinite(v) ? Math.round(v * 100) : 0;
  };
  const totalCents = lignes.reduce((s, l) => s + ligneAmountCents(l), 0);
  const hasKm = lignes.some((l) => l.type === 'km');

  const updateLigne = (key: number, patch: Partial<Ligne>) => {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removeLigne = (key: number) => {
    setLignes((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  };

  return (
    <form action={formAction} encType="multipart/form-data" className="space-y-6">
      {introNode}

      {state?.error && (
        <Alert variant="error">{state.error}</Alert>
      )}

      <Section title="Bénéficiaire" subtitle="Prérempli avec ton compte — modifiable si tu saisis pour quelqu'un d'autre.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Prénom" htmlFor="prenom" required>
            <Input
              id="prenom"
              name="prenom"
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              required
            />
          </Field>
          <Field label="Nom" htmlFor="nom" required>
            <Input
              id="nom"
              name="nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Email" htmlFor="email" required hint="pour les notifications de validation">
          <Input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
      </Section>

      <Section
        title="Détail des dépenses"
        subtitle="Une ligne par ticket / facture. Le total se met à jour en direct."
        action={
          <div className="text-right">
            <div className="text-overline text-fg-subtle">Total</div>
            <div className="text-display-sm tabular-nums">
              {(totalCents / 100).toFixed(2).replace('.', ',')}&nbsp;€
            </div>
          </div>
        }
      >
        <input type="hidden" name="ligne_count" value={lignes.length} />
        <div className="space-y-3">
          {lignes.map((l, i) => {
            // Mobile : chaque ligne = carte empilée verticalement, tous les
            // champs en pleine largeur avec leur label. Desktop (sm+) : grille
            // tabulaire à colonnes fixes, labels affichés UNIQUEMENT sur la
            // 1re ligne (les suivantes masquent leur bloc label en sm+).
            // Sans ça, sur mobile la colonne Nature (1fr) était écrasée à ~0px
            // dès la 2e ligne (label vide + Input min-w-0) → champ non saisissable.
            const hideLabelDesktop = i > 0 ? 'sm:[&>div:first-child]:hidden' : undefined;
            return (
            <div
              key={l.key}
              className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:grid sm:grid-cols-[110px_100px_1fr_140px_auto] sm:items-end sm:gap-3 sm:rounded-none sm:border-0 sm:p-0"
            >
              <Field label="Type" htmlFor={`ligne_${i}_type_sel`} className={hideLabelDesktop}>
                <NativeSelect
                  id={`ligne_${i}_type_sel`}
                  value={l.type}
                  onChange={(e) => updateLigne(l.key, { type: e.target.value === 'km' ? 'km' : 'depense' })}
                >
                  <option value="depense">Dépense</option>
                  <option value="km">Kilométrique</option>
                </NativeSelect>
              </Field>
              <input type="hidden" name={`ligne_${i}_type`} value={l.type} />
              <Field label="Date" htmlFor={`ligne_${i}_date`} required className={hideLabelDesktop}>
                <Input type="date" id={`ligne_${i}_date`} name={`ligne_${i}_date`} required
                  value={l.date} onChange={(e) => updateLigne(l.key, { date: e.target.value })} />
              </Field>
              <Field label="Nature" htmlFor={`ligne_${i}_nature`} required className={hideLabelDesktop}>
                <Input id={`ligne_${i}_nature`} name={`ligne_${i}_nature`} required
                  placeholder={l.type === 'km' ? 'Ex. trajet domicile → camp' : 'Ex. tickets métro, péage'}
                  value={l.nature} onChange={(e) => updateLigne(l.key, { nature: e.target.value })} />
              </Field>
              {l.type === 'km' ? (
                <Field label="Nb de km" htmlFor={`ligne_${i}_km`} required className={hideLabelDesktop}>
                  <Input id={`ligne_${i}_km`} name={`ligne_${i}_km`} required inputMode="decimal" placeholder="120"
                    value={l.km} onChange={(e) => updateLigne(l.key, { km: e.target.value })} className="tabular-nums" />
                  <p className="mt-1 text-[11px] text-fg-subtle tabular-nums">
                    = {(ligneAmountCents(l) / 100).toFixed(2).replace('.', ',')} € ({formatKmRate(tauxKmMillicents)}/km)
                  </p>
                </Field>
              ) : (
                <Field label="Montant TTC" htmlFor={`ligne_${i}_montant`} required className={hideLabelDesktop}>
                  <Input id={`ligne_${i}_montant`} name={`ligne_${i}_montant`} required inputMode="decimal" placeholder="42,50"
                    value={l.montant} onChange={(e) => updateLigne(l.key, { montant: e.target.value })} className="tabular-nums" />
                </Field>
              )}
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeLigne(l.key)}
                disabled={lignes.length === 1} aria-label="Supprimer la ligne"
                className="self-end mb-px text-fg-subtle hover:text-destructive">
                <X size={15} strokeWidth={2} />
              </Button>
            </div>
            );
          })}
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
        {hasKm && (
          <Alert variant="info" className="mt-3">
            <span className="inline-flex items-center gap-1.5">
              <Car size={14} strokeWidth={1.75} />
              Frais kilométriques : pense à joindre la carte grise du véhicule dans les justificatifs.
            </span>
          </Alert>
        )}
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
            value={ribTexte}
            onChange={(e) => setRibTexte(e.target.value)}
          />
        </Field>
        <Field label="RIB (fichier)" htmlFor="rib_file" hint="optionnel si IBAN renseigné">
          <Input
            id="rib_file"
            name="rib_file"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              const err = f ? validateClientFile(f) : null;
              if (err) {
                // Refus immédiat : on vide l'input pour qu'un fichier
                // invalide ne parte jamais au serveur.
                e.target.value = '';
                setRibFileError(err);
              } else {
                setRibFileError(null);
              }
            }}
            className="file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand file:font-medium file:text-[13px] file:cursor-pointer hover:file:bg-brand-100 file:transition-colors"
          />
          {ribFileError && (
            <p className="mt-1.5 text-xs text-destructive">{ribFileError}</p>
          )}
        </Field>
      </Section>

      <Section title="Détails" subtitle="Quelques infos pour aider le trésorier.">
        {!scopeUniteId && unites.length > 0 && (
          <Field label="Unité concernée" htmlFor="unite_id" hint="optionnel">
            <NativeSelect
              id="unite_id"
              name="unite_id"
              value={uniteId}
              onChange={(e) => setUniteId(e.target.value)}
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </Section>

      <div className="rounded-lg border border-border bg-bg-sunken/60 px-4 py-3">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            name="certif"
            required
            checked={certif}
            onChange={(e) => setCertif(e.target.checked)}
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

