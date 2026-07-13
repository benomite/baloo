import { describe, it, expect } from 'vitest';
import {
  resolveVentilations,
  editorRemainderCents,
  isMultiCategory,
  canSaveVentilation,
  type DetailRow,
  type DefaultImputation,
} from '../ventilate-editor-model';

const defaults: DefaultImputation = { unite_id: 'u-farfa', activite_id: 'a-camps' };
const row = (over: Partial<DetailRow>): DetailRow => ({
  id: over.id ?? 'r1', amount: over.amount ?? '0', category_id: over.category_id ?? null,
  override: over.override ?? null,
});

describe('resolveVentilations', () => {
  it('applique les défauts unité/activité à une ligne sans surcharge', () => {
    const out = resolveVentilations(defaults, [row({ amount: '7,00', category_id: 'c-intendance' })]);
    expect(out).toEqual([{ amount_cents: 700, category_id: 'c-intendance', unite_id: 'u-farfa', activite_id: 'a-camps' }]);
  });

  it('respecte la surcharge par ligne', () => {
    const out = resolveVentilations(defaults, [
      row({ amount: '3,64', category_id: 'c-pharma', override: { unite_id: 'u-louv', activite_id: 'a-we' } }),
    ]);
    expect(out[0].unite_id).toBe('u-louv');
    expect(out[0].activite_id).toBe('a-we');
  });
});

describe('editorRemainderCents', () => {
  it('reste = total - somme des lignes', () => {
    expect(editorRemainderCents(1064, [row({ amount: '7,00' }), row({ id: 'r2', amount: '3,64' })])).toBe(0);
    expect(editorRemainderCents(1064, [row({ amount: '7,00' })])).toBe(364);
  });
});

describe('isMultiCategory', () => {
  it('vrai dès 2 lignes', () => {
    expect(isMultiCategory([row({})])).toBe(false);
    expect(isMultiCategory([row({}), row({ id: 'r2' })])).toBe(true);
  });
});

describe('canSaveVentilation', () => {
  const complete: DetailRow[] = [
    row({ id: 'r1', amount: '7,00', category_id: 'c-intendance' }),
    row({ id: 'r2', amount: '3,64', category_id: 'c-pharma' }),
  ];
  it('vrai si équilibré et toutes les lignes complètes', () => {
    expect(canSaveVentilation(1064, defaults, complete)).toBe(true);
  });
  it('faux si déséquilibré', () => {
    expect(canSaveVentilation(2000, defaults, complete)).toBe(false);
  });
  it('faux si une catégorie manque', () => {
    expect(canSaveVentilation(1064, defaults, [complete[0], { ...complete[1], category_id: null }])).toBe(false);
  });
  it('faux si une unité résolue manque (défaut vide, pas de surcharge)', () => {
    expect(canSaveVentilation(1064, { unite_id: null, activite_id: 'a-camps' }, complete)).toBe(false);
  });
  it('faux si un montant est nul', () => {
    expect(canSaveVentilation(700, defaults, [{ ...complete[0] }, { ...complete[1], amount: '0' }])).toBe(false);
  });
});
