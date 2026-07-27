import { describe, it, expect } from 'vitest';
import { computeCouverture } from '../remboursement-justifs';

// Tests de `listAssignationsLignes` / `setLigneJustificatifs` : voir
// `remboursement-justifs-ligne.test.ts` (rattachement ligne-centrique,
// spec 2026-07-20). L'ancien axe justif-centrique (`setJustificatifLignes`)
// a été retiré, orphelin depuis le passage au rattachement par ligne.

describe('remboursement-justifs', () => {
  it('computeCouverture compte les lignes ayant ≥1 justif', () => {
    const lignes = [{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }];
    const assignations = [
      { ligne_id: 'L1' },
      { ligne_id: 'L1' },
      { ligne_id: 'L3' },
    ];
    expect(computeCouverture(lignes, assignations)).toEqual({ justifiees: 2, total: 3 });
  });

  it('computeCouverture sur 0 ligne', () => {
    expect(computeCouverture([], [])).toEqual({ justifiees: 0, total: 0 });
  });
});
