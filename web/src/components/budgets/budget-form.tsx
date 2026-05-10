'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { StatCard } from '@/components/shared/stat-card';
import { Amount } from '@/components/shared/amount';
import { Section } from '@/components/shared/section';
import { formatAmount } from '@/lib/format';
import {
  createBudgetLigneAction,
  updateBudgetLigneAction,
  deleteBudgetLigneAction,
  updateBudgetStatutAction,
} from '@/lib/actions/budgets';
import type { Budget, BudgetLigne } from '@/lib/services/budgets';
import type { Category, Unite, Activite } from '@/lib/types';

interface Props {
  budget: Budget;
  lignes: BudgetLigne[];
  totaux: { depenses: number; recettes: number; solde: number };
  categories: Category[];
  unites: Unite[];
  activites: Activite[];
  readOnly: boolean;
}

const STATUT_LABELS: Record<Budget['statut'], string> = {
  projet: 'Projet',
  vote: 'Voté',
  cloture: 'Clôturé',
};

export function BudgetForm({
  budget,
  lignes,
  totaux,
  categories,
  unites,
  activites,
  readOnly,
}: Props) {
  const [isPending, startTransition] = useTransition();

  function patchField(ligneId: string, field: string, value: string | null) {
    if (readOnly) return;
    const fd = new FormData();
    fd.set('ligne_id', ligneId);
    fd.set('field', field);
    if (value !== null) fd.set('value', value);
    startTransition(() => updateBudgetLigneAction(fd));
  }

  function deleteLigne(ligneId: string) {
    if (readOnly) return;
    const fd = new FormData();
    fd.set('ligne_id', ligneId);
    startTransition(() => deleteBudgetLigneAction(fd));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-sm text-muted-foreground">Statut :</span>
        <form action={updateBudgetStatutAction}>
          <input type="hidden" name="budget_id" value={budget.id} />
          <NativeSelect
            name="statut"
            defaultValue={budget.statut}
            onChange={(e) => {
              const f = e.currentTarget.form;
              if (f) startTransition(() => f.requestSubmit());
            }}
          >
            <option value="projet">{STATUT_LABELS.projet}</option>
            <option value="vote">{STATUT_LABELS.vote}</option>
            <option value="cloture">{STATUT_LABELS.cloture}</option>
          </NativeSelect>
        </form>
        {budget.vote_le && (
          <span className="text-xs text-muted-foreground">Voté le {budget.vote_le}</span>
        )}
      </div>

      {readOnly && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Budget clôturé : édition désactivée. Pour ré-éditer, repasse le statut en « Voté » ou « Projet ».
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Prévu dépenses" value={<Amount cents={totaux.depenses} tone="negative" />} />
        <StatCard label="Prévu recettes" value={<Amount cents={totaux.recettes} tone="positive" />} />
        <StatCard label="Prévu solde" value={<Amount cents={totaux.solde} tone="signed" />} />
      </div>

      <Section title={`Lignes (${lignes.length})`} className="mb-8" bodyClassName="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Libellé</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Montant</th>
                <th className="px-3 py-2 font-medium">Unité</th>
                <th className="px-3 py-2 font-medium">Catégorie</th>
                <th className="px-3 py-2 font-medium">Activité</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <Input
                      defaultValue={l.libelle}
                      disabled={readOnly}
                      onBlur={(e) => e.currentTarget.value !== l.libelle && patchField(l.id, 'libelle', e.currentTarget.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      defaultValue={l.type}
                      disabled={readOnly}
                      onChange={(e) => patchField(l.id, 'type', e.currentTarget.value)}
                    >
                      <option value="depense">Dépense</option>
                      <option value="recette">Recette</option>
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      defaultValue={formatAmount(l.amount_cents).replace(/\s?€$/, '')}
                      disabled={readOnly}
                      className="text-right tabular-nums"
                      onBlur={(e) => {
                        const raw = e.currentTarget.value.trim();
                        const oldFormatted = formatAmount(l.amount_cents).replace(/\s?€$/, '');
                        if (raw !== oldFormatted) patchField(l.id, 'amount', raw);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      defaultValue={l.unite_id ?? ''}
                      disabled={readOnly}
                      onChange={(e) => patchField(l.id, 'unite_id', e.currentTarget.value || null)}
                    >
                      <option value="">—</option>
                      {unites.map((u) => (
                        <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      defaultValue={l.category_id ?? ''}
                      disabled={readOnly}
                      onChange={(e) => patchField(l.id, 'category_id', e.currentTarget.value || null)}
                    >
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      defaultValue={l.activite_id ?? ''}
                      disabled={readOnly}
                      onChange={(e) => patchField(l.id, 'activite_id', e.currentTarget.value || null)}
                    >
                      <option value="">—</option>
                      {activites.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      defaultValue={l.notes ?? ''}
                      disabled={readOnly}
                      onBlur={(e) => e.currentTarget.value !== (l.notes ?? '') && patchField(l.id, 'notes', e.currentTarget.value || null)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => deleteLigne(l.id)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <form action={createBudgetLigneAction} className="border-t p-3 grid grid-cols-1 lg:grid-cols-7 gap-2">
            <input type="hidden" name="budget_id" value={budget.id} />
            <Input name="libelle" placeholder="Libellé" required />
            <NativeSelect name="type" defaultValue="depense">
              <option value="depense">Dépense</option>
              <option value="recette">Recette</option>
            </NativeSelect>
            <Input name="amount" placeholder="0,00" className="text-right tabular-nums" required />
            <NativeSelect name="unite_id" defaultValue="">
              <option value="">— unité —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>{u.code}</option>
              ))}
            </NativeSelect>
            <NativeSelect name="category_id" defaultValue="">
              <option value="">— catégorie —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
            <NativeSelect name="activite_id" defaultValue="">
              <option value="">— activité —</option>
              {activites.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </NativeSelect>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand text-white px-3 py-1.5 text-sm hover:bg-brand/90 disabled:opacity-50"
            >
              + Ajouter
            </button>
          </form>
        )}
      </Section>
    </div>
  );
}
