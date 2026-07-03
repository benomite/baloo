import { describe, it, expect } from 'vitest';
import { suggestMatchForEcriture } from './ecriture-match';
import { rejetPairKey } from '../queries/inbox-matching';

const depot = (over = {}) => ({ id: 'DEP1', amount_cents: 5000, date_estimee: '2026-01-10', titre: 'Courses', uniteCode: 'PC', categoryName: 'Intendance', justifPaths: [] as string[], ...over });
const remb = (over = {}) => ({ id: 'RBT1', total_cents: 5000, date_depense: '2026-01-10', date_paiement: null, demandeur: 'Alice', uniteCode: 'LJ', status: 'virement_effectue', ...over });
const ecr = { id: 'ECR1', amount_cents: 5000, date_ecriture: '2026-01-10', type: 'depense' as const };

describe('suggestMatchForEcriture', () => {
  it('match dépôt exact → champs d\'affichage', () => {
    expect(suggestMatchForEcriture(ecr, [depot()], [])).toEqual({
      kind: 'depot', id: 'DEP1', label: 'Courses', amountCents: 5000, date: '2026-01-10', uniteCode: 'PC', detail: 'Intendance', justifPaths: [],
    });
  });
  it('match remboursement → champs d\'affichage', () => {
    expect(suggestMatchForEcriture(ecr, [], [remb()])).toEqual({
      kind: 'remboursement', id: 'RBT1', label: 'Alice', amountCents: 5000, date: '2026-01-10', uniteCode: 'LJ', detail: 'virement_effectue', justifPaths: [],
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
    expect(suggestMatchForEcriture({ id: 'ECR1', amount_cents: 200, date_ecriture: '2026-01-10', type: 'depense' }, [depot({ amount_cents: 250 })], [])).not.toBeNull();
  });
  it('exclut une paire rejetée (dépôt)', () => {
    const rejected = new Set([rejetPairKey('ECR1', 'depot', 'DEP1')]);
    expect(suggestMatchForEcriture(ecr, [depot()], [], rejected)).toBeNull();
  });
  it('remboursement : matche sur date_paiement (virement), même si date_depense est loin', () => {
    // écriture = virement du 06-04 ; dépense le 05-15 (>15j) ; paiement le 06-04.
    const r = suggestMatchForEcriture(
      { id: 'ECR1', amount_cents: 18173, date_ecriture: '2026-06-04', type: 'depense' },
      [],
      [remb({ total_cents: 18173, date_depense: '2026-05-15', date_paiement: '2026-06-04' })],
    );
    expect(r).not.toBeNull();
    expect(r?.date).toBe('2026-06-04'); // date affichée = virement
  });
  it('exclut une paire rejetée (remboursement)', () => {
    const rejected = new Set([rejetPairKey('ECR1', 'remboursement', 'RBT1')]);
    expect(suggestMatchForEcriture(ecr, [], [remb()], rejected)).toBeNull();
  });
  it('rejette le meilleur match → propose le suivant', () => {
    const rejected = new Set([rejetPairKey('ECR1', 'depot', 'PROCHE')]);
    const r = suggestMatchForEcriture(
      ecr,
      [depot({ id: 'LOIN', date_estimee: '2026-01-20' }), depot({ id: 'PROCHE', date_estimee: '2026-01-11' })],
      [],
      rejected,
    );
    expect(r?.id).toBe('LOIN');
  });
  it('ignore dépôt sans montant ou sans date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: null }), depot({ date_estimee: null })], [])).toBeNull();
  });
  it('ne propose JAMAIS un remboursement pour une recette (entrée d\'argent)', () => {
    // Un remboursement est une SORTIE d'argent → ne peut correspondre qu'à une
    // dépense. Une recette (+45 €) ne doit jamais matcher un remboursement,
    // même à montant/date dans la tolérance. Cf. bug terrain 2026-06 : ligne
    // bancaire +45 € proposée à tort pour un remboursement de 41,24 €.
    const recette = { id: 'ECR1', amount_cents: 4500, date_ecriture: '2026-06-20', type: 'recette' as const };
    expect(suggestMatchForEcriture(recette, [], [remb({ total_cents: 4124, date_paiement: '2026-06-20' })])).toBeNull();
  });
  it('ne propose JAMAIS un dépôt pour une recette (les justifs/dépôts sont pour les dépenses)', () => {
    // Une entrée d'argent (virement famille pour un camp) n'attend pas de
    // justificatif → aucun dépôt suggéré, même à montant/date dans la tolérance.
    // Terrain 2026-07-03.
    const recette = { id: 'ECR1', amount_cents: 22600, date_ecriture: '2026-07-02', type: 'recette' as const };
    expect(suggestMatchForEcriture(recette, [depot({ amount_cents: 22600, date_estimee: '2026-07-01' })], [])).toBeNull();
  });
  it('propose bien un remboursement pour une dépense de même montant/date', () => {
    const depense = { id: 'ECR1', amount_cents: 4124, date_ecriture: '2026-06-20', type: 'depense' as const };
    expect(suggestMatchForEcriture(depense, [], [remb({ total_cents: 4124, date_paiement: '2026-06-20' })])?.kind).toBe('remboursement');
  });
  it('le match dépôt porte les chemins de fichiers (pour voir le justif avant de lier)', () => {
    const m = suggestMatchForEcriture(ecr, [depot({ justifPaths: ['depot/DEP1/recu1.jpg', 'depot/DEP1/recu2.pdf'] })], []);
    expect(m?.kind).toBe('depot');
    expect(m?.justifPaths).toEqual(['depot/DEP1/recu1.jpg', 'depot/DEP1/recu2.pdf']);
  });
  it('le match remboursement n\'a pas de chemins de fichiers (hors périmètre)', () => {
    expect(suggestMatchForEcriture(ecr, [], [remb()])?.justifPaths).toEqual([]);
  });
  it('à égalité de date, préfère le dépôt', () => {
    expect(suggestMatchForEcriture(ecr, [depot()], [remb()])?.kind).toBe('depot');
  });
  it('choisit le plus proche en date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ id: 'LOIN', date_estimee: '2026-01-20' }), depot({ id: 'PROCHE', date_estimee: '2026-01-11' })], [])?.id).toBe('PROCHE');
  });
});
