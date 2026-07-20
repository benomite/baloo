'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, TriangleAlert, Paperclip } from 'lucide-react';
import { Amount } from '@/components/shared/amount';
import { formatKmRate, formatDistance } from '@/lib/services/km';
import { cn } from '@/lib/utils';

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
}: {
  lignes: DetailLigne[];
  // map ligne_id → justifs rattachés
  justifsParLigne: Record<string, JustifRef[]>;
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
            const ok = justifs.length > 0;
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
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border',
                      ok
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                        : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
                    )}
                  >
                    {ok ? <Check size={11} strokeWidth={2.5} /> : <TriangleAlert size={11} strokeWidth={2.25} />}
                    {ok ? 'Justif' : 'Manquant'}
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
