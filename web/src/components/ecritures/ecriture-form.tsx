'use client';

import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import type { Category, Unite, ModePaiement, Activite, Carte, Ecriture } from '@/lib/types';

export function EcritureForm({
  action,
  categories,
  unites,
  modesPaiement,
  activites,
  cartes,
  ecriture,
}: {
  action: (formData: FormData) => void;
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  ecriture?: Ecriture;
}) {
  const amountStr = ecriture
    ? `${Math.floor(ecriture.amount_cents / 100)},${String(ecriture.amount_cents % 100).padStart(2, '0')}`
    : '';
  const locked = ecriture?.status === 'saisie_comptaweb';

  return (
    <form action={action} className="space-y-6">
      {locked && (
        <Alert variant="warning" icon={Lock}>
          Écriture synchronisée Comptaweb — les champs sync sont en lecture seule. Seuls les
          justificatifs, le flag « justif attendu » et les notes restent modifiables.
        </Alert>
      )}

      <Section title="Identité" subtitle="Quoi, quand, combien.">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" htmlFor="date_ecriture" required>
            <Input
              type="date"
              id="date_ecriture"
              name="date_ecriture"
              required
              defaultValue={ecriture?.date_ecriture ?? new Date().toISOString().split('T')[0]}
              disabled={locked}
            />
          </Field>
          <Field label="Type" htmlFor="type" required>
            <NativeSelect
              id="type"
              name="type"
              defaultValue={ecriture?.type ?? 'depense'}
              disabled={locked}
            >
              <option value="depense">Dépense</option>
              <option value="recette">Recette</option>
            </NativeSelect>
          </Field>
        </div>
        <Field label="Description" htmlFor="description" required>
          <Input
            id="description"
            name="description"
            required
            defaultValue={ecriture?.description ?? ''}
            disabled={locked}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Montant" htmlFor="montant" required hint="format 42,50">
            <Input
              id="montant"
              name="montant"
              required
              placeholder="42,50"
              defaultValue={amountStr}
              disabled={locked}
              inputMode="decimal"
            />
          </Field>
          <Field label="N° pièce" htmlFor="numero_piece" hint="code Comptaweb si reçu">
            <Input
              id="numero_piece"
              name="numero_piece"
              defaultValue={ecriture?.numero_piece ?? ''}
              placeholder="Ex. SA25-12"
              disabled={locked}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Imputation"
        subtitle="Où va cette écriture dans la comptabilité du groupe."
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Unité" htmlFor="unite_id">
            <NativeSelect
              id="unite_id"
              name="unite_id"
              defaultValue={ecriture?.unite_id ?? ''}
              disabled={locked}
            >
              <option value="">— Aucune —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Catégorie" htmlFor="category_id">
            <NativeSelect
              id="category_id"
              name="category_id"
              defaultValue={ecriture?.category_id ?? ''}
              disabled={locked}
            >
              <option value="">— Aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Activité" htmlFor="activite_id">
            <NativeSelect
              id="activite_id"
              name="activite_id"
              defaultValue={ecriture?.activite_id ?? ''}
              disabled={locked}
            >
              <option value="">— Aucune —</option>
              {activites.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Mode de paiement" htmlFor="mode_paiement_id">
            <NativeSelect
              id="mode_paiement_id"
              name="mode_paiement_id"
              defaultValue={ecriture?.mode_paiement_id ?? ''}
              disabled={locked}
            >
              <option value="">— Aucun —</option>
              {modesPaiement.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field
          label="Carte"
          htmlFor="carte_id"
          hint="auto-rempli pour les paiements procurement"
        >
          <NativeSelect
            id="carte_id"
            name="carte_id"
            defaultValue={ecriture?.carte_id ?? ''}
            disabled={locked}
          >
            <option value="">— Aucune —</option>
            {cartes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type === 'procurement' ? 'Procurement' : 'CB'} — {c.porteur}
                {c.code_externe ? ` (${c.code_externe})` : ''}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-border bg-bg-sunken/60 px-3 py-2.5 transition-colors hover:border-border-strong">
          <input
            type="checkbox"
            name="justif_attendu"
            defaultChecked={ecriture ? ecriture.justif_attendu === 1 : true}
            className="mt-0.5 h-4 w-4 rounded border-border-strong text-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />
          <span>
            <span className="text-[13.5px] font-medium text-fg">
              Justificatif attendu pour cette écriture
            </span>
            <span className="block text-[12px] text-fg-muted mt-0.5 leading-relaxed">
              Cocher = justif requis (tant qu&apos;un fichier n&apos;est pas rattaché, l&apos;écriture
              reste dans « À compléter »). Décocher pour un prélèvement auto SGDF / flux territoire
              qui n&apos;aura pas de pièce.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Notes" subtitle="Pour mémoire — pas envoyé à Comptaweb.">
        <Textarea id="notes" name="notes" rows={3} defaultValue={ecriture?.notes ?? ''} />
      </Section>

      <div className="flex justify-end pt-2">
        <Button type="submit" size="lg">
          {ecriture ? 'Enregistrer les changements' : 'Créer l\'écriture'}
        </Button>
      </div>
    </form>
  );
}

// `<NativeSelect>` : <select> HTML stylé — pour les form-actions où on
// veut que le name remonte dans FormData sans avoir à mapper le custom
// Select (qui passerait par un input hidden). Style aligné sur le
// design system.
function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={
          'h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-9 text-[13.5px] outline-none transition-colors ' +
          'hover:border-border-strong ' +
          'focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 ' +
          'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 ' +
          (className ?? '')
        }
      />
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle"
      >
        <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
