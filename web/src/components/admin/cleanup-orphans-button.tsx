'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  detectOrphansWithoutCategory,
  deleteOrphansWithoutCategory,
} from '@/lib/actions/comptaweb-import';
import type { OrphanCandidate } from '@/lib/services/dedup-ecritures';

// Bouton de nettoyage des orphelins sans catégorie issus d'imports CSV
// buggés (avant le fix mapping comptaweb_nature). Workflow en 2 temps :
// 1. Détection → liste les écritures saisie_comptaweb avec category_id=null
//    qui ont une "twin" (mêmes date/amount/type/piece/description) avec
//    catégorie définie → ce sont des doublons sûrs à supprimer
// 2. L'utilisateur peut décocher individuellement
// 3. Affiche aussi les orphelins sans twin (= légitimes, à compléter manuellement)

function fmtAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${(abs / 100).toFixed(2).replace('.', ',')} €`;
}

export function CleanupOrphansButton() {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<null | {
    withTwin: OrphanCandidate[];
    withoutTwin: OrphanCandidate[];
  }>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const detect = () =>
    startTransition(async () => {
      const r = await detectOrphansWithoutCategory();
      if (!r.ok) {
        toast.error(r.error ?? 'Échec de la détection');
        return;
      }
      if (r.totalDeletable === 0 && r.totalNeedsCompletion === 0) {
        toast.success('Aucune écriture sans catégorie.');
        setReport(null);
        return;
      }
      setReport({ withTwin: r.withTwin, withoutTwin: r.withoutTwin });
      setUnchecked(new Set());
    });

  const selectedIds = useMemo(() => {
    if (!report) return [];
    return report.withTwin.filter((c) => !unchecked.has(c.id)).map((c) => c.id);
  }, [report, unchecked]);

  const execute = () =>
    startTransition(async () => {
      if (selectedIds.length === 0) return;
      const r = await deleteOrphansWithoutCategory(selectedIds);
      if (!r.ok) {
        toast.error(r.error ?? 'Échec de la suppression');
        return;
      }
      toast.success(
        `Orphelins supprimés : ${r.deleted ?? 0}` +
          (r.skipped && r.skipped > 0
            ? ` · ${r.skipped} skip (lien apparu entre-temps)`
            : ''),
      );
      setReport(null);
      setUnchecked(new Set());
    });

  const toggle = (id: string) => {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2 items-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={detect}
      >
        <AlertTriangle size={13} strokeWidth={2} className="mr-1.5" />
        {pending ? 'Détection…' : 'Nettoyer écritures sans catégorie'}
      </Button>
      {report && (report.withTwin.length > 0 || report.withoutTwin.length > 0) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 text-[12.5px] w-full max-w-3xl">
          {report.withTwin.length > 0 && (
            <>
              <div className="font-medium text-amber-900 dark:text-amber-200 mb-2">
                {report.withTwin.length} orphelin{report.withTwin.length > 1 ? 's' : ''} sans
                catégorie avec une vraie écriture jumelle — décoche ce que tu veux garder.
              </div>
              <div className="max-h-[50vh] overflow-y-auto space-y-2 mb-3 pr-1">
                {report.withTwin.map((c) => {
                  const willDelete = !unchecked.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex gap-2 p-2 rounded border cursor-pointer ${
                        willDelete
                          ? 'border-red-300 bg-red-50/30 dark:bg-red-950/10 text-red-900 dark:text-red-200'
                          : 'border-zinc-200 dark:border-zinc-800 text-fg-muted line-through opacity-70'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={willDelete}
                        onChange={() => toggle(c.id)}
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          {c.description || <em className="opacity-60">(sans description)</em>}
                        </div>
                        <div className="text-[11.5px] opacity-80 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>{c.date_ecriture}</span>
                          <span>{fmtAmount(c.amount_cents)}</span>
                          <span>{c.type}</span>
                          {c.numero_piece && <span>piece: <code className="text-[10.5px]">{c.numero_piece}</code></span>}
                          <span>id: <code className="text-[10.5px]">{c.id}</code></span>
                        </div>
                        <div className="text-[11.5px] opacity-90 mt-0.5 text-emerald-800 dark:text-emerald-300">
                          → jumelle {c.twin_id}{c.twin_category_name ? ` (${c.twin_category_name})` : ''}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 justify-end mb-2">
                <button
                  type="button"
                  onClick={() => { setReport(null); setUnchecked(new Set()); }}
                  className="text-[12px] text-fg-muted hover:text-fg"
                >
                  Annuler
                </button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pending || selectedIds.length === 0}
                  onClick={execute}
                >
                  Supprimer {selectedIds.length} orphelin{selectedIds.length > 1 ? 's' : ''}
                </Button>
              </div>
            </>
          )}
          {report.withoutTwin.length > 0 && (
            <div className="text-[12px] text-amber-900/80 dark:text-amber-200/80 border-t border-amber-200 dark:border-amber-900/30 pt-2">
              <div className="font-medium mb-1">
                {report.withoutTwin.length} écriture{report.withoutTwin.length > 1 ? 's' : ''} sans
                catégorie sans jumelle — légitimes, à compléter à la main :
              </div>
              <ul className="space-y-0.5 pl-3">
                {report.withoutTwin.slice(0, 10).map((c) => (
                  <li key={c.id} className="text-[11.5px]">
                    <code className="text-[10.5px]">{c.id}</code> · {c.date_ecriture} ·{' '}
                    {fmtAmount(c.amount_cents)} · {c.description}
                  </li>
                ))}
                {report.withoutTwin.length > 10 && (
                  <li className="text-[11px] opacity-70">… +{report.withoutTwin.length - 10}</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
