'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Input } from '@/components/ui/input';
import type { Category, Unite, Carte } from '@/lib/types';

export function EcritureFilters({ categories, unites, cartes, current }: {
  categories: Category[];
  unites: Unite[];
  cartes: Carte[];
  current: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function update(key: string, value: string) {
    const params = new URLSearchParams();
    Object.entries(current).forEach(([k, v]) => { if (v) params.set(k, v); });
    if (value) params.set(key, value); else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  const clearAll = () => router.push(pathname);
  const hasActive =
    !!current.type || !!current.unite_id || !!current.category_id
    || !!current.status || !!current.search || !!current.month
    || !!current.carte_id;

  return (
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      <select className="border rounded px-2 py-1 text-sm" value={current.type ?? ''} onChange={e => update('type', e.target.value)}>
        <option value="">Tous types</option>
        <option value="depense">Dépenses</option>
        <option value="recette">Recettes</option>
      </select>
      <select className="border rounded px-2 py-1 text-sm" value={current.unite_id ?? ''} onChange={e => update('unite_id', e.target.value)}>
        <option value="">Toutes unités</option>
        {unites.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
      </select>
      <select className="border rounded px-2 py-1 text-sm" value={current.category_id ?? ''} onChange={e => update('category_id', e.target.value)}>
        <option value="">Toutes catégories</option>
        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className="border rounded px-2 py-1 text-sm" value={current.carte_id ?? ''} onChange={e => update('carte_id', e.target.value)}>
        <option value="">Toutes cartes</option>
        {cartes.map(c => (
          <option key={c.id} value={c.id}>
            {c.type === 'procurement' ? 'Proc' : 'CB'} — {c.porteur}
          </option>
        ))}
      </select>
      <select className="border rounded px-2 py-1 text-sm" value={current.status ?? ''} onChange={e => update('status', e.target.value)}>
        <option value="">Tous statuts</option>
        <option value="brouillon">Brouillon</option>
        <option value="valide">Validé</option>
        <option value="saisie_comptaweb">Saisie Comptaweb</option>
      </select>
      <input
        type="month"
        className="border rounded px-2 py-1 text-sm"
        value={current.month ?? ''}
        onChange={(e) => update('month', e.target.value)}
        aria-label="Filtrer par mois"
      />
      <Input
        placeholder="Rechercher (Entrée)…"
        className="w-48 h-8 text-sm"
        defaultValue={current.search ?? ''}
        onKeyDown={e => { if (e.key === 'Enter') update('search', (e.target as HTMLInputElement).value); }}
      />
      {hasActive && (
        <button
          type="button"
          onClick={clearAll}
          className="text-xs text-muted-foreground hover:text-foreground underline px-1"
        >
          réinitialiser
        </button>
      )}
    </div>
  );
}
