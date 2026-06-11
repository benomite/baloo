import { describe, it, expect } from 'vitest';
import { validateCloture, buildAvancesSummary, type AvanceLike } from './camp-avances-logic';

const avance = (over: Partial<AvanceLike> = {}): AvanceLike => ({
  montant_cents: 30000,
  montant_rendu_cents: null,
  statut: 'versee',
  ...over,
});

describe('validateCloture', () => {
  it('accepte un rendu entre 0 et le montant', () => {
    expect(validateCloture(30000, 0)).toBeNull();
    expect(validateCloture(30000, 4250)).toBeNull();
    expect(validateCloture(30000, 30000)).toBeNull();
  });
  it('refuse un rendu négatif ou NaN', () => {
    expect(validateCloture(30000, -1)).toMatch(/invalide/i);
    expect(validateCloture(30000, NaN)).toMatch(/invalide/i);
  });
  it('refuse un rendu supérieur au montant versé', () => {
    expect(validateCloture(30000, 30001)).toMatch(/dépasser/i);
  });
  it('refuse un rendu non entier (centimes)', () => {
    expect(validateCloture(30000, 42.5)).toMatch(/invalide/i);
  });
});

describe('buildAvancesSummary', () => {
  it('liste vide → tout à zéro', () => {
    expect(buildAvancesSummary([])).toEqual({
      totalVerseCents: 0,
      enCirculationCents: 0,
      totalRenduCents: 0,
      consommeCents: 0,
      enCoursCount: 0,
    });
  });
  it('avance versée non clôturée = en circulation', () => {
    const s = buildAvancesSummary([avance()]);
    expect(s.totalVerseCents).toBe(30000);
    expect(s.enCirculationCents).toBe(30000);
    expect(s.totalRenduCents).toBe(0);
    expect(s.consommeCents).toBe(0);
    expect(s.enCoursCount).toBe(1);
  });
  it('avance clôturée : consommé = versé - rendu', () => {
    const s = buildAvancesSummary([
      avance({ statut: 'cloturee', montant_rendu_cents: 4250 }),
    ]);
    expect(s.enCirculationCents).toBe(0);
    expect(s.totalRenduCents).toBe(4250);
    expect(s.consommeCents).toBe(25750);
    expect(s.enCoursCount).toBe(0);
  });
  it('mix versées + clôturées : sommes correctes', () => {
    const s = buildAvancesSummary([
      avance(),
      avance({ montant_cents: 10000, statut: 'cloturee', montant_rendu_cents: 1000 }),
    ]);
    expect(s.totalVerseCents).toBe(40000);
    expect(s.enCirculationCents).toBe(30000);
    expect(s.totalRenduCents).toBe(1000);
    expect(s.consommeCents).toBe(9000);
    expect(s.enCoursCount).toBe(1);
  });
  it('clôturée sans rendu renseigné → rendu compté 0', () => {
    const s = buildAvancesSummary([
      avance({ statut: 'cloturee', montant_rendu_cents: null }),
    ]);
    expect(s.totalRenduCents).toBe(0);
    expect(s.consommeCents).toBe(30000);
  });
});
