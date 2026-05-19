// Tests du comportement par défaut de GET /api/ecritures.
//
// Comportement cible (Task 6 du pivot miroir strict + MCP-first) :
//
// - Par défaut, GET /api/ecritures ne retourne QUE les écritures
//   `status='mirror'` (le miroir CW propre).
// - Un filtre opt-in `?includeDivergent=1` ajoute aussi les `divergent`
//   à la liste (cas debug / réconciliation).
// - Les `draft`, `pending_cw`, `pending_sync` ne sortent JAMAIS par
//   l'endpoint /api/ecritures GET : ils vivent sur /inbox.
//
// La fonction testée est `resolveStatusFilter` (helper extrait du
// route handler pour pouvoir tester sans monter tout Next).

import { describe, it, expect } from 'vitest';
import { resolveStatusFilter } from './status-filter';

describe('GET /api/ecritures — resolveStatusFilter', () => {
  it("retourne ['mirror'] par défaut (sans aucun param)", () => {
    expect(resolveStatusFilter({})).toEqual(['mirror']);
  });

  it("retourne ['mirror', 'divergent'] avec ?includeDivergent=1", () => {
    expect(resolveStatusFilter({ includeDivergent: '1' }).sort()).toEqual(
      ['divergent', 'mirror'],
    );
  });

  it("retourne ['mirror', 'divergent'] avec ?includeDivergent=true", () => {
    expect(resolveStatusFilter({ includeDivergent: 'true' }).sort()).toEqual(
      ['divergent', 'mirror'],
    );
  });

  it("ignore les valeurs falsy de includeDivergent (0, false, vide)", () => {
    expect(resolveStatusFilter({ includeDivergent: '0' })).toEqual(['mirror']);
    expect(resolveStatusFilter({ includeDivergent: 'false' })).toEqual(['mirror']);
    expect(resolveStatusFilter({ includeDivergent: '' })).toEqual(['mirror']);
  });

  it("respecte un status explicite (override total du filtre par défaut)", () => {
    // Cas usage : MCP qui veut lister TOUT le pending pour /inbox.
    expect(resolveStatusFilter({ status: 'pending_sync' })).toEqual(['pending_sync']);
    expect(resolveStatusFilter({ status: 'draft' })).toEqual(['draft']);
  });

  it("status explicite override aussi includeDivergent", () => {
    // Si un caller force le filtre, on ne lui ajoute pas divergent
    // silencieusement.
    expect(
      resolveStatusFilter({ status: 'mirror', includeDivergent: '1' }),
    ).toEqual(['mirror']);
  });

  it("ne sort JAMAIS draft/pending_cw/pending_sync par défaut", () => {
    const out = resolveStatusFilter({});
    expect(out).not.toContain('draft');
    expect(out).not.toContain('pending_cw');
    expect(out).not.toContain('pending_sync');
  });
});
