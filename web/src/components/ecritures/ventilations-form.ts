// Helper pur pour le répéteur de ventilations du wizard `/ecritures/nouveau`
// (Task 7 du pivot multi-ventilation, S0). Aucune dépendance React/DOM :
// transforme l'état local `VentilationDraft[]` en payload API et calcule
// le reste à ventiler pour piloter l'UI (alerte + désactivation du submit).

import { parseAmount } from '@/lib/format';

export interface VentilationDraft {
  amount: string;
  category_id: string | null;
  unite_id: string | null;
  activite_id: string | null;
}

// Ligne de ventilation côté UI (répéteur `/ecritures/nouveau`), avec un
// id stable pour les clés React — volontairement indépendant de la
// position dans le tableau. Sans ça, supprimer une ligne au milieu du
// répéteur ferait réutiliser l'instance React (et l'état interne
// uncontrolled de `CategoryPicker`) de la ligne suivante à la mauvaise
// position, désynchronisant l'affichage de la vraie valeur sélectionnée.
export interface VentilationRow extends VentilationDraft {
  id: string;
}

export interface VentilationPayload {
  amount_cents: number;
  category_id: string | null;
  unite_id: string | null;
  activite_id: string | null;
}

export function ventilationsToPayload(rows: VentilationDraft[]): VentilationPayload[] {
  return rows.map((r) => ({
    amount_cents: parseAmount(r.amount || '0'),
    category_id: r.category_id || null,
    unite_id: r.unite_id || null,
    activite_id: r.activite_id || null,
  }));
}

export function ventilationsRemainderCents(totalCents: number, rows: VentilationDraft[]): number {
  return totalCents - rows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0);
}
