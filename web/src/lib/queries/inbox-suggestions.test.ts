import { describe, it, expect } from 'vitest';
import {
  computeAutoSuggestions,
  rejetPairKey,
  type InboxEcriture,
  type InboxJustif,
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
