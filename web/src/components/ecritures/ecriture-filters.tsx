'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Download, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { Category, Unite, Carte } from '@/lib/types';

// Filtres écritures : barre principale = recherche full-text large
// (description, notes, n° pièce, id, libellés joints, montant).
// Les filtres précis (type, unité, catégorie, mode, mois) restent
// disponibles dans un panneau "Avancés" replié par défaut — usage
// occasionnel. Ctrl/Cmd+F intercepté pour focus le champ recherche
// (au lieu d'ouvrir la recherche native du navigateur, peu utile sur
// une longue liste paginée).

export function EcritureFilters({
  categories,
  unites,
  cartes,
  current,
}: {
  categories: Category[];
  unites: Unite[];
  cartes: Carte[];
  current: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl+F / Cmd+F → focus le champ recherche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const el = searchRef.current;
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function update(key: string, value: string) {
    const params = new URLSearchParams();
    Object.entries(current).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  const clearAll = () => router.push(pathname);
  const advancedActive = !!(current.type || current.unite_id || current.category_id || current.status || current.month || current.carte_id);
  const advancedCount = [current.type, current.unite_id, current.category_id, current.status, current.month, current.carte_id].filter(Boolean).length;
  const hasAnyActive = advancedActive || !!current.search;

  // Lien export CSV : on garde tous les filtres actifs.
  const exportParams = new URLSearchParams();
  Object.entries(current).forEach(([k, v]) => {
    if (v) exportParams.set(k, v);
  });
  const exportHref = `/api/ecritures/export?${exportParams.toString()}`;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Recherche full-text — l'élément central */}
        <div className="relative flex-1 min-w-[240px]">
          <Search
            size={14}
            strokeWidth={2}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
          />
          <Input
            ref={searchRef}
            placeholder="Rechercher (description, montant, n° pièce, unité…)  ⌘F / Ctrl+F"
            className="pl-9 h-9"
            defaultValue={current.search ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') update('search', (e.target as HTMLInputElement).value);
              if (e.key === 'Escape') {
                (e.target as HTMLInputElement).value = '';
                update('search', '');
              }
            }}
          />
        </div>

        {/* Filtres avancés en disclosure */}
        <details className="relative group/adv">
          <summary
            className={`cursor-pointer list-none inline-flex items-center gap-1.5 px-3 h-9 rounded-md border text-[12.5px] font-medium transition-colors ${
              advancedActive
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border-soft bg-bg-elevated text-fg-muted hover:text-fg hover:border-border-strong'
            }`}
          >
            <SlidersHorizontal size={13} strokeWidth={2} />
            Filtres
            {advancedActive && (
              <span className="ml-0.5 size-4 rounded-full bg-brand text-white text-[10px] font-semibold flex items-center justify-center">
                {advancedCount}
              </span>
            )}
          </summary>
          <div className="absolute right-0 mt-2 z-10 w-[min(640px,90vw)] rounded-lg border border-border-soft bg-bg-elevated shadow-lg p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <NativeSelect
              aria-label="Type"
              value={current.type ?? ''}
              onChange={(e) => update('type', e.target.value)}
            >
              <option value="">Tous types</option>
              <option value="depense">Dépenses</option>
              <option value="recette">Recettes</option>
            </NativeSelect>
            <NativeSelect
              aria-label="Unité"
              value={current.unite_id ?? ''}
              onChange={(e) => update('unite_id', e.target.value)}
            >
              <option value="">Toutes unités</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Catégorie"
              value={current.category_id ?? ''}
              onChange={(e) => update('category_id', e.target.value)}
            >
              <option value="">Toutes catégories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Carte"
              value={current.carte_id ?? ''}
              onChange={(e) => update('carte_id', e.target.value)}
            >
              <option value="">Toutes cartes</option>
              {cartes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type === 'procurement' ? 'Proc' : 'CB'} — {c.porteur}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Statut"
              value={current.status ?? ''}
              onChange={(e) => update('status', e.target.value)}
            >
              <option value="">Tous statuts</option>
              <option value="brouillon">Brouillon</option>
              <option value="valide">Validé</option>
              <option value="saisie_comptaweb">Saisie Comptaweb</option>
            </NativeSelect>
            <Input
              type="month"
              aria-label="Filtrer par mois"
              value={current.month ?? ''}
              onChange={(e) => update('month', e.target.value)}
              className="tabular-nums"
            />
          </div>
        </details>

        {hasAnyActive && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg transition-colors px-2 h-9"
          >
            <RotateCcw size={12} strokeWidth={2} />
            Réinit
          </button>
        )}

        <a
          href={exportHref}
          className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand hover:underline underline-offset-2 px-2 h-9 leading-none flex items-center"
          style={{ alignItems: 'center' }}
        >
          <Download size={13} strokeWidth={2} />
          Exporter CSV
        </a>
      </div>
    </div>
  );
}
