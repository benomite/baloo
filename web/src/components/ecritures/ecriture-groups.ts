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

// Un groupe multi-ventilation (`cw` ou `ventil`, count ≥ 2) est rendu comme
// UNE ligne consolidée — pas un en-tête + N lignes. Le détail des N
// ventilations s'ouvre dans le panneau (grille). Cf. brief consolidation.
export interface AggregateItem {
  kind: 'aggregate';
  group: Group;       // le groupe (cw ou ventil), avec totalCents signé et count
  head: Ecriture;     // la 1ʳᵉ ligne du groupe (id pour panneau/sélection)
  members: Ecriture[]; // toutes les ventilations du groupe
}

export type Item = HeaderItem | RowItem | AggregateItem;

export const groupKey = (kind: GroupKind, id: string): string => `${kind}-${id}`;

// Une ligne est « catégorie multiple » quand elle est l'une des ≥2 ventilations
// d'un même groupe (peu importe la famille : `ventil` local OU `cw` déjà
// matérialisé dans Comptaweb) : chaque ventilation porte sa propre catégorie,
// donc au niveau du groupe la catégorie n'a pas de sens unique → on affiche
// « Catégories multiples » (non éditable) plutôt que le picker de catégorie de
// la ligne. Pour un groupe `cw` encore éditable (fenêtre pending_sync), le
// picker serait trompeur : modifier la catégorie localement ne répercute rien
// côté CW. Un groupe mono (count 1, ou groupe bank d'une seule sous-ligne)
// garde son picker. Fonction pure (pas de React) — testable.
export function isMultiCategoryRow(group: Group | null | undefined): boolean {
  return group != null && group.count >= 2;
}

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
  const byCw = new Map<number, Ecriture[]>();
  const byVentil = new Map<string, Ecriture[]>();
  // 1ʳᵉ passe : remplir les familles multi-ventilation (cw / ventil), qui
  // sont PRIORITAIRES sur la banque. On les connaît donc avant de remplir
  // `byBank`, ce qui permet d'en exclure les lignes déjà multi-ventilées.
  for (const e of rows) {
    if (e.comptaweb_ecriture_id != null) {
      (byCw.get(e.comptaweb_ecriture_id) ?? byCw.set(e.comptaweb_ecriture_id, []).get(e.comptaweb_ecriture_id)!).push(e);
    }
    if (e.ventilation_group_id) {
      (byVentil.get(e.ventilation_group_id) ?? byVentil.set(e.ventilation_group_id, []).get(e.ventilation_group_id)!).push(e);
    }
  }
  const isCwGrouped = (id: number): boolean => (byCw.get(id)?.length ?? 0) >= 2;
  const isVentilGrouped = (id: string): boolean => (byVentil.get(id)?.length ?? 0) >= 2;

  // Une ligne « multi-ventilée » (groupe cw OU ventil ≥2) est retirée de
  // `byBank` : sinon elle gonflerait le count/total/label « N sous-lignes »
  // du groupe bancaire (stats fausses) alors qu'elle est rendue consolidée.
  const isMultiVentiled = (e: Ecriture): boolean =>
    (e.comptaweb_ecriture_id != null && isCwGrouped(e.comptaweb_ecriture_id)) ||
    (e.ventilation_group_id != null && isVentilGrouped(e.ventilation_group_id));

  const byBank = new Map<number, Ecriture[]>();
  for (const e of rows) {
    if (e.ligne_bancaire_id && !isMultiVentiled(e)) {
      (byBank.get(e.ligne_bancaire_id) ?? byBank.set(e.ligne_bancaire_id, []).get(e.ligne_bancaire_id)!).push(e);
    }
  }
  const isBankGrouped = (id: number): boolean => {
    const b = byBank.get(id) ?? [];
    return b.length > 1 || (b.length === 1 && b[0].ligne_bancaire_sous_index !== null);
  };

  // Priorité : cw → ventil → bank (les groupes multi-ventilation gagnent sur
  // la banque, cf. brief consolidation).
  const groupFor = (e: Ecriture): Group | null => {
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
    return null;
  };

  const membersFor = (group: Group): Ecriture[] => {
    if (group.kind === 'cw') return byCw.get(Number(group.id))!;
    if (group.kind === 'ventil') return byVentil.get(group.id)!;
    return byBank.get(Number(group.id))!;
  };

  const seen = new Set<string>();
  const out: Item[] = [];
  for (const e of rows) {
    const group = groupFor(e);
    // Consolidation réservée aux groupes `ventil` (ventilation locale d'un
    // draft, count ≥2) : eux seuls portent un `ventilation_group_id` qui relie
    // les membres → le panneau peut réafficher les N lignes. Les groupes `cw`
    // (pièce Comptaweb importée) n'ont PAS forcément de `ventilation_group_id` :
    // les consolider masquerait des ventilations dans l'UI (le panneau ne
    // saurait pas retrouver les membres). Ils restent donc en header + membres
    // (lecture de toutes les ventilations), comme les groupes `bank`.
    if (group && group.kind === 'ventil') {
      // UNE ligne consolidée, émise une seule fois (1ʳᵉ occurrence du groupe).
      const gk = groupKey(group.kind, group.id);
      if (!seen.has(gk)) {
        seen.add(gk);
        const members = membersFor(group);
        out.push({ kind: 'aggregate', group, head: members[0], members });
      }
      continue;
    }
    if (group) {
      // Groupe `cw` ou `bank` : header une seule fois + rows membres.
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
