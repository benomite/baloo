'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { EcrituresTable } from './ecritures-table';
import { fetchEcrituresPage } from '@/lib/actions/ecritures';
import type { EcritureFilters } from '@/lib/queries/ecritures';
import type { EcritureJustifsBundle } from '@/lib/queries/justificatifs';
import type { DepotEnriched } from '@/lib/services/depots';
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
  detail: { ecriture: Ecriture; justifsBundle: EcritureJustifsBundle; pendingDepots: DepotEnriched[] } | null;
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
  detail,
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
        detail={detail}
        topCategoryIds={topCategoryIds}
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
