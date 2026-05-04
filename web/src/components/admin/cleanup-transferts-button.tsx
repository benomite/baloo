'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatAmount } from '@/lib/format';
import {
  detectInternalTransfers,
  deleteInternalTransfers,
} from '@/lib/actions/comptaweb-import';

// Bouton de nettoyage des transferts internes mal classés (dépôts caisse
// → banque importés à tort comme recettes à cause du bug encoding pré-fix).
// Workflow 2-temps : Détecter → confirmation → Supprimer.

export function CleanupTransfertsButton() {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<null | {
    totalDeletable: number;
    totalAmount: number;
    totalKeptDespite: number;
    ids: string[];
  }>(null);

  const detect = () =>
    startTransition(async () => {
      const r = await detectInternalTransfers();
      if (!r.ok) {
        toast.error(r.error ?? 'Échec détection');
        return;
      }
      const ids = r.candidates.filter((c) => !c.has_links).map((c) => c.id);
      if (r.candidates.length === 0) {
        toast.success('Aucun transfert interne mal classé.');
        setReport(null);
        return;
      }
      setReport({
        totalDeletable: r.totalDeletable,
        totalAmount: r.totalAmount,
        totalKeptDespite: r.totalKeptDespite,
        ids,
      });
    });

  const execute = () =>
    startTransition(async () => {
      if (!report) return;
      const r = await deleteInternalTransfers(report.ids);
      if (!r.ok) {
        toast.error(r.error ?? 'Échec suppression');
        return;
      }
      toast.success(
        `Transferts supprimés : ${r.deleted ?? 0}` +
          (r.skipped && r.skipped > 0
            ? ` · ${r.skipped} skip (lien apparu)`
            : ''),
      );
      setReport(null);
    });

  return (
    <div className="flex flex-col gap-2 items-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={detect}
      >
        <ArrowLeftRight size={13} strokeWidth={2} className="mr-1.5" />
        {pending ? 'Détection…' : 'Nettoyer transferts internes'}
      </Button>
      {report && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 px-3 py-2.5 text-[12.5px] max-w-md">
          <div className="font-medium text-amber-900 dark:text-amber-200 mb-1">
            {report.totalDeletable} transfert{report.totalDeletable > 1 ? 's' : ''} interne{report.totalDeletable > 1 ? 's' : ''} mal classé{report.totalDeletable > 1 ? 's' : ''} ({formatAmount(report.totalAmount)})
          </div>
          <p className="text-amber-900/90 dark:text-amber-200/90 mb-2">
            Détectés : dépôts caisse / billets / espèces importés à tort
            comme recettes (bug encoding pré-fix).
            {report.totalKeptDespite > 0 && (
              <> {report.totalKeptDespite} gardé{report.totalKeptDespite > 1 ? 's' : ''} car liens enrichis.</>
            )}
          </p>
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => setReport(null)}
              className="text-[12px] text-fg-muted hover:text-fg"
            >
              Annuler
            </button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending || report.totalDeletable === 0}
              onClick={execute}
            >
              Supprimer {report.totalDeletable}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
