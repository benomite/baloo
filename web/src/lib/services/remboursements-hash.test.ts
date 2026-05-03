import { describe, it, expect } from 'vitest';
import { computeRemboursementHash, type RemboursementLigne } from './remboursements';
import type { Remboursement } from '../types';

// Helpers pour construire des fixtures stables. computeRemboursementHash
// est pure (pas d'I/O) — pas besoin de BDD ni de mock.
function makeRembs(overrides: Partial<Remboursement> = {}): Remboursement {
  return {
    id: 'RBT-2026-001',
    group_id: 'g1',
    demandeur: 'Sarah Verneret',
    prenom: 'Sarah',
    nom: 'Verneret',
    email: 'sarah@example.fr',
    rib_texte: 'FR76 1234 5678 9012',
    rib_file_path: null,
    amount_cents: 1500,
    total_cents: 1500,
    date_depense: '2026-04-15',
    nature: 'tickets de métro',
    unite_id: null,
    justificatif_status: 'oui',
    status: 'a_traiter',
    motif_refus: null,
    date_paiement: null,
    mode_paiement_id: null,
    comptaweb_synced: 0,
    ecriture_id: null,
    notes: null,
    submitted_by_user_id: 'u1',
    edit_token: null,
    validate_token: null,
    created_at: '2026-04-15T10:00:00Z',
    updated_at: '2026-04-15T10:00:00Z',
    ...overrides,
  };
}

function makeLigne(overrides: Partial<RemboursementLigne> = {}): RemboursementLigne {
  return {
    id: 'L-001',
    remboursement_id: 'RBT-2026-001',
    date_depense: '2026-04-15',
    amount_cents: 1500,
    nature: 'ticket métro',
    notes: null,
    created_at: '2026-04-15T10:00:00Z',
    ...overrides,
  };
}

describe('computeRemboursementHash', () => {
  it('produit un hash hex SHA-256 stable (64 caractères)', () => {
    const rbt = makeRembs();
    const lignes = [makeLigne()];
    const h = computeRemboursementHash(rbt, lignes);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('est déterministe : 2 appels avec les mêmes données = même hash', () => {
    const rbt = makeRembs();
    const lignes = [makeLigne()];
    expect(computeRemboursementHash(rbt, lignes)).toBe(
      computeRemboursementHash(rbt, lignes),
    );
  });

  it('change si on modifie le RIB', () => {
    const rbt = makeRembs();
    const lignes = [makeLigne()];
    const h1 = computeRemboursementHash(rbt, lignes);
    const h2 = computeRemboursementHash({ ...rbt, rib_texte: 'FR99 9999' }, lignes);
    expect(h1).not.toBe(h2);
  });

  it('change si on modifie le montant d une ligne (raison d être de la signature)', () => {
    const rbt = makeRembs();
    const h1 = computeRemboursementHash(rbt, [makeLigne({ amount_cents: 1500 })]);
    const h2 = computeRemboursementHash(rbt, [makeLigne({ amount_cents: 9999 })]);
    expect(h1).not.toBe(h2);
  });

  it('change si on ajoute une ligne', () => {
    const rbt = makeRembs();
    const h1 = computeRemboursementHash(rbt, [makeLigne()]);
    const h2 = computeRemboursementHash(rbt, [
      makeLigne(),
      makeLigne({ id: 'L-002', amount_cents: 800, nature: 'pain' }),
    ]);
    expect(h1).not.toBe(h2);
  });

  it("est invariant à l'ordre des lignes (tri par id en interne)", () => {
    const rbt = makeRembs();
    const ligneA = makeLigne({ id: 'L-001', amount_cents: 500 });
    const ligneB = makeLigne({ id: 'L-002', amount_cents: 800 });
    const h1 = computeRemboursementHash(rbt, [ligneA, ligneB]);
    const h2 = computeRemboursementHash(rbt, [ligneB, ligneA]);
    expect(h1).toBe(h2);
  });

  it("est invariant aux champs de workflow (status, motif_refus, dates de paiement)", () => {
    const lignes = [makeLigne()];
    const h1 = computeRemboursementHash(makeRembs({ status: 'a_traiter' }), lignes);
    const h2 = computeRemboursementHash(
      makeRembs({
        status: 'valide_rg',
        motif_refus: 'test',
        date_paiement: '2026-04-30',
        ecriture_id: 'ECR-2026-001',
        comptaweb_synced: 1,
      }),
      lignes,
    );
    expect(h1).toBe(h2);
  });

  it('change si on modifie le prénom (identité)', () => {
    const lignes = [makeLigne()];
    const h1 = computeRemboursementHash(makeRembs({ prenom: 'Sarah' }), lignes);
    const h2 = computeRemboursementHash(makeRembs({ prenom: 'Sara' }), lignes);
    expect(h1).not.toBe(h2);
  });

  it('change si on modifie les notes d une ligne', () => {
    const rbt = makeRembs();
    const h1 = computeRemboursementHash(rbt, [makeLigne({ notes: null })]);
    const h2 = computeRemboursementHash(rbt, [makeLigne({ notes: 'précision' })]);
    expect(h1).not.toBe(h2);
  });
});
