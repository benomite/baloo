// Logique pure de l'éditeur de ventilation d'un draft (modèle « défauts
// globaux + lignes légères », cf. spec 2026-07-13). Aucune dépendance
// React/DOM : résout les lignes UI en ventilations résolues, calcule le
// reste à ventiler (total FIGÉ) et l'état d'activation du bouton d'enreg.

import { parseAmount } from '@/lib/format';

export interface DefaultImputation {
  unite_id: string | null;
  activite_id: string | null;
}

// Une ligne de détail : catégorie + montant, et une surcharge optionnelle
// unité/activité (le ⚙). `override === null` → hérite du bloc « défaut ».
export interface DetailRow {
  id: string;
  amount: string;
  category_id: string | null;
  override: DefaultImputation | null;
}

export interface ResolvedVentilation {
  amount_cents: number;
  category_id: string | null;
  unite_id: string | null;
  activite_id: string | null;
}

export function resolveVentilations(defaults: DefaultImputation, rows: DetailRow[]): ResolvedVentilation[] {
  return rows.map((r) => {
    const imp = r.override ?? defaults;
    return {
      amount_cents: parseAmount(r.amount || '0'),
      category_id: r.category_id || null,
      unite_id: imp.unite_id || null,
      activite_id: imp.activite_id || null,
    };
  });
}

export function editorRemainderCents(totalCents: number, rows: DetailRow[]): number {
  return totalCents - rows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0);
}

export function isMultiCategory(rows: DetailRow[]): boolean {
  return rows.length >= 2;
}

export function canSaveVentilation(totalCents: number, defaults: DefaultImputation, rows: DetailRow[]): boolean {
  if (rows.length < 1) return false;
  if (editorRemainderCents(totalCents, rows) !== 0) return false;
  const resolved = resolveVentilations(defaults, rows);
  return resolved.every(
    (v) => v.amount_cents !== 0 && v.category_id !== null && v.unite_id !== null && v.activite_id !== null,
  );
}
