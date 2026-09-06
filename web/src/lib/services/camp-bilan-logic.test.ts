import { describe, it, expect } from 'vitest';
import {
  buildBilanResultat,
  classerJustifs,
  aggregerDepensesParCategorie,
  type BilanEcriture,
} from './camp-bilan-logic';

const ecr = (over: Partial<BilanEcriture> = {}): BilanEcriture => ({
  id: 'E1',
  date_ecriture: '2026-07-10',
  description: 'Intendance',
  amount_cents: 10000,
  type: 'depense',
  category_id: 'cat-int',
  category_name: 'Intendance',
  has_justificatif: 0,
  remboursement_id: null,
  justif_attendu: 1,
  ...over,
});

describe('buildBilanResultat', () => {
  it('résultat = recettes encaissées − dépenses', () => {
    const r = buildBilanResultat(
      [
        ecr({ id: 'R1', type: 'recette', amount_cents: 588000 }),
        ecr({ id: 'D1', amount_cents: 86400 }),
        ecr({ id: 'D2', amount_cents: 37600 }),
      ],
      0,
    );
    expect(r.recettesCents).toBe(588000);
    expect(r.depensesCents).toBe(124000);
    expect(r.resultatCents).toBe(464000);
  });

  it('les tickets déposés non rapprochés ne bougent pas le résultat, seulement le projeté', () => {
    const r = buildBilanResultat([ecr({ id: 'R1', type: 'recette', amount_cents: 100000 }), ecr({ amount_cents: 30000 })], 25000);
    expect(r.resultatCents).toBe(70000);
    expect(r.depotsEnAttenteCents).toBe(25000);
    expect(r.resultatProjeteCents).toBe(45000);
  });

  it('camp sans écriture → tout à zéro', () => {
    expect(buildBilanResultat([], 0)).toEqual({
      recettesCents: 0,
      depensesCents: 0,
      resultatCents: 0,
      depotsEnAttenteCents: 0,
      resultatProjeteCents: 0,
    });
  });

  it('résultat négatif quand les dépenses dépassent les recettes', () => {
    const r = buildBilanResultat([ecr({ amount_cents: 50000 })], 0);
    expect(r.resultatCents).toBe(-50000);
  });
});

describe('classerJustifs', () => {
  it('une dépense sans justif, justif attendu, sans remboursement → manquante', () => {
    const r = classerJustifs([ecr({ id: 'D1' })]);
    expect(r.manquants.map((e) => e.id)).toEqual(['D1']);
    expect(r.couvertsParRemboursement).toEqual([]);
    expect(r.nonAttendus).toEqual([]);
  });

  it('une dépense avec justif attaché n’apparaît nulle part', () => {
    const r = classerJustifs([ecr({ id: 'D1', has_justificatif: 1 })]);
    expect(r).toEqual({ manquants: [], couvertsParRemboursement: [], nonAttendus: [] });
  });

  it('une dépense liée à un remboursement est classée couverte, même si le justif est attendu', () => {
    const r = classerJustifs([ecr({ id: 'D1', remboursement_id: 'REMB-1', justif_attendu: 1 })]);
    expect(r.couvertsParRemboursement.map((e) => e.id)).toEqual(['D1']);
    expect(r.manquants).toEqual([]);
  });

  it('une dépense marquée justif non attendu est classée à part', () => {
    const r = classerJustifs([ecr({ id: 'D1', justif_attendu: 0 })]);
    expect(r.nonAttendus.map((e) => e.id)).toEqual(['D1']);
    expect(r.manquants).toEqual([]);
  });

  it('les recettes ne sont jamais classées comme justif manquant', () => {
    const r = classerJustifs([ecr({ id: 'R1', type: 'recette', has_justificatif: 0 })]);
    expect(r).toEqual({ manquants: [], couvertsParRemboursement: [], nonAttendus: [] });
  });

  it('conserve l’ordre d’entrée dans chaque section', () => {
    const r = classerJustifs([
      ecr({ id: 'D1', date_ecriture: '2026-07-20' }),
      ecr({ id: 'D2', date_ecriture: '2026-07-10' }),
    ]);
    expect(r.manquants.map((e) => e.id)).toEqual(['D1', 'D2']);
  });
});

describe('aggregerDepensesParCategorie', () => {
  it('agrège les dépenses par catégorie en conservant l’identifiant de poste', () => {
    const r = aggregerDepensesParCategorie([
      ecr({ id: 'D1', amount_cents: 1000 }),
      ecr({ id: 'D2', amount_cents: 500 }),
    ]);
    expect(r).toEqual([{ categoryId: 'cat-int', categoryName: 'Intendance', amountCents: 1500 }]);
  });

  it('ignore les recettes', () => {
    const r = aggregerDepensesParCategorie([ecr({ id: 'R1', type: 'recette', amount_cents: 9000 })]);
    expect(r).toEqual([]);
  });

  it('regroupe les dépenses sans catégorie sur une ligne à part', () => {
    const r = aggregerDepensesParCategorie([
      ecr({ id: 'D1', category_id: null, category_name: null, amount_cents: 200 }),
      ecr({ id: 'D2', category_id: null, category_name: null, amount_cents: 300 }),
      ecr({ id: 'D3', amount_cents: 100 }),
    ]);
    expect(r).toEqual([
      { categoryId: null, categoryName: null, amountCents: 500 },
      { categoryId: 'cat-int', categoryName: 'Intendance', amountCents: 100 },
    ]);
  });
});
