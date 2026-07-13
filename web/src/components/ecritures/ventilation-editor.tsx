'use client';

// `VentilationEditor` : éditeur inline de ventilation d'un brouillon
// d'écriture (spec 2026-07-13, modèle « défauts globaux + lignes
// légères »). Un bloc « Imputation par défaut » (Activité + Unité) en
// haut, puis des lignes légères Montant + Nature ; chaque ligne a un ⚙
// qui déplie une surcharge Activité/Unité pour CETTE ligne, et un ✕.
// Le total (`totalCents`) est FIGÉ — l'utilisateur ne ventile jamais
// plus/moins que ce total, cf. `ventilate-editor-model.ts`.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { NativeSelect } from '@/components/ui/native-select';
import { CategoryPicker } from '@/components/shared/category-picker';
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
  type DetailRow,
  type DefaultImputation,
  type ResolvedVentilation,
} from './ventilate-editor-model';

export interface VentilationEditorProps {
  /** Total FIGÉ du groupe (montant bancaire / dépôt à ventiler). */
  totalCents: number;
  initialDefaults: DefaultImputation;
  /** Au moins 1 ligne, préremplie par le panneau appelant. */
  initialRows: DetailRow[];
  categories: Category[];
  unites: Unite[];
  activites: Activite[];
  onSave: (ventilations: ResolvedVentilation[]) => Promise<void>;
  saving?: boolean;
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

export function VentilationEditor({
  totalCents,
  initialDefaults,
  initialRows,
  categories,
  unites,
  activites,
  onSave,
  saving = false,
}: VentilationEditorProps) {
  const [defaults, setDefaults] = useState<DefaultImputation>(initialDefaults);
  const [rows, setRows] = useState<DetailRow[]>(initialRows);

  const remainder = editorRemainderCents(totalCents, rows);
  const balanced = remainder === 0;
  const canSave = canSaveVentilation(totalCents, defaults, rows);
  const multiCategory = isMultiCategory(rows);
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  const updateRow = (id: string, patch: Partial<DetailRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const toggleOverride = (row: DetailRow) => {
    updateRow(row.id, { override: row.override ? null : { ...defaults } });
  };

  const addRow = () => {
    setRows((prev) => [...prev, { id: newRowId(), amount: '', category_id: null, override: null }]);
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };

  const handleSave = () => {
    void onSave(resolveVentilations(defaults, rows));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          Imputation par défaut
        </span>
        {multiCategory && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Catégories multiples
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border bg-bg-sunken/40 p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Activité" htmlFor="ventilation-default-activite">
            <NativeSelect
              id="ventilation-default-activite"
              value={defaults.activite_id ?? ''}
              onChange={(e) => setDefaults((d) => ({ ...d, activite_id: e.target.value || null }))}
            >
              <option value="">— Aucune —</option>
              {activites.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Unité" htmlFor="ventilation-default-unite">
            <NativeSelect
              id="ventilation-default-unite"
              value={defaults.unite_id ?? ''}
              onChange={(e) => setDefaults((d) => ({ ...d, unite_id: e.target.value || null }))}
            >
              <option value="">— Aucune —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-border bg-bg-elevated p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
              <Field label="Montant" htmlFor={`ventilation-amount-${row.id}`} hint="format 42,50">
                <Input
                  id={`ventilation-amount-${row.id}`}
                  inputMode="decimal"
                  placeholder="42,50"
                  value={row.amount}
                  onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                />
              </Field>
              <Field label="Catégorie" htmlFor={`ventilation-category-${row.id}`}>
                <CategoryPicker
                  id={`ventilation-category-${row.id}`}
                  name={`ventilation-category-${row.id}`}
                  categories={categoryOptions}
                  topIds={[]}
                  defaultValue={row.category_id ?? ''}
                  onChange={(value) => updateRow(row.id, { category_id: value || null })}
                />
              </Field>
              <button
                type="button"
                aria-label="Surcharger l'imputation de cette ligne"
                aria-pressed={row.override !== null}
                onClick={() => toggleOverride(row)}
                className={cn(
                  'h-10 w-10 shrink-0 rounded-lg border text-[15px] transition-colors',
                  row.override
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border bg-bg-elevated text-fg hover:border-border-strong',
                )}
              >
                ⚙
              </button>
              <button
                type="button"
                aria-label="Retirer cette ligne"
                onClick={() => removeRow(row.id)}
                disabled={rows.length <= 1}
                className="h-10 w-10 shrink-0 rounded-lg border border-border bg-bg-elevated text-[15px] text-destructive hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                ✕
              </button>
            </div>
            {row.override && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Activité (ligne)" htmlFor={`ventilation-override-activite-${row.id}`}>
                  <NativeSelect
                    id={`ventilation-override-activite-${row.id}`}
                    value={row.override.activite_id ?? ''}
                    onChange={(e) =>
                      updateRow(row.id, {
                        override: { ...(row.override as DefaultImputation), activite_id: e.target.value || null },
                      })
                    }
                  >
                    <option value="">— Aucune —</option>
                    {activites.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Unité (ligne)" htmlFor={`ventilation-override-unite-${row.id}`}>
                  <NativeSelect
                    id={`ventilation-override-unite-${row.id}`}
                    value={row.override.unite_id ?? ''}
                    onChange={(e) =>
                      updateRow(row.id, {
                        override: { ...(row.override as DefaultImputation), unite_id: e.target.value || null },
                      })
                    }
                  >
                    <option value="">— Aucune —</option>
                    {unites.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            )}
          </div>
        ))}
      </div>

      <button type="button" onClick={addRow} className="text-[13px] font-medium text-brand hover:underline">
        + Ajouter un détail
      </button>

      <div
        className={cn(
          'rounded-lg border px-3 py-2 text-[13px] font-medium',
          balanced
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100'
            : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100',
        )}
      >
        {balanced ? `✓ ${formatAmount(totalCents)} — équilibré` : `reste ${formatAmount(remainder)} à ventiler`}
      </div>

      <Button type="button" disabled={!canSave || saving} onClick={handleSave}>
        Enregistrer la ventilation
      </Button>
    </div>
  );
}
