import { describe, it, expect } from 'vitest';
import { planStaleLineDrafts, type ExistingLineDraft } from './drafts-line-reconcile';

const draft = (over: Partial<ExistingLineDraft> = {}): ExistingLineDraft => ({
  id: 'ECR-1',
  sousLigneIndex: null,
  status: 'draft',
  comptawebEcritureId: null,
  hasImputation: false,
  hasAttachment: false,
  ...over,
});

describe('planStaleLineDrafts', () => {
  it('supprime le draft « ligne entière » nu quand la ligne a maintenant des sous-lignes', () => {
    const existing = [
      draft({ id: 'PARENT', sousLigneIndex: null }),
      draft({ id: 'SUB0', sousLigneIndex: 0, hasImputation: true }),
      draft({ id: 'SUB1', sousLigneIndex: 1, hasImputation: true }),
    ];
    expect(planStaleLineDrafts([0, 1], existing)).toEqual(['PARENT']);
  });

  it('garde les drafts dont le sous_index est encore canonique', () => {
    const existing = [
      draft({ id: 'SUB0', sousLigneIndex: 0 }),
      draft({ id: 'SUB1', sousLigneIndex: 1 }),
    ];
    expect(planStaleLineDrafts([0, 1], existing)).toEqual([]);
  });

  it('ne touche jamais un non-draft (mirror) même devenu stale', () => {
    const existing = [draft({ id: 'M', sousLigneIndex: null, status: 'mirror' })];
    expect(planStaleLineDrafts([0, 1], existing)).toEqual([]);
  });

  it('garde un draft stale relié à Comptaweb', () => {
    const existing = [draft({ id: 'L', sousLigneIndex: null, comptawebEcritureId: 4321 })];
    expect(planStaleLineDrafts([0, 1], existing)).toEqual([]);
  });

  it('supprime un draft « ligne entière » imputé supplanté par des sous-lignes (grain agrégé invalide)', () => {
    const existing = [draft({ id: 'L', sousLigneIndex: null, hasImputation: true })];
    expect(planStaleLineDrafts([0, 1], existing)).toEqual(['L']);
  });

  it('garde un draft de SOUS-LIGNE imputé devenu stale (re-ventilation, vrai travail)', () => {
    // canonique = [1, 2] : la sous-ligne 0 a disparu de la ventilation DSP2.
    const existing = [draft({ id: 'SUB0', sousLigneIndex: 0, hasImputation: true })];
    expect(planStaleLineDrafts([1, 2], existing)).toEqual([]);
  });

  it('garde un draft stale avec une pièce attachée', () => {
    const existing = [draft({ id: 'L', sousLigneIndex: null, hasAttachment: true })];
    expect(planStaleLineDrafts([0, 1], existing)).toEqual([]);
  });

  it('sens inverse : ligne redevenue sans sous-lignes → supprime les sous-lignes nues', () => {
    const existing = [
      draft({ id: 'L', sousLigneIndex: null }),
      draft({ id: 'SUB0', sousLigneIndex: 0 }),
      draft({ id: 'SUB1', sousLigneIndex: 1 }),
    ];
    expect(planStaleLineDrafts([null], existing)).toEqual(['SUB0', 'SUB1']);
  });

  it('rien à supprimer → liste vide', () => {
    expect(planStaleLineDrafts([null], [draft({ id: 'L', sousLigneIndex: null })])).toEqual([]);
  });

  it('retire les deux drafts « ligne entière » stale (nu ET imputé) mais garde une pièce attachée', () => {
    const existing = [
      draft({ id: 'PARENT_NU', sousLigneIndex: null }),
      draft({ id: 'PARENT_IMPUTE', sousLigneIndex: null, hasImputation: true }),
      draft({ id: 'PARENT_PIECE', sousLigneIndex: null, hasAttachment: true }),
    ];
    // canonique = sous-lignes [0,1] : les trois « ligne entière » sont stale ;
    // nu et imputé sont retirés (grain agrégé invalide), celui avec pièce reste.
    expect(planStaleLineDrafts([0, 1], existing)).toEqual(['PARENT_NU', 'PARENT_IMPUTE']);
  });
});
