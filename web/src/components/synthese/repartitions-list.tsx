'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Amount } from '@/components/shared/amount';
import { formatAmount } from '@/lib/format';
import {
  updateRepartitionAction,
  deleteRepartitionAction,
} from '@/lib/actions/repartitions';
import type { Repartition } from '@/lib/services/repartitions';
import type { Unite } from '@/lib/types';

interface Props {
  repartitions: Repartition[];
  unites: Unite[];
  uniteCourante: string;        // id de l'unité du détail courant
  canEdit: boolean;
}

function uniteLabel(unites: Unite[], id: string | null): string {
  if (id === null) return 'Groupe';
  const u = unites.find((x) => x.id === id);
  return u ? u.code : 'Inconnue';
}

export function RepartitionsList({ repartitions, unites, uniteCourante, canEdit }: Props) {
  const [, startTransition] = useTransition();

  function patchField(id: string, field: string, value: string | null) {
    if (!canEdit) return;
    const fd = new FormData();
    fd.set('id', id);
    fd.set('field', field);
    if (value !== null) fd.set('value', value);
    startTransition(() => updateRepartitionAction(fd));
  }

  function deleteRow(id: string) {
    if (!canEdit) return;
    if (!confirm('Supprimer cette répartition ?')) return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(() => deleteRepartitionAction(fd));
  }

  if (repartitions.length === 0) {
    return (
      <p className="px-5 py-4 text-sm text-muted-foreground">
        Aucune répartition impactant cette unité sur la saison.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr className="text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Sens</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Cible</th>
            <th className="px-3 py-2 font-medium">Libellé</th>
            <th className="px-3 py-2 font-medium text-right">Montant</th>
            <th className="px-3 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {repartitions.map((r) => {
            const estEntrante = r.unite_cible_id === uniteCourante;
            const signedAmount = estEntrante ? r.montant_cents : -r.montant_cents;
            const sourceLabel = uniteLabel(unites, r.unite_source_id);
            const cibleLabel = uniteLabel(unites, r.unite_cible_id);
            return (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  {canEdit ? (
                    <Input
                      type="date"
                      defaultValue={r.date_repartition}
                      onBlur={(e) => e.currentTarget.value !== r.date_repartition && patchField(r.id, 'date_repartition', e.currentTarget.value)}
                    />
                  ) : (
                    r.date_repartition
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={estEntrante ? 'text-emerald-700' : 'text-rose-700'}>
                    {estEntrante ? '→ entrée' : '← sortie'}
                  </span>
                </td>
                <td className={`px-3 py-2 ${r.unite_source_id === uniteCourante ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {sourceLabel}
                </td>
                <td className={`px-3 py-2 ${r.unite_cible_id === uniteCourante ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {cibleLabel}
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <Input
                      defaultValue={r.libelle}
                      onBlur={(e) => e.currentTarget.value !== r.libelle && patchField(r.id, 'libelle', e.currentTarget.value)}
                    />
                  ) : (
                    r.libelle
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {canEdit ? (
                    <Input
                      defaultValue={formatAmount(r.montant_cents).replace(/\s?€$/, '')}
                      className="text-right tabular-nums"
                      onBlur={(e) => {
                        const raw = e.currentTarget.value.trim();
                        const oldFormatted = formatAmount(r.montant_cents).replace(/\s?€$/, '');
                        if (raw !== oldFormatted) patchField(r.id, 'amount', raw);
                      }}
                    />
                  ) : (
                    <Amount cents={signedAmount} tone="signed" />
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => deleteRow(r.id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Supprimer"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
