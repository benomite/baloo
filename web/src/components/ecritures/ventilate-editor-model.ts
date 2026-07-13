// Logique pure de la grille d'imputation (spec 2026-07-13 v2). Lignes
// AUTONOMES : chaque ligne porte ses 3 dimensions CW (catégorie, unité,
// activité) + un montant. Total FIGÉ. Aucune dépendance React/DOM.

import { parseAmount } from '@/lib/format';

export interface VentLine {
  id: string;
  amount: string;
  category_id: string | null;
  unite_id: string | null;
  activite_id: string | null;
}

export interface ResolvedVentilation {
  amount_cents: number;
  category_id: string | null;
  unite_id: string | null;
  activite_id: string | null;
}

export function resolveVentilations(rows: VentLine[]): ResolvedVentilation[] {
  return rows.map((r) => ({
    amount_cents: parseAmount(r.amount || '0'),
    category_id: r.category_id || null,
    unite_id: r.unite_id || null,
    activite_id: r.activite_id || null,
  }));
}

export function editorRemainderCents(totalCents: number, rows: VentLine[]): number {
  return totalCents - rows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0);
}

export function isMultiCategory(rows: VentLine[]): boolean {
  return rows.length >= 2;
}

export function canSaveVentilation(totalCents: number, rows: VentLine[]): boolean {
  if (rows.length < 1) return false;
  if (editorRemainderCents(totalCents, rows) !== 0) return false;
  return resolveVentilations(rows).every(
    (v) => v.amount_cents !== 0 && v.category_id !== null && v.unite_id !== null && v.activite_id !== null,
  );
}
