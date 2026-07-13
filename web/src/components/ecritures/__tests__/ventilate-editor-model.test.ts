import { describe, it, expect } from 'vitest';
import {
  resolveVentilations, editorRemainderCents, isMultiCategory, canSaveVentilation,
  type VentLine,
} from '../ventilate-editor-model';

const line = (o: Partial<VentLine>): VentLine => ({
  id: o.id ?? 'l1', amount: o.amount ?? '0', category_id: o.category_id ?? null,
  unite_id: o.unite_id ?? null, activite_id: o.activite_id ?? null,
});

describe('resolveVentilations', () => {
  it('projette chaque ligne en ventilation résolue (cents + 3 dims)', () => {
    const out = resolveVentilations([line({ amount: '7,00', category_id: 'c1', unite_id: 'u1', activite_id: 'a1' })]);
    expect(out).toEqual([{ amount_cents: 700, category_id: 'c1', unite_id: 'u1', activite_id: 'a1' }]);
  });
  it('normalise chaînes vides en null', () => {
    const out = resolveVentilations([{ id: 'l', amount: '', category_id: '', unite_id: '', activite_id: '' }]);
    expect(out[0]).toEqual({ amount_cents: 0, category_id: null, unite_id: null, activite_id: null });
  });
});

describe('editorRemainderCents', () => {
  it('reste = total - somme', () => {
    expect(editorRemainderCents(1064, [line({ amount: '7,00' }), line({ id: 'l2', amount: '3,64' })])).toBe(0);
    expect(editorRemainderCents(1064, [line({ amount: '7,00' })])).toBe(364);
    expect(editorRemainderCents(1064, [line({ amount: '20,00' })])).toBe(-936);
  });
});

describe('isMultiCategory', () => {
  it('vrai dès 2 lignes', () => {
    expect(isMultiCategory([line({})])).toBe(false);
    expect(isMultiCategory([line({}), line({ id: 'l2' })])).toBe(true);
  });
});

describe('canSaveVentilation', () => {
  const ok: VentLine[] = [
    line({ id: 'l1', amount: '7,00', category_id: 'c1', unite_id: 'u1', activite_id: 'a1' }),
    line({ id: 'l2', amount: '3,64', category_id: 'c2', unite_id: 'u1', activite_id: 'a1' }),
  ];
  it('vrai si équilibré et lignes complètes', () => { expect(canSaveVentilation(1064, ok)).toBe(true); });
  it('faux si déséquilibré', () => { expect(canSaveVentilation(2000, ok)).toBe(false); });
  it('faux si une dimension manque', () => {
    expect(canSaveVentilation(1064, [ok[0], { ...ok[1], unite_id: null }])).toBe(false);
  });
  it('faux si un montant est nul', () => {
    expect(canSaveVentilation(700, [ok[0], { ...ok[1], amount: '0' }])).toBe(false);
  });
});
