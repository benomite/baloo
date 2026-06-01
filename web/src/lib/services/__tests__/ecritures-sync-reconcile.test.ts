import { describe, it, expect } from 'vitest';
import {
  reconcile,
  type CwSnapshotRow,
  type BalooRow,
} from '../ecritures-sync-reconcile';

function cw(over: Partial<CwSnapshotRow> & { cwId: number }): CwSnapshotRow {
  return {
    numeroPiece: `ECR-${over.cwId}`,
    date: '2026-03-10',
    type: 'depense',
    montantCents: 1000,
    intitule: 'Test',
    modeTransaction: 'Virement',
    categorieTiers: 'National',
    signature: `sig-${over.cwId}`,
    ...over,
  };
}

function baloo(over: Partial<BalooRow> & { id: string }): BalooRow {
  return {
    status: 'mirror',
    comptawebEcritureId: null,
    amountCents: 1000,
    type: 'depense',
    dateEcriture: '2026-03-10',
    cwSignature: null,
    hasImputation: true,
    ...over,
  };
}

const OPTS = { dateToleranceDays: 3 };

describe('reconcile — clé stable', () => {
  it('update avec needsDetail quand la signature a changé', () => {
    const plan = reconcile(
      [cw({ cwId: 100, signature: 'NEW' })],
      [baloo({ id: 'E1', comptawebEcritureId: 100, cwSignature: 'OLD' })],
      OPTS,
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].ecritureId).toBe('E1');
    expect(plan.updates[0].needsDetail).toBe(true);
    expect(plan.imports).toHaveLength(0);
  });

  it('update sans needsDetail quand la signature est identique et l’imputation présente', () => {
    const plan = reconcile(
      [cw({ cwId: 100, signature: 'SAME' })],
      [baloo({ id: 'E1', comptawebEcritureId: 100, cwSignature: 'SAME', hasImputation: true })],
      OPTS,
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].needsDetail).toBe(false);
  });

  it('needsDetail même à signature identique si l’imputation est vide (répare le legacy)', () => {
    const plan = reconcile(
      [cw({ cwId: 100, signature: 'SAME' })],
      [baloo({ id: 'E1', comptawebEcritureId: 100, cwSignature: 'SAME', hasImputation: false })],
      OPTS,
    );
    expect(plan.updates[0].needsDetail).toBe(true);
  });
});

describe('reconcile — suppressions', () => {
  it('déclare supprimée une écriture reliée dans la plage couverte', () => {
    const plan = reconcile(
      [cw({ cwId: 100 }), cw({ cwId: 200 })],
      [baloo({ id: 'E1', comptawebEcritureId: 150 })], // 100 ≤ 150 ≤ 200, absente
      OPTS,
    );
    expect(plan.deletions).toEqual(['E1']);
  });

  it('ne touche pas une écriture reliée HORS plage (id < min)', () => {
    const plan = reconcile(
      [cw({ cwId: 100 }), cw({ cwId: 200 })],
      [baloo({ id: 'E1', comptawebEcritureId: 50 })], // 50 < 100 → hors fenêtre
      OPTS,
    );
    expect(plan.deletions).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });

  it('ne déclare aucune suppression si le snapshot est vide', () => {
    const plan = reconcile([], [baloo({ id: 'E1', comptawebEcritureId: 150 })], OPTS);
    expect(plan.deletions).toHaveLength(0);
  });

  it('une écriture reliée présente dans CW est un update, pas une suppression', () => {
    const plan = reconcile(
      [cw({ cwId: 150 })],
      [baloo({ id: 'E1', comptawebEcritureId: 150 })],
      OPTS,
    );
    expect(plan.deletions).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
  });
});

describe('reconcile — import', () => {
  it('importe une ligne CW sans équivalent Baloo', () => {
    const plan = reconcile([cw({ cwId: 100 })], [], OPTS);
    expect(plan.imports).toHaveLength(1);
    expect(plan.imports[0].cwId).toBe(100);
  });
});

describe('reconcile — match contenu des drafts', () => {
  it('promeut un draft sur match unique (montant+type+date)', () => {
    const plan = reconcile(
      [cw({ cwId: 300, montantCents: 4200, date: '2026-04-01' })],
      [baloo({ id: 'D1', status: 'draft', amountCents: 4200, dateEcriture: '2026-04-02' })],
      OPTS,
    );
    expect(plan.promotions).toHaveLength(1);
    expect(plan.promotions[0].ecritureId).toBe('D1');
    expect(plan.promotions[0].cw.cwId).toBe(300);
    // la ligne CW est consommée → pas d'import
    expect(plan.imports).toHaveLength(0);
  });

  it('met en suggestion (sans promotion ni import) un match ambigu', () => {
    const plan = reconcile(
      [
        cw({ cwId: 300, montantCents: 2400, date: '2026-04-01' }),
        cw({ cwId: 301, montantCents: 2400, date: '2026-04-01' }),
      ],
      [baloo({ id: 'D1', status: 'draft', amountCents: 2400, dateEcriture: '2026-04-01' })],
      OPTS,
    );
    expect(plan.promotions).toHaveLength(0);
    expect(plan.suggestions).toHaveLength(2);
    // les lignes CW ambiguës ne sont PAS importées (sinon doublon)
    expect(plan.imports).toHaveLength(0);
  });

  it('met en suggestion quand 2 drafts visent la même ligne CW', () => {
    const plan = reconcile(
      [cw({ cwId: 300, montantCents: 2400, date: '2026-04-01' })],
      [
        baloo({ id: 'D1', status: 'draft', amountCents: 2400, dateEcriture: '2026-04-01' }),
        baloo({ id: 'D2', status: 'draft', amountCents: 2400, dateEcriture: '2026-04-01' }),
      ],
      OPTS,
    );
    expect(plan.promotions).toHaveLength(0);
    expect(plan.suggestions.map((s) => s.ecritureId).sort()).toEqual(['D1', 'D2']);
    expect(plan.imports).toHaveLength(0);
  });

  it('importe la ligne CW si le draft est hors tolérance de date', () => {
    const plan = reconcile(
      [cw({ cwId: 300, montantCents: 4200, date: '2026-04-01' })],
      [baloo({ id: 'D1', status: 'draft', amountCents: 4200, dateEcriture: '2026-04-20' })],
      OPTS,
    );
    expect(plan.promotions).toHaveLength(0);
    expect(plan.imports).toHaveLength(1);
  });
});

