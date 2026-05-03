'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Download, RotateCcw, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { Category, Unite, Carte } from '@/lib/types';

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
  const hasActive =
    !!current.type ||
    !!current.unite_id ||
    !!current.category_id ||
    !!current.status ||
    !!current.search ||
    !!current.month ||
    !!current.carte_id;

  // Lien export CSV : on garde tous les filtres actifs.
  const exportParams = new URLSearchParams();
  Object.entries(current).forEach(([k, v]) => {
    if (v) exportParams.set(k, v);
  });
  const exportHref = `/api/ecritures/export?${exportParams.toString()}`;

  return (
    <div className="mb-4 rounded-lg border border-border-soft bg-bg-elevated p-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-2.5">
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            size={13}
            strokeWidth={2}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
          />
          <Input
            placeholder="Rechercher dans description / notes (Entrée)…"
            className="pl-8"
            defaultValue={current.search ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') update('search', (e.target as HTMLInputElement).value);
            }}
          />
        </div>
        {hasActive && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg transition-colors px-2 py-1.5"
          >
            <RotateCcw size={12} strokeWidth={2} />
            Réinitialiser
          </button>
        )}
        <a
          href={exportHref}
          className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand hover:underline underline-offset-2 px-2 py-1.5"
        >
          <Download size={13} strokeWidth={2} />
          Exporter CSV
        </a>
      </div>
    </div>
  );
}
