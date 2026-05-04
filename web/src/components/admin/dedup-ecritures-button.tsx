'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  detectEcritureDuplicates,
  deleteEcritureDuplicates,
} from '@/lib/actions/comptaweb-import';

// Bouton de nettoyage des doublons d'écritures CSV. Workflow en 2 temps :
// 1. clic → "Détecter" : appelle detectEcritureDuplicates (dry-run),
//    affiche un récap + ouvre une modale de confirmation
// 2. confirmation explicite → "Supprimer N doublons" : exécute pour de vrai
//
// Le user voit toujours combien serait supprimé avant de cliquer pour
// confirmer. On ne supprime QUE les doublons sans aucun lien externe
// (justif uploadé, dépôt rattaché, remb lié) — règle "JAMAIS de DELETE"
// préservée pour toute donnée user.

export function DedupEcrituresButton() {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<null | {
    totalDuplicates: number;
    totalDeletable: number;
    totalKeptDespite: number;
    ids: string[];
  }>(null);

  const detect = () =>
    startTransition(async () => {
      const r = await detectEcritureDuplicates();
      if (!r.ok) {
        toast.error(r.error ?? 'Échec de la détection');
        return;
      }
      const ids = r.groups.flatMap((g) => g.toDeleteIds);
      if (r.totalDuplicates === 0) {
        toast.success('Aucun doublon détecté.');
        setReport(null);
        return;
      }
      setReport({
        totalDuplicates: r.totalDuplicates,
        totalDeletable: r.totalDeletable,
        totalKeptDespite: r.totalKeptDespite,
        ids,
      });
    });

  const execute = () =>
    startTransition(async () => {
      if (!report) return;
      const r = await deleteEcritureDuplicates(report.ids);
      if (!r.ok) {
        toast.error(r.error ?? 'Échec de la suppression');
        return;
      }
      toast.success(
        `Doublons supprimés : ${r.deleted ?? 0}` +
          (r.skipped && r.skipped > 0
            ? ` · ${r.skipped} skip (lien apparu entre-temps)`
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
        <AlertTriangle size={13} strokeWidth={2} className="mr-1.5" />
        {pending ? 'Détection…' : 'Détecter les doublons'}
      </Button>
      {report && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 px-3 py-2.5 text-[12.5px] max-w-md">
          <div className="font-medium text-amber-900 dark:text-amber-200 mb-1">
            {report.totalDuplicates} doublon{report.totalDuplicates > 1 ? 's' : ''} trouvé
            {report.totalDuplicates > 1 ? 's' : ''}
          </div>
          <ul className="text-amber-900/90 dark:text-amber-200/90 space-y-0.5 mb-2">
            <li>• <strong>{report.totalDeletable}</strong> sûr{report.totalDeletable > 1 ? 's' : ''} à supprimer (aucun justif/dépôt/remb)</li>
            {report.totalKeptDespite > 0 && (
              <li>• {report.totalKeptDespite} gardé{report.totalKeptDespite > 1 ? 's' : ''} car liens enrichis</li>
            )}
          </ul>
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
              Supprimer {report.totalDeletable} doublon{report.totalDeletable > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
