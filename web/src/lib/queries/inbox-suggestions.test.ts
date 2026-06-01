import { describe, it, expect } from 'vitest';
import {
  computeAutoSuggestions,
  computeRembSuggestions,
  rejetPairKey,
  type InboxEcriture,
  type InboxJustif,
  type RembCandidate,
} from './inbox-matching';

// Fabrique minimale : seuls les champs lus par computeAutoSuggestions
// comptent (id, amount_cents, date).
function ecr(id: string, amount: number, date: string): InboxEcriture {
  return {
    id,
    date_ecriture: date,
    description: id,
    amount_cents: amount,
    type: 'depense',
    unite_code: null,
    comptaweb_synced: 0,
  };
}

function jus(id: string, amount: number | null, date: string | null): InboxJustif {
  return {
    id,
    titre: id,
    description: null,
    amount_cents: amount,
    date_estimee: date,
    unite_code: null,
    category_name: null,
    submitter_name: null,
    submitter_email: 'x@y.z',
    justif_path: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('computeAutoSuggestions — filtrage des paires rejetées', () => {
  it('propose une paire qui matche (montant + date dans la tolérance)', () => {
    const out = computeAutoSuggestions(
      [ecr('E1', -1700, '2026-03-16')],
      [jus('J1', 1676, '2026-03-15')],
    );
    expect(out).toHaveLength(1);
    expect(out[0].ecriture.id).toBe('E1');
    expect(out[0].justif.id).toBe('J1');
  });

  it('ne propose plus une paire explicitement rejetée', () => {
    const rejected = new Set([rejetPairKey('E1', 'depot', 'J1')]);
    const out = computeAutoSuggestions(
      [ecr('E1', -1700, '2026-03-16')],
      [jus('J1', 1676, '2026-03-15')],
      rejected,
    );
    expect(out).toHaveLength(0);
  });

  it('le rejet ne bloque QUE la paire visée : un autre justif reste suggéré', () => {
    const rejected = new Set([rejetPairKey('E1', 'depot', 'J1')]);
    const out = computeAutoSuggestions(
      [ecr('E1', -1700, '2026-03-16')],
      [
        jus('J1', 1676, '2026-03-15'), // rejeté
        jus('J2', 1700, '2026-03-16'), // matche encore
      ],
      rejected,
    );
    expect(out).toHaveLength(1);
    expect(out[0].justif.id).toBe('J2');
  });

  it('un rejet sur une paire ne gêne pas une autre écriture', () => {
    const rejected = new Set([rejetPairKey('E1', 'depot', 'J1')]);
    const out = computeAutoSuggestions(
      [ecr('E2', -1700, '2026-03-16')],
      [jus('J1', 1700, '2026-03-16')],
      rejected,
    );
    expect(out).toHaveLength(1);
    expect(out[0].ecriture.id).toBe('E2');
  });
});

function remb(
  id: string,
  amount: number,
  datePaiement: string | null,
  dateDepense: string | null = null,
): RembCandidate {
  return {
    id,
    demandeur: id,
    amount_cents: amount,
    date_paiement: datePaiement,
    date_depense: dateDepense,
    status: 'virement_effectue',
    unite_code: null,
  };
}

describe('computeRembSuggestions — écriture ↔ remboursement', () => {
  it('apparie montant exact + date paiement ≤ 15 j', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01')],
      [remb('R1', 2400, '2026-05-30')],
    );
    expect(out).toHaveLength(1);
    expect(out[0].ecriture.id).toBe('VIR1');
    expect(out[0].remboursement.id).toBe('R1');
  });

  it('rejette si montant non exact', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01')],
      [remb('R1', 2401, '2026-05-30')],
    );
    expect(out).toHaveLength(0);
  });

  it('rejette si date > 15 j', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-30')],
      [remb('R1', 2400, '2026-06-01')],
    );
    expect(out).toHaveLength(0);
  });

  it('fallback sur date_depense si date_paiement null', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01')],
      [remb('R1', 2400, null, '2026-05-29')],
    );
    expect(out).toHaveLength(1);
  });

  it("glouton 1:1 — un remboursement déjà apparié n'est pas réutilisé", () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01'), ecr('VIR2', -2400, '2026-06-01')],
      [remb('R1', 2400, '2026-06-01')],
    );
    expect(out).toHaveLength(1);
  });

  it("paire rejetée non re-proposée ; le rembt suivant de même montant l'est", () => {
    const rejected = new Set([rejetPairKey('VIR1', 'remboursement', 'R1')]);
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01')],
      [remb('R1', 2400, '2026-06-01'), remb('R2', 2400, '2026-06-02')],
      rejected,
    );
    expect(out).toHaveLength(1);
    expect(out[0].remboursement.id).toBe('R2');
  });
});
