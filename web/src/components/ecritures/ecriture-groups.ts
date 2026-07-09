import type { Ecriture } from '@/lib/types';

// Trois familles de regroupement, disjointes en pratique, par ordre de
// priorité (bank > cw > ventil) :
//   - 'bank'   : sous-lignes d'un même paiement bancaire (ligne_bancaire_id) —
//     typiquement des brouillons issus du rapprochement, sans id Comptaweb.
//   - 'cw'     : ventilations d'une même écriture Comptaweb
//     (comptaweb_ecriture_id) — une écriture CW « 1171 € » éclatée en
//     plusieurs lignes (568 Formation, 431 Participation, …), chacune une
//     écriture Baloo distincte (grain ventilation, cf. ADR-035).
//   - 'ventil' : ventilations d'une même écriture locale AVANT matérialisation
//     Comptaweb (ventilation_group_id) — pendant local du groupe 'cw', posé
//     dès la saisie multi-ventilation (Task 1) tant qu'aucun
//     comptaweb_ecriture_id n'existe encore.
export type GroupKind = 'bank' | 'cw' | 'ventil';

export interface Group {
  kind: GroupKind;
  id: string;
  label: string;
  sublabel: string;
  totalCents: number; // signé (dépenses négatives, recettes positives)
  count: number;
}

export interface HeaderItem {
  kind: 'header';
  group: Group;
}

export interface RowItem {
  kind: 'row';
  ecriture: Ecriture;
  group: Group | null;
}

export type Item = HeaderItem | RowItem;

export const groupKey = (kind: GroupKind, id: string): string => `${kind}-${id}`;

function signedTotal(entries: Ecriture[]): number {
  return entries.reduce((sum, e) => sum + (e.type === 'depense' ? -e.amount_cents : e.amount_cents), 0);
}

// Extrait l'intitulé parent bancaire depuis les notes de draft
// (format "… (intitulé parent: PAIEMENT C. PROC XXX).").
function parseIntituleParent(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/intitulé parent:\s*([^)]+)\)?/);
  return m ? m[1].trim().replace(/\s*\.\.\.$/, '') : null;
}

// Construit la liste d'items rendus (header + rows) pour la table écritures,
// en pré-calculant les trois familles de groupes. Fonction pure — aucune
// dépendance React — pour rester testable sans monter le composant.
export function buildEcritureGroups(rows: Ecriture[]): Item[] {
  const byBank = new Map<number, Ecriture[]>();
  const byCw = new Map<number, Ecriture[]>();
  const byVentil = new Map<string, Ecriture[]>();
  for (const e of rows) {
    if (e.ligne_bancaire_id) {
      (byBank.get(e.ligne_bancaire_id) ?? byBank.set(e.ligne_bancaire_id, []).get(e.ligne_bancaire_id)!).push(e);
    }
    if (e.comptaweb_ecriture_id != null) {
      (byCw.get(e.comptaweb_ecriture_id) ?? byCw.set(e.comptaweb_ecriture_id, []).get(e.comptaweb_ecriture_id)!).push(e);
    }
    if (e.ventilation_group_id) {
      (byVentil.get(e.ventilation_group_id) ?? byVentil.set(e.ventilation_group_id, []).get(e.ventilation_group_id)!).push(e);
    }
  }
  const isBankGrouped = (id: number): boolean => {
    const b = byBank.get(id) ?? [];
    return b.length > 1 || (b.length === 1 && b[0].ligne_bancaire_sous_index !== null);
  };
  const isCwGrouped = (id: number): boolean => (byCw.get(id)?.length ?? 0) >= 2;
  const isVentilGrouped = (id: string): boolean => (byVentil.get(id)?.length ?? 0) >= 2;

  const groupFor = (e: Ecriture): Group | null => {
    if (e.ligne_bancaire_id && isBankGrouped(e.ligne_bancaire_id)) {
      const entries = byBank.get(e.ligne_bancaire_id)!;
      return {
        kind: 'bank',
        id: String(e.ligne_bancaire_id),
        label: parseIntituleParent(entries[0].notes) ?? `Ligne bancaire #${e.ligne_bancaire_id}`,
        sublabel: `#${e.ligne_bancaire_id}`,
        totalCents: signedTotal(entries),
        count: entries.length,
      };
    }
    if (e.comptaweb_ecriture_id != null && isCwGrouped(e.comptaweb_ecriture_id)) {
      const entries = byCw.get(e.comptaweb_ecriture_id)!;
      return {
        kind: 'cw',
        id: String(e.comptaweb_ecriture_id),
        label: entries[0].description,
        sublabel: entries[0].numero_piece ? `pièce ${entries[0].numero_piece}` : `écriture CW #${e.comptaweb_ecriture_id}`,
        totalCents: signedTotal(entries),
        count: entries.length,
      };
    }
    if (e.ventilation_group_id && isVentilGrouped(e.ventilation_group_id)) {
      const entries = byVentil.get(e.ventilation_group_id)!;
      return {
        kind: 'ventil',
        id: e.ventilation_group_id,
        label: entries[0].description,
        sublabel: entries[0].date_ecriture,
        totalCents: signedTotal(entries),
        count: entries.length,
      };
    }
    return null;
  };

  const seen = new Set<string>();
  const out: Item[] = [];
  for (const e of rows) {
    const group = groupFor(e);
    if (group) {
      const gk = groupKey(group.kind, group.id);
      if (!seen.has(gk)) {
        seen.add(gk);
        out.push({ kind: 'header', group });
      }
    }
    out.push({ kind: 'row', ecriture: e, group });
  }
  return out;
}
