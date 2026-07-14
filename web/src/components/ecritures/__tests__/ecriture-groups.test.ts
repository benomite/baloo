import { describe, it, expect } from 'vitest';
import { buildEcritureGroups } from '../ecriture-groups';
import type { Ecriture } from '@/lib/types';

function ecr(over: Partial<Ecriture>): Ecriture {
  return {
    id: 'E', group_id: 'g', unite_id: null, date_ecriture: '2026-07-08', description: 'x',
    amount_cents: 1000, type: 'depense', category_id: null, mode_paiement_id: null,
    activite_id: null, numero_piece: null, status: 'draft', justif_attendu: 0,
    comptaweb_synced: 0,
    ligne_bancaire_id: null, ligne_bancaire_sous_index: null, comptaweb_ecriture_id: null,
    ventilation_group_id: null,
    carte_id: null, libelle_origine: null, notes: null,
    created_at: '2026-07-08T00:00:00.000Z', updated_at: '2026-07-08T00:00:00.000Z',
    // compléter les autres champs obligatoires d'Ecriture avec des valeurs neutres
    ...over,
  } as Ecriture;
}

describe('buildEcritureGroups — consolidation multi-ventilation', () => {
  it('cas 1 — ventilation de draft bancaire (même ligne_bancaire_id + sous_index + ventilation_group_id) → 1 aggregate ventil, pas de header/rows bancaires', () => {
    const items = buildEcritureGroups([
      ecr({ id: 'E1', amount_cents: 7000, ligne_bancaire_id: 999, ligne_bancaire_sous_index: 0, ventilation_group_id: 'vg1' }),
      ecr({ id: 'E2', amount_cents: 3000, ligne_bancaire_id: 999, ligne_bancaire_sous_index: 0, ventilation_group_id: 'vg1' }),
      ecr({ id: 'E3', amount_cents: 2000, ligne_bancaire_id: 999, ligne_bancaire_sous_index: 0, ventilation_group_id: 'vg1' }),
    ]);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.kind).toBe('aggregate');
    if (item.kind !== 'aggregate') throw new Error('attendu aggregate');
    expect(item.group.kind).toBe('ventil');
    expect(item.group.count).toBe(3);
    // dépenses → signedTotal négatif (cf. signedTotal)
    expect(item.group.totalCents).toBe(-12000);
    expect(item.members).toHaveLength(3);
    expect(item.head.id).toBe('E1');
    // AUCUN header, AUCUN row
    expect(items.filter((i) => i.kind === 'header')).toHaveLength(0);
    expect(items.filter((i) => i.kind === 'row')).toHaveLength(0);
  });

  it('cas 2 — vrai multi-sous-lignes bancaire (sous_index distincts, pas de ventilation_group_id) → 1 header bank + N rows (inchangé)', () => {
    const items = buildEcritureGroups([
      ecr({ id: 'E1', amount_cents: 7000, ligne_bancaire_id: 888, ligne_bancaire_sous_index: 0 }),
      ecr({ id: 'E2', amount_cents: 3000, ligne_bancaire_id: 888, ligne_bancaire_sous_index: 1 }),
    ]);
    const headers = items.filter((i) => i.kind === 'header');
    expect(headers).toHaveLength(1);
    expect(headers[0].kind === 'header' && headers[0].group.kind).toBe('bank');
    expect(items.filter((i) => i.kind === 'row')).toHaveLength(2);
    expect(items.filter((i) => i.kind === 'aggregate')).toHaveLength(0);
  });

  it('cas 3 — multi-ventilation Comptaweb (même comptaweb_ecriture_id, ≥2) → header cw + N rows (PAS consolidé : la pièce CW importée n\'a pas forcément de ventilation_group_id, on ne masque aucune ligne)', () => {
    const items = buildEcritureGroups([
      ecr({ id: 'E1', amount_cents: 5680, comptaweb_ecriture_id: 555, numero_piece: '10' }),
      ecr({ id: 'E2', amount_cents: 4310, comptaweb_ecriture_id: 555, numero_piece: '10' }),
    ]);
    expect(items.filter((i) => i.kind === 'aggregate')).toHaveLength(0);
    const headers = items.filter((i) => i.kind === 'header');
    expect(headers).toHaveLength(1);
    expect(headers[0].kind === 'header' && headers[0].group.kind).toBe('cw');
    expect(headers[0].kind === 'header' && headers[0].group.count).toBe(2);
    expect(items.filter((i) => i.kind === 'row')).toHaveLength(2);
  });

  it('cas 4 — mono (pas de groupe) → 1 row group null', () => {
    const items = buildEcritureGroups([ecr({ id: 'E1' })]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('row');
    expect(items[0].kind === 'row' && items[0].group).toBeNull();
  });

  it('une seule ligne avec un ventilation_group_id non-null (pas de partenaire) → 1 row group null (garde ≥2)', () => {
    const items = buildEcritureGroups([ecr({ id: 'E1', ventilation_group_id: 'vg_solo' })]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('row');
    expect(items[0].kind === 'row' && items[0].group).toBeNull();
  });

  it('post-validation — ventilation qui garde ventilation_group_id ET gagne comptaweb_ecriture_id → classée cw (prioritaire), donc header + rows (toutes les lignes visibles)', () => {
    const items = buildEcritureGroups([
      ecr({ id: 'E1', amount_cents: 7000, ligne_bancaire_id: 999, ligne_bancaire_sous_index: 0, ventilation_group_id: 'vg1', comptaweb_ecriture_id: 777, status: 'pending_sync' }),
      ecr({ id: 'E2', amount_cents: 3000, ligne_bancaire_id: 999, ligne_bancaire_sous_index: 0, ventilation_group_id: 'vg1', comptaweb_ecriture_id: 777, status: 'pending_sync' }),
    ]);
    expect(items.filter((i) => i.kind === 'aggregate')).toHaveLength(0);
    const headers = items.filter((i) => i.kind === 'header');
    expect(headers).toHaveLength(1);
    // cw prioritaire sur ventil
    expect(headers[0].kind === 'header' && headers[0].group.kind).toBe('cw');
    expect(items.filter((i) => i.kind === 'row')).toHaveLength(2);
  });
});
