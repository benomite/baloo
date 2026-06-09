import { describe, it, expect } from 'vitest';
import { suggestMatchForEcriture } from './ecriture-match';

const depot = (over = {}) => ({ id: 'DEP1', amount_cents: 5000, date_estimee: '2026-01-10', titre: 'Courses', uniteCode: 'PC', categoryName: 'Intendance', ...over });
const remb = (over = {}) => ({ id: 'RBT1', total_cents: 5000, date_depense: '2026-01-10', demandeur: 'Alice', uniteCode: 'LJ', status: 'virement_effectue', ...over });
const ecr = { amount_cents: 5000, date_ecriture: '2026-01-10' };

describe('suggestMatchForEcriture', () => {
  it('match dépôt exact → champs d\'affichage', () => {
    expect(suggestMatchForEcriture(ecr, [depot()], [])).toEqual({
      kind: 'depot', id: 'DEP1', label: 'Courses', amountCents: 5000, date: '2026-01-10', uniteCode: 'PC', detail: 'Intendance',
    });
  });
  it('match remboursement → champs d\'affichage', () => {
    expect(suggestMatchForEcriture(ecr, [], [remb()])).toEqual({
      kind: 'remboursement', id: 'RBT1', label: 'Alice', amountCents: 5000, date: '2026-01-10', uniteCode: 'LJ', detail: 'virement_effectue',
    });
  });
  it('tolérance ±10% / ±15j', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: 5400, date_estimee: '2026-01-22' })], [])).not.toBeNull();
  });
  it('rejet hors tolérance montant', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: 6000 })], [])).toBeNull();
  });
  it('rejet hors tolérance date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ date_estimee: '2026-02-15' })], [])).toBeNull();
  });
  it('plancher 1€', () => {
    expect(suggestMatchForEcriture({ amount_cents: 200, date_ecriture: '2026-01-10' }, [depot({ amount_cents: 250 })], [])).not.toBeNull();
  });
  it('ignore dépôt sans montant ou sans date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: null }), depot({ date_estimee: null })], [])).toBeNull();
  });
  it('à égalité de date, préfère le dépôt', () => {
    expect(suggestMatchForEcriture(ecr, [depot()], [remb()])?.kind).toBe('depot');
  });
  it('choisit le plus proche en date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ id: 'LOIN', date_estimee: '2026-01-20' }), depot({ id: 'PROCHE', date_estimee: '2026-01-11' })], [])?.id).toBe('PROCHE');
  });
});
