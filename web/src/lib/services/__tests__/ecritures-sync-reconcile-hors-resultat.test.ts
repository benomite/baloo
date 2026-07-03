// Une écriture hors-résultat (cat-flux-structures) n'est jamais dans le journal
// /recettedepense : le reconcile ne doit PAS la marquer supprimee_cw même si son
// comptaweb_ecriture_id tombe dans la plage couverte du snapshot.
import { describe, it, expect } from 'vitest';
import { reconcile, type CwSnapshotRow, type BalooRow } from '../ecritures-sync-reconcile';

function snap(cwId: number): CwSnapshotRow {
  return {
    cwId, numeroPiece: '', date: '2026-06-10', type: 'depense', montantCents: -1000,
    intitule: 'x', modeTransaction: '', categorieTiers: '', signature: 's',
  };
}
function baloo(id: string, cwId: number, horsResultat: boolean): BalooRow {
  return {
    id, status: 'mirror', comptawebEcritureId: cwId, amountCents: -1000, type: 'depense',
    dateEcriture: '2026-06-10', cwSignature: 's', hasImputation: true, horsResultat,
  };
}

describe('reconcile — exclusion hors-résultat de supprimee_cw', () => {
  it('ne marque PAS supprimée une écriture hors-résultat absente du journal', () => {
    // Plage couverte [1000, 2000] ; l'écriture 1500 est absente du snapshot.
    const plan = reconcile([snap(1000), snap(2000)], [baloo('ECR-HR', 1500, true)], { dateToleranceDays: 3 });
    expect(plan.deletions).not.toContain('ECR-HR');
  });

  it('marque bien supprimée une écriture ordinaire absente (plage couverte)', () => {
    const plan = reconcile([snap(1000), snap(2000)], [baloo('ECR-OK', 1500, false)], { dateToleranceDays: 3 });
    expect(plan.deletions).toContain('ECR-OK');
  });
});
