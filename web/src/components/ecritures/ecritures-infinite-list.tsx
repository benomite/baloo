'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { EcrituresTable } from './ecritures-table';
import { fetchEcrituresPage, fetchEcritureRow } from '@/lib/actions/ecritures';
import { useDraftValidation } from './use-draft-validation';
import type { EcritureFilters } from '@/lib/queries/ecritures';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';
import type { MatchDepot, MatchRemboursement } from '@/lib/services/ecriture-match';

interface Props {
  initialEcritures: Ecriture[];
  total: number;
  pageSize: number;
  filters: EcritureFilters;
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
  matchDepots: MatchDepot[];
  matchRembs: MatchRemboursement[];
  rejectedMatchKeys: string[];
  topCategoryIds: string[];
}

/**
 * Chargement progressif (infinite scroll) des écritures. Garde l'ensemble
 * accumulé en mémoire et le passe à `EcrituresTable` — le regroupement par
 * ligne bancaire / écriture Comptaweb reste correct car le tri serveur est
 * déterministe (les pages se concatènent dans le bon ordre, les groupes
 * restent contigus). Un capteur en bas de liste déclenche la page suivante.
 */
export function EcrituresInfiniteList({
  initialEcritures,
  total,
  pageSize,
  filters,
  categories,
  unites,
  modesPaiement,
  activites,
  cartes,
  matchDepots,
  matchRembs,
  rejectedMatchKeys,
  topCategoryIds,
}: Props) {
  const [rows, setRows] = useState<Ecriture[]>(initialEcritures);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialEcritures.length >= total);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  // NB : le reset à chaque changement de filtres est géré par une `key` sur
  // ce composant côté page (remontage propre), pas par un effet de setState.

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const offset = rows.length;
      const { ecritures: next } = await fetchEcrituresPage(filters, offset);
      if (next.length === 0) {
        setDone(true);
      } else {
        // Dédup défensif (au cas où une écriture aurait bougé entre 2 pages).
        setRows((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const merged = [...prev, ...next.filter((e) => !seen.has(e.id))];
          if (merged.length >= total || next.length < pageSize) setDone(true);
          return merged;
        });
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [rows.length, filters, done, total, pageSize]);

  // Rafraîchit UNE ligne après mutation (ex. « Lier ») : re-fetch l'écriture
  // mise à jour et la remplace en place dans `rows` — sans recharger toute la
  // liste ni perdre le scroll / les pages déjà chargées.
  const refreshRow = useCallback(async (id: string) => {
    const fresh = await fetchEcritureRow(id);
    if (fresh) setRows((prev) => prev.map((r) => (r.id === id ? fresh : r)));
  }, []);

  // Au succès d'une validation, la ligne quitte « À traiter » (bouclée).
  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);
  const { validatingIds, validate } = useDraftValidation(removeRow);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '600px' }, // précharge avant d'atteindre le bas
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, done]);

  return (
    <div>
      <EcrituresTable
        ecritures={rows}
        categories={categories}
        unites={unites}
        modesPaiement={modesPaiement}
        activites={activites}
        cartes={cartes}
        matchDepots={matchDepots}
        matchRembs={matchRembs}
        rejectedMatchKeys={rejectedMatchKeys}
        topCategoryIds={topCategoryIds}
        refreshRow={refreshRow}
        validatingIds={validatingIds}
        onValidate={validate}
      />

      <div ref={sentinelRef} className="h-px" aria-hidden />

      <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
        {loading ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            Chargement…
          </>
        ) : done ? (
          rows.length > 0 ? `${rows.length} écriture${rows.length > 1 ? 's' : ''} — tout est chargé` : null
        ) : (
          <button type="button" onClick={() => void loadMore()} className="underline hover:text-foreground">
            Charger plus ({rows.length} / {total})
          </button>
        )}
      </div>
    </div>
  );
}