describe('reconcile — scénario combiné', () => {
  it('gère update + delete + import + promotion en un passage', () => {
    const snapshot = [
      cw({ cwId: 100, signature: 'NEW' }), // update E1
      cw({ cwId: 200 }), // borne plage
      cw({ cwId: 250, montantCents: 5000, date: '2026-05-01' }), // promotion D1
      cw({ cwId: 260, montantCents: 9999, date: '2026-05-05' }), // import
    ];
    const balooRows = [
      baloo({ id: 'E1', comptawebEcritureId: 100, cwSignature: 'OLD' }),
      baloo({ id: 'E2', comptawebEcritureId: 150 }), // dans [100,260], absente → delete
      baloo({ id: 'D1', status: 'draft', amountCents: 5000, dateEcriture: '2026-05-01' }),
    ];
    const plan = reconcile(snapshot, balooRows, OPTS);
    expect(plan.updates.map((u) => u.ecritureId)).toEqual(['E1']);
    expect(plan.deletions).toEqual(['E2']);
    expect(plan.promotions.map((p) => p.ecritureId)).toEqual(['D1']);
    expect(plan.imports.map((i) => i.cwId)).toEqual([200, 260]);
  });
});

import { reconcileVentilations } from '../ecritures-sync-reconcile';

describe('reconcileVentilations (grain ventilation)', () => {
  const vent = (montantCents: number, categoryId: string | null = null) => ({ montantCents, categoryId, activiteId: null, uniteId: null });

  it('apparie 2 ventilations à 2 écritures CSV existantes (par montant)', () => {
    const plan = reconcileVentilations(
      [vent(48100), vent(1000)],
      [
        { id: 'CSV-481', amountCents: 48100, linkedToThisCw: false },
        { id: 'CSV-10', amountCents: 1000, linkedToThisCw: false },
      ],
    );
    expect(plan.updates.map((u) => u.ecritureId).sort()).toEqual(['CSV-10', 'CSV-481']);
    expect(plan.creates).toHaveLength(0);
    expect(plan.orphans).toHaveLength(0);
  });

  it('marque orphelin l’agrégat relié non apparié (491 vs 481+10)', () => {
    const plan = reconcileVentilations(
      [vent(48100), vent(1000)],
      [
        { id: 'AGG-491', amountCents: 49100, linkedToThisCw: true }, // agrégat erroné
        { id: 'CSV-481', amountCents: 48100, linkedToThisCw: false },
        { id: 'CSV-10', amountCents: 1000, linkedToThisCw: false },
      ],
    );
    expect(plan.updates.map((u) => u.ecritureId).sort()).toEqual(['CSV-10', 'CSV-481']);
    expect(plan.orphans).toEqual(['AGG-491']);
  });

  it('crée les ventilations sans candidat', () => {
    const plan = reconcileVentilations([vent(48100), vent(1000)], []);
    expect(plan.creates).toHaveLength(2);
    expect(plan.updates).toHaveLength(0);
  });

  it('mono-ventilation reliée → simple update, pas d’orphelin', () => {
    const plan = reconcileVentilations(
      [vent(100000)],
      [{ id: 'E1', amountCents: 100000, linkedToThisCw: true }],
    );
    expect(plan.updates).toEqual([{ ecritureId: 'E1', vent: vent(100000) }]);
    expect(plan.orphans).toHaveLength(0);
  });

  it('ne touche pas un candidat non relié non apparié', () => {
    const plan = reconcileVentilations(
      [vent(48100)],
      [
        { id: 'CSV-481', amountCents: 48100, linkedToThisCw: false },
        { id: 'AUTRE-999', amountCents: 99900, linkedToThisCw: false },
      ],
    );
    expect(plan.updates).toEqual([{ ecritureId: 'CSV-481', vent: vent(48100) }]);
    expect(plan.orphans).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });
});

describe('reconcileVentilations — changement de montant (passe 2)', () => {
  const vent = (montantCents: number) => ({ montantCents, categoryId: null, activiteId: null, uniteId: null });
  it('mono-ventilation dont le montant a changé → update du candidat relié (pas orphan+create)', () => {
    const plan = reconcileVentilations(
      [vent(50000)],
      [{ id: 'E1', amountCents: 48000, linkedToThisCw: true }],
    );
    expect(plan.updates).toEqual([{ ecritureId: 'E1', vent: vent(50000) }]);
    expect(plan.orphans).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });
});
