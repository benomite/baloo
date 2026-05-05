'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  detectEcritureDuplicates,
  deleteEcritureDuplicates,
} from '@/lib/actions/comptaweb-import';
import type { DedupGroup } from '@/lib/services/dedup-ecritures';

// Bouton de nettoyage des doublons d'écritures CSV. Workflow en 2 temps :
// 1. clic → "Détecter" : appelle detectEcritureDuplicates (dry-run),
//    affiche la liste détaillée par groupe avec checkboxes
// 2. confirmation explicite → "Supprimer N doublons" : exécute pour de vrai
//
// Chaque groupe est affiché avec : date, montant, type, et pour chaque
// candidat la description, piece, catégorie, unité, notes — ce qui
// permet de juger visuellement si c'est un vrai doublon ou 2 ventilations
// distinctes que le matching aurait confondues.
//
// Règle "JAMAIS de DELETE" préservée : on ne supprime QUE les doublons
// sans aucun lien externe (justif uploadé, dépôt rattaché, remb lié).

function fmtAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${(abs / 100).toFixed(2).replace('.', ',')} €`;
}

export function DedupEcrituresButton() {
  const [pending, startTransition] = useTransition();
  const [groups, setGroups] = useState<DedupGroup[] | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const detect = () =>
    startTransition(async () => {
      const r = await detectEcritureDuplicates();
      if (!r.ok) {
        toast.error(r.error ?? 'Échec de la détection');
        return;
      }
      if (r.totalDuplicates === 0) {
        toast.success('Aucun doublon détecté.');
        setGroups(null);
        return;
      }
      setGroups(r.groups);
      setUnchecked(new Set());
    });

  const selectedIds = useMemo(() => {
    if (!groups) return [];
    return groups.flatMap((g) => g.toDeleteIds).filter((id) => !unchecked.has(id));
  }, [groups, unchecked]);

  const execute = () =>
    startTransition(async () => {
      if (selectedIds.length === 0) return;
      const r = await deleteEcritureDuplicates(selectedIds);
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
      setGroups(null);
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
        {pending ? 'Détection…' : 'Détecter les doublons'}
      </Button>
      {groups && groups.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 text-[12.5px] w-full max-w-3xl">
          <div className="font-medium text-amber-900 dark:text-amber-200 mb-2">
            {groups.length} groupe{groups.length > 1 ? 's' : ''} de doublons —
            décoche les écritures que tu veux garder.
          </div>
          <div className="max-h-[60vh] overflow-y-auto space-y-3 mb-3 pr-1">
            {groups.map((g, gi) => {
              const keep = g.candidates.find((c) => c.id === g.keepId);
              const dups = g.candidates.filter((c) => c.id !== g.keepId);
              return (
                <div key={gi} className="rounded border border-amber-200 dark:border-amber-900/30 bg-white/60 dark:bg-zinc-900/30 p-2">
                  <div className="text-[12px] text-amber-900/80 dark:text-amber-200/80 mb-1.5">
                    {g.date} · {fmtAmount(g.amount_cents)} · {g.type}
                  </div>
                  {keep && (
                    <div className="mb-1.5 pl-1 border-l-2 border-emerald-500 text-emerald-900 dark:text-emerald-200">
                      <span className="text-[11px] uppercase tracking-wide font-semibold">À garder</span>
                      <CandidateRow c={keep} />
                    </div>
                  )}
                  {dups.map((c) => {
                    const willDelete = !c.has_links && !unchecked.has(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`flex gap-2 mb-1 pl-1 border-l-2 cursor-pointer ${
                          willDelete
                            ? 'border-red-500 text-red-900 dark:text-red-200'
                            : 'border-zinc-300 dark:border-zinc-700 text-fg-muted line-through opacity-70'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          checked={willDelete}
                          disabled={c.has_links}
                          onChange={() => toggle(c.id)}
                        />
                        <div className="flex-1">
                          <span className="text-[11px] uppercase tracking-wide font-semibold">
                            {c.has_links ? 'Gardé (liens)' : willDelete ? 'À supprimer' : 'Décoché'}
                          </span>
                          <CandidateRow c={c} />
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setGroups(null); setUnchecked(new Set()); }}
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
              Supprimer {selectedIds.length} doublon{selectedIds.length > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ c }: { c: DedupGroup['candidates'][number] }) {
  return (
    <div className="text-[12.5px] leading-snug">
      <div className="font-medium">{c.description || <em className="opacity-60">(sans description)</em>}</div>
      <div className="text-[11.5px] opacity-80 flex flex-wrap gap-x-3 gap-y-0.5">
        <span>id: <code className="text-[10.5px]">{c.id}</code></span>
        {c.numero_piece && <span>piece: <code className="text-[10.5px]">{c.numero_piece}</code></span>}
        {c.category_name && <span>cat: {c.category_name}</span>}
        {c.unite_name && <span>unité: {c.unite_name}</span>}
      </div>
      {c.notes && (
        <div className="text-[11px] opacity-60 truncate" title={c.notes}>{c.notes}</div>
      )}
    </div>
  );
}
