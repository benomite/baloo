'use client';

// `ImputationGrid` : grille d'imputation unifiée mono/ventilé (spec
// 2026-07-13 v2 — remplace `VentilationEditor`). Colonnes
// `Unité · Catégorie · Activité · Montant · ✕` :
// - MONO (1 ligne, pas ventilé) : colonnes Montant/✕ masquées (largeur
//   nulle), édition champ par champ via `onMonoFieldChange` — pas
//   d'état local à sauver, le panel persiste par PATCH.
// - VENTILÉ (« + Ajouter un détail » ou `startVentilated`) : colonnes
//   révélées, N lignes AUTONOMES (chacune porte ses 3 dimensions +
//   un montant), solde vivant, bouton d'enregistrement qui résout et
//   envoie les N ventilations via `onSaveVentilation`.

import { Fragment, useState } from 'react';
import { cn } from '@/lib/utils';
import { NativeSelect } from '@/components/ui/native-select';
import { CategoryPicker } from '@/components/shared/category-picker';
import { isUnmapped } from '@/lib/selectable';
import { Field } from '@/components/shared/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatAmount } from '@/lib/format';
import type { Category, Unite, Activite } from '@/lib/types';
import {
  resolveVentilations,
  editorRemainderCents,
  isMultiCategory,
  canSaveVentilation,
  type VentLine,
  type ResolvedVentilation,
} from './ventilate-editor-model';

export interface ImputationGridProps {
  /** Total FIGÉ du groupe (montant bancaire / dépôt à ventiler). */
  totalCents: number;
  /** ≥1 ligne ; en mono le montant est ignoré (colonne masquée). */
  initialLines: VentLine[];
  categories: Category[];
  /** Favoris (« Fréquentes ») du groupe, passés au picker catégorie. */
  topCategoryIds: string[];
  /** Sens de l'écriture (dépense/recette) : filtre les catégories de l'autre sens
   *  dans le picker. `undefined` → pas de filtre (toutes les catégories). */
  sens?: 'depense' | 'recette';
  unites: Unite[];
  activites: Activite[];
  /** false → grille en lecture : selects/inputs désactivés, pas de déclencheur d'ajout. */
  editable: boolean;
  /** false → la ventilation n'est PAS permise (écriture non-draft ou déjà dans CW) :
   *  ni « + Ajouter un détail » ni bouton « Enregistrer la ventilation ». Le mode
   *  mono (édition des dimensions) reste dispo selon `editable`. Évite le no-op
   *  silencieux d'un save non permis. */
  canVentilate: boolean;
  /** Mono : édition d'un champ de la ligne unique (→ PATCH /field côté panel). */
  onMonoFieldChange: (field: 'unite_id' | 'category_id' | 'activite_id', value: string | null) => void;
  /** Ventilé : enregistrement de N lignes (→ PUT /ventilations côté panel). Ne doit jamais rejeter. */
  onSaveVentilation: (ventilations: ResolvedVentilation[]) => Promise<void>;
  saving?: boolean;
  /** true si l'écriture est déjà un groupe ≥2 à l'ouverture. */
  startVentilated?: boolean;
}

// `crypto.randomUUID()` n'est pas garanti dispo en environnement de
// test (jsdom sans polyfill) : fallback sur un compteur local.
let fallbackIdCounter = 0;
function newRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackIdCounter += 1;
  return `row-${fallbackIdCounter}`;
}

// `formatAmount` ajoute un suffixe " €" (NBSP) pensé pour l'affichage
// read-only. Les champs Montant de la grille sont des inputs texte au
// même format que la saisie utilisateur (`42,50`, sans €) — cf. hint
// "format 42,50" plus bas. `parseAmount` tolère les deux formes de
// toute façon (le NBSP matche `\s`), donc ce helper ne fait qu'une
// présentation cohérente à l'écran.
function plainAmount(cents: number): string {
  return formatAmount(cents).replace(/\s*€\s*/, '').trim();
}

