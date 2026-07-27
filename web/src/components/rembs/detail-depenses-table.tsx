'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Paperclip } from 'lucide-react';
import { Amount } from '@/components/shared/amount';
import { PendingButton } from '@/components/shared/pending-button';
import { assignLigneJustifs } from '@/lib/actions/remboursements';
import { formatKmRate, formatDistance } from '@/lib/services/km';

export interface DetailLigne {
  id: string;
  date_depense: string;
  amount_cents: number;
  nature: string;
  type: string;
  distance_km_dixiemes: number | null;
  taux_km_millicents: number | null;
}

export interface JustifRef {
  id: string;
  original_filename: string;
  file_path: string;
}

type SortCol = 'date' | 'montant';
type SortDir = 'asc' | 'desc';

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return dir === 'asc' ? (
    <ArrowUp size={11} strokeWidth={2} className="inline" />
  ) : (
    <ArrowDown size={11} strokeWidth={2} className="inline" />
  );
}

export function DetailDepensesTable({
  lignes,
  justifsParLigne,
  demandeJustifs = [],
  canEdit = false,
  remboursementId,
}: {
  lignes: DetailLigne[];
  // map ligne_id → justifs rattachés
  justifsParLigne: Record<string, JustifRef[]>;
  // tous les justifs déposés sur la demande (pour la liste à cocher)
  demandeJustifs?: JustifRef[];
  // trésorier/RG : peut rattacher un justif à une ligne
  canEdit?: boolean;
  remboursementId?: string;
}) {
  const [col, setCol] = useState<SortCol>('date');
  const [dir, setDir] = useState<SortDir>('asc');

  const toggle = (c: SortCol) => {
    if (c === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setCol(c); setDir('asc'); }
  };

  const sorted = [...lignes].sort((a, b) => {
    const mult = dir === 'asc' ? 1 : -1;
    if (col === 'montant') return (a.amount_cents - b.amount_cents) * mult;
    if (a.date_depense !== b.date_depense) return a.date_depense < b.date_depense ? -mult : mult;
    return 0;
  });

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border-soft text-[11px] uppercase tracking-wide text-fg-subtle">
            <th className="py-2 px-2 text-left font-medium">
              <button type="button" onClick={() => toggle('date')} className="inline-flex items-center gap-1 hover:text-fg">
                Date <SortArrow active={col === 'date'} dir={dir} />
              </button>
            </th>
            <th className="py-2 px-2 text-left font-medium">Nature</th>
            <th className="py-2 px-2 text-left font-medium">Justif</th>
            <th className="py-2 px-2 text-right font-medium">
              <button type="button" onClick={() => toggle('montant')} className="inline-flex items-center gap-1 hover:text-fg">
                Montant <SortArrow active={col === 'montant'} dir={dir} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const justifs = justifsParLigne[l.id] ?? [];
            return (
              <tr key={l.id} className="border-b border-border-soft last:border-b-0 align-top">
                <td className="py-2 px-2 text-fg tabular-nums">{l.date_depense}</td>
                <td className="py-2 px-2 text-fg">
                  {l.nature}
                  {l.type === 'km' && l.distance_km_dixiemes != null && l.taux_km_millicents != null && (
                    <span className="block text-[11.5px] text-fg-subtle tabular-nums">
                      {formatDistance(l.distance_km_dixiemes)} × {formatKmRate(l.taux_km_millicents)}/km
                    </span>
                  )}
                </td>
                <td className="py-2 px-2">
                  {/* Pas de justif par ligne obligatoire : les justifs sont liés à
                      la demande. On n'affiche l'info que quand un justif est
                      explicitement rattaché à cette ligne — jamais d'alerte « manquant ». */}
                  {justifs.length > 0 && (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                        <Check size={11} strokeWidth={2.5} />
                        Justif
                      </span>
                      {justifs.map((j) => (
                        <a
                          key={j.id}
                          href={`/api/justificatifs/${j.file_path}`}
                          target="_blank"
                          rel="noopener"
                          className="mt-1 flex items-center gap-1 text-[11.5px] text-fg-muted hover:text-brand transition-colors"
                        >
                          <Paperclip size={10} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
                          <span className="truncate max-w-[160px]">{j.original_filename}</span>
                        </a>
                      ))}
                    </>
                  )}
                  {canEdit && remboursementId && demandeJustifs.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11.5px] text-fg-subtle hover:text-fg-muted transition-colors">
                        + rattacher un justif
                      </summary>
                      <form
                        action={assignLigneJustifs.bind(null, remboursementId, l.id)}
                        className="mt-1.5 space-y-1 rounded-md border border-border-soft bg-bg-sunken/40 px-2.5 py-2 min-w-[200px]"
                      >
                        {demandeJustifs.map((j) => (
                          <label key={j.id} className="flex items-start gap-2 text-[12px] cursor-pointer">
                            <input
                              type="checkbox"
                              name="justif_ids"
                              value={j.id}
                              defaultChecked={justifs.some((x) => x.id === j.id)}
                              className="mt-0.5 h-3.5 w-3.5 rounded border-border-strong text-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                            />
                            <span className="truncate">{j.original_filename}</span>
                          </label>
                        ))}
                        <div className="flex justify-end pt-1">
                          <PendingButton variant="outline" size="sm">
                            Enregistrer
                          </PendingButton>
                        </div>
                      </form>
                    </details>
                  )}
                </td>
                <td className="py-2 px-2 text-right font-medium">
                  <Amount cents={l.amount_cents} tone="negative" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
