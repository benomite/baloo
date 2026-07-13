'use client';

import { useRef, type Dispatch, type SetStateAction } from 'react';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/shared/field';
import { Section } from '@/components/shared/section';
import { NativeSelect } from '@/components/ui/native-select';
import { PendingButton } from '@/components/shared/pending-button';
import { CategoryPicker } from '@/components/shared/category-picker';
import { keepSelectable, isUnmapped } from '@/lib/selectable';
import type { VentilationRow } from './ventilations-form';
import type { Category, Unite, ModePaiement, Activite, Carte, Ecriture } from '@/lib/types';

// Corps réutilisable du formulaire : tous les champs SANS l'élément
// `<form>` ni le bouton submit. Permet à un wrapper client (cf.
// `NouvelleEcritureWizard`) de monter le form lui-même avec son propre
// ref / onChange pour piloter `CwAssistActions`.
//
// Pour la page édition (qui utilise toujours une server action pour
// l'UPDATE local des champs non sync), on passe par `EcritureForm` qui
// embarque le `<form action={...}>` + un bouton submit.
export function EcritureFormFields({
  categories,
  topCategoryIds,
  unites,
  modesPaiement,
  activites,
  cartes,
  ecriture,
  mode = 'edit',
  vents,
  setVents,
  multiCategory = false,
}: {
  categories: Category[];
  topCategoryIds: string[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  ecriture?: Ecriture;
  /**
   * L'écriture fait partie d'un groupe de ventilation multi-catégories
   * (≥ 2 détails). Le champ « Catégorie » unique deviendrait trompeur : on
   * affiche « Catégories multiples » (lecture seule) et on préserve la
   * catégorie propre de la tête via un input caché (pas de perte de donnée
   * au submit — cf. règle no-DELETE/UPSERT).
   */
  multiCategory?: boolean;
  /**
   * 'edit' (défaut) : formulaire mono-ventilation historique — grain
   * d'une écriture Baloo = 1 ventilation (cf. AGENTS.md), utilisé par
   * `EcritureForm` (page édition, server action `updateEcriture`) qui
   * lit `montant`/`category_id`/`unite_id`/`activite_id` via FormData.
   * 'wizard' : répéteur multi-ventilation (Task 7, S0) utilisé par
   * `NouvelleEcritureWizard` (`/ecritures/nouveau`) — `amount_cents`
   * racine part vers `/api/ecritures` en tant que Σ des `ventilations[]`
   * (plus de category_id/unite_id/activite_id racine, cf. schema Zod de
   * la route). Nécessite `vents`/`setVents` (état contrôlé par le
   * parent, qui en a besoin pour construire le payload et pour désactiver
   * le bouton "Faire dans CW").
   */
  mode?: 'edit' | 'wizard';
  vents?: VentilationRow[];
  setVents?: Dispatch<SetStateAction<VentilationRow[]>>;
}) {
  const amountStr = ecriture
    ? `${Math.floor(ecriture.amount_cents / 100)},${String(ecriture.amount_cents % 100).padStart(2, '0')}`
    : '';
  // Lock sync : écriture déjà dans CW (mirror) ou en écart détecté
  // (divergent). Dans les deux cas, on ne touche pas aux champs sync
  // localement — la réconciliation passe par CW.
  const locked = ecriture?.status === 'mirror' || ecriture?.status === 'divergent';

  // Filtrage saisie : on ne propose que les référentiels mappés Comptaweb,
  // sauf la valeur courante orpheline qu'on conserve pour ne pas la
  // perdre à l'édition. Le suffixe "(non sync)" alerte le trésorier.
  const selectableCategories = keepSelectable(categories, ecriture?.category_id);
  const selectableUnites = keepSelectable(unites, ecriture?.unite_id);
  const selectableModes = keepSelectable(modesPaiement, ecriture?.mode_paiement_id);
  const selectableActivites = keepSelectable(activites, ecriture?.activite_id);
  const selectableCartes = keepSelectable(cartes, ecriture?.carte_id);
  const decorate = (item: { name: string; comptaweb_id: number | null }): string =>
    item.comptaweb_id === null ? `${item.name} (non sync)` : item.name;

  // Répéteur de ventilations (mode 'wizard' uniquement) : `vents` est
  // contrôlé par le parent (`NouvelleEcritureWizard`) — on met à jour via
  // `setVents`, jamais d'état local ici, pour que le parent voie chaque
  // ligne en temps réel (payload POST + gate du bouton "Faire dans CW").
  const ventRows = vents ?? [];
  const nextVentIdRef = useRef(1); // 'v0' est déjà pris par la ligne initiale du wizard.
  const addVentRow = () => {
    const id = `v${nextVentIdRef.current++}`;
    setVents?.((prev) => [...prev, { id, amount: '', category_id: null, unite_id: null, activite_id: null }]);
  };
  const removeVentRow = (id: string) => {
    setVents?.((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };
  const updateVentRow = (id: string, patch: Partial<VentilationRow>) => {
    setVents?.((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  // Total = Σ des lignes (pas de champ "montant total" indépendant dans
  // ce wizard, cf. schema `/api/ecritures` : amount_cents racine = Σ
  // ventilations). Le reste à ventiler est donc TOUJOURS 0 par
  // construction ici et n'a rien à afficher — pas de compteur "reste à
  // ventiler" en mode wizard. Ce compteur ne prendra sens que le jour où
  // ce répéteur sera réutilisé avec un total FIXÉ indépendamment (ex.
  // montant importé d'une ligne bancaire à réconcilier / dépôt) : à ce
  // moment-là, réintroduire l'affichage ci-dessous en le gardant à
  // `mode !== 'wizard'` (ou équivalent), via `ventilationsRemainderCents`
  // (gardé dans `ventilations-form.ts` pour ce futur appelant).

  return (
    <div className="space-y-6">
      {locked && (
        <Alert variant="warning" icon={Lock}>
          Écriture synchronisée Comptaweb — les champs sync sont en lecture seule. Seuls les
          justificatifs, le flag « justif attendu » et les notes restent modifiables.
        </Alert>
      )}

      <Section title="Identité" subtitle="Quoi, quand, combien.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {mode === 'edit' && (
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
          )}
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

      {mode === 'wizard' && (
        <Section
          title="Ventilation"
          subtitle="Un montant + une imputation par ligne. Ajoute une ligne pour répartir sur plusieurs catégories."
        >
          {ventRows.map((row, i) => (
            <div
              key={row.id}
              className="rounded-lg border border-border bg-bg-sunken/40 p-3 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                  Ventilation {i + 1}
                </span>
                {ventRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeVentRow(row.id)}
                    className="text-[12px] font-medium text-destructive hover:underline"
                  >
                    Supprimer
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Montant" htmlFor={`ventilations.${i}.amount`} required hint="format 42,50">
                  <Input
                    id={`ventilations.${i}.amount`}
                    name={`ventilations.${i}.amount`}
                    required
                    placeholder="42,50"
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(e) => updateVentRow(row.id, { amount: e.target.value })}
                  />
                </Field>
                <Field label="Catégorie" htmlFor={`ventilations.${i}.category_id`} required>
                  <CategoryPicker
                    id={`ventilations.${i}.category_id`}
                    name={`ventilations.${i}.category_id`}
                    categories={selectableCategories.map((c) => ({
                      id: c.id,
                      name: c.name,
                      unmapped: isUnmapped(c),
                    }))}
                    topIds={topCategoryIds}
                    defaultValue={row.category_id ?? ''}
                    onChange={(value) => updateVentRow(row.id, { category_id: value || null })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Unité" htmlFor={`ventilations.${i}.unite_id`} required>
                  <NativeSelect
                    id={`ventilations.${i}.unite_id`}
                    name={`ventilations.${i}.unite_id`}
                    value={row.unite_id ?? ''}
                    onChange={(e) => updateVentRow(row.id, { unite_id: e.target.value || null })}
                  >
                    <option value="">— Aucune —</option>
                    {selectableUnites.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} — {u.name}{isUnmapped(u) ? ' (non sync)' : ''}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Activité" htmlFor={`ventilations.${i}.activite_id`} required>
                  <NativeSelect
                    id={`ventilations.${i}.activite_id`}
                    name={`ventilations.${i}.activite_id`}
                    value={row.activite_id ?? ''}
                    onChange={(e) => updateVentRow(row.id, { activite_id: e.target.value || null })}
                  >
                    <option value="">— Aucune —</option>
                    {selectableActivites.map((a) => (
                      <option key={a.id} value={a.id}>
                        {decorate(a)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addVentRow}
            className="text-[13px] font-medium text-brand hover:underline"
          >
            + Ajouter une ventilation
          </button>
        </Section>
      )}

      <Section
        title="Imputation"
        subtitle="Où va cette écriture dans la comptabilité du groupe."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {mode === 'edit' && (
            <>
              <Field label="Unité" htmlFor="unite_id">
                <NativeSelect
                  id="unite_id"
                  name="unite_id"
                  defaultValue={ecriture?.unite_id ?? ''}
                  disabled={locked}
                >
                  <option value="">— Aucune —</option>
                  {selectableUnites.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.name}{isUnmapped(u) ? ' (non sync)' : ''}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Catégorie" htmlFor="category_id">
                {multiCategory ? (
                  <>
                    {/* Groupe multi-ventilations : catégorie propre à chaque
                        ligne → pas de catégorie unique éditable ici. On garde
                        celle de la tête en caché pour ne rien écraser au save. */}
                    <div className="flex h-10 items-center rounded-lg border border-border bg-bg-sunken/60 px-3 text-[13px] text-fg-muted">
                      Catégories multiples
                    </div>
                    <input type="hidden" name="category_id" value={ecriture?.category_id ?? ''} />
                  </>
                ) : (
                  <CategoryPicker
                    id="category_id"
                    name="category_id"
                    categories={selectableCategories.map((c) => ({
                      id: c.id,
                      name: c.name,
                      unmapped: isUnmapped(c),
                    }))}
                    topIds={topCategoryIds}
                    defaultValue={ecriture?.category_id ?? ''}
                    disabled={locked}
                  />
                )}
              </Field>
              <Field label="Activité" htmlFor="activite_id">
                <NativeSelect
                  id="activite_id"
                  name="activite_id"
                  defaultValue={ecriture?.activite_id ?? ''}
                  disabled={locked}
                >
                  <option value="">— Aucune —</option>
                  {selectableActivites.map((a) => (
                    <option key={a.id} value={a.id}>
                      {decorate(a)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          )}
          <Field label="Mode de paiement" htmlFor="mode_paiement_id">
            <NativeSelect
              id="mode_paiement_id"
              name="mode_paiement_id"
              defaultValue={ecriture?.mode_paiement_id ?? ''}
              disabled={locked}
            >
              <option value="">— Aucun —</option>
              {selectableModes.map((m) => (
                <option key={m.id} value={m.id}>
                  {decorate(m)}
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
            {selectableCartes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type === 'procurement' ? 'Procurement' : 'CB'} — {c.porteur}
                {c.code_externe ? ` (${c.code_externe})` : ''}
                {isUnmapped(c) ? ' (non sync)' : ''}
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
    </div>
  );
}

// Wrapper `<form>` + bouton submit pour les cas où on a une server action
// (page édition `/ecritures/[id]`, justifs, etc.). La page `/nouveau`
// n'utilise PAS ce wrapper : elle passe par `NouvelleEcritureWizard` qui
// monte le form lui-même et délègue le submit à `CwAssistActions`.
export function EcritureForm({
  action,
  categories,
  topCategoryIds,
  unites,
  modesPaiement,
  activites,
  cartes,
  ecriture,
  multiCategory = false,
}: {
  action: (formData: FormData) => void;
  categories: Category[];
  topCategoryIds: string[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  ecriture?: Ecriture;
  multiCategory?: boolean;
}) {
  return (
    <form action={action} className="space-y-6">
      <EcritureFormFields
        categories={categories}
        topCategoryIds={topCategoryIds}
        unites={unites}
        modesPaiement={modesPaiement}
        activites={activites}
        cartes={cartes}
        ecriture={ecriture}
        multiCategory={multiCategory}
      />
      <div className="flex justify-end pt-2">
        <PendingButton size="lg" pendingLabel="Enregistrement…">
          {ecriture ? 'Enregistrer les changements' : 'Créer l\'écriture'}
        </PendingButton>
      </div>
    </form>
  );
}