export function ImputationGrid({
  totalCents,
  initialLines,
  categories,
  topCategoryIds,
  sens,
  unites,
  activites,
  editable,
  canVentilate,
  onMonoFieldChange,
  onSaveVentilation,
  saving = false,
  startVentilated = false,
}: ImputationGridProps) {
  const [ventilated, setVentilated] = useState<boolean>(startVentilated);
  const [lines, setLines] = useState<VentLine[]>(initialLines);

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name, type: c.type, unmapped: isUnmapped(c) }));

  const updateLine = (id: string, patch: Partial<VentLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  // En mono, un changement de champ part vers le panel (PATCH) ET met
  // à jour l'état local `lines`, pour que la ligne existante ait les
  // bonnes valeurs si l'utilisateur bascule ensuite en ventilé.
  const handleFieldChange = (
    lineId: string,
    field: 'unite_id' | 'category_id' | 'activite_id',
    value: string | null,
  ) => {
    updateLine(lineId, { [field]: value });
    if (!ventilated) {
      onMonoFieldChange(field, value);
    }
  };

  const addDetail = () => {
    if (!ventilated) {
      const first = lines[0];
      setVentilated(true);
      setLines([
        { ...first, amount: plainAmount(totalCents) },
        {
          id: newRowId(),
          amount: '',
          category_id: null,
          unite_id: first.unite_id,
          activite_id: first.activite_id,
        },
      ]);
      return;
    }
    setLines((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          id: newRowId(),
          amount: '',
          category_id: null,
          unite_id: last?.unite_id ?? null,
          activite_id: last?.activite_id ?? null,
        },
      ];
    });
  };

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  };

  const remainder = editorRemainderCents(totalCents, lines);
  const balanced = remainder === 0;
  const overshoot = remainder < 0;
  const canSave = canSaveVentilation(totalCents, lines);
  const multiCategory = isMultiCategory(lines);

  const handleSave = () => {
    void onSaveVentilation(resolveVentilations(lines));
  };

  return (
    <div className="space-y-3">
      {multiCategory && (
        <div className="flex justify-end">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Catégories multiples
          </span>
        </div>
      )}

      <div
        className="grid gap-3 items-start transition-[grid-template-columns] duration-200 motion-reduce:transition-none"
        style={{
          gridTemplateColumns: ventilated ? '1fr 1fr 1fr 110px 40px' : '1fr 1fr 1fr 0px 0px',
        }}
      >
        {lines.map((line, idx) => {
          const uniteLabel = ventilated ? 'Unité du détail' : `Unité ligne ${idx + 1}`;
          const catLabel = ventilated ? 'Catégorie du détail' : `Catégorie ligne ${idx + 1}`;
          const actLabel = ventilated ? 'Activité du détail' : `Activité ligne ${idx + 1}`;

          return (
            <Fragment key={line.id}>
              <Field label={uniteLabel} htmlFor={`ig-unite-${line.id}`} className="min-w-0">
                <NativeSelect
                  id={`ig-unite-${line.id}`}
                  value={line.unite_id ?? ''}
                  disabled={!editable}
                  onChange={(e) => handleFieldChange(line.id, 'unite_id', e.target.value || null)}
                >
                  <option value="">— Aucune —</option>
                  {unites.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field label={catLabel} htmlFor={`ig-cat-${line.id}`} className="min-w-0">
                <CategoryPicker
                  id={`ig-cat-${line.id}`}
                  name={`ig-cat-${line.id}`}
                  categories={categoryOptions}
                  topIds={topCategoryIds}
                  sens={sens}
                  defaultValue={line.category_id ?? ''}
                  disabled={!editable}
                  onChange={(value) => handleFieldChange(line.id, 'category_id', value || null)}
                />
              </Field>

              <Field label={actLabel} htmlFor={`ig-act-${line.id}`} className="min-w-0">
                <NativeSelect
                  id={`ig-act-${line.id}`}
                  value={line.activite_id ?? ''}
                  disabled={!editable}
                  onChange={(e) => handleFieldChange(line.id, 'activite_id', e.target.value || null)}
                >
                  <option value="">— Aucune —</option>
                  {activites.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <div className="overflow-hidden">
                {ventilated && (
                  <Field label="Montant" htmlFor={`ig-amount-${line.id}`} hint="format 42,50">
                    <Input
                      id={`ig-amount-${line.id}`}
                      inputMode="decimal"
                      placeholder="42,50"
                      value={line.amount}
                      disabled={!editable}
                      onChange={(e) => updateLine(line.id, { amount: e.target.value })}
                    />
                  </Field>
                )}
              </div>

              <div className="overflow-hidden">
                {ventilated && (
                  <button
                    type="button"
                    aria-label="Retirer cette ligne"
                    onClick={() => removeLine(line.id)}
                    disabled={!editable || lines.length <= 1}
                    className="h-10 w-10 shrink-0 rounded-lg border border-border bg-bg-elevated text-[15px] text-destructive hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ✕
                  </button>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* Déclencheur d'ajout : seulement si l'écriture est éditable ET ventilable
          (draft hors CW). Sinon on n'expose ni l'ajout ni, plus bas, le bouton
          d'enregistrement — évite un save no-op silencieux (revue T3). */}
      {editable && canVentilate && (
        <button type="button" onClick={addDetail} className="text-[13px] font-medium text-brand hover:underline">
          + Ajouter un détail
        </button>
      )}

      {ventilated && (
        <>
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-[13px] font-medium',
              balanced
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100'
                : overshoot
                  ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100'
                  : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100',
            )}
          >
            {balanced
              ? `✓ ${formatAmount(totalCents)} — équilibré`
              : overshoot
                ? `⚠ dépasse de ${formatAmount(Math.abs(remainder))}`
                : `⚠ reste ${formatAmount(remainder)} à ventiler`}
          </div>

          {canVentilate && (
            <Button type="button" disabled={!canSave || saving} onClick={handleSave}>
              Enregistrer la ventilation
            </Button>
          )}
        </>
      )}
    </div>
  );
}
