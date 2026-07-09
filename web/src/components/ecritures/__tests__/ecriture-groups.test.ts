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

describe('buildEcritureGroups — clé ventilation_group_id', () => {
  it('≥2 lignes même ventilation_group_id → 1 header + N rows', () => {
    const items = buildEcritureGroups([
      ecr({ id: 'E1', amount_cents: 7000, ventilation_group_id: 'vg_1' }),
      ecr({ id: 'E2', amount_cents: 3000, ventilation_group_id: 'vg_1' }),
    ]);
    const headers = items.filter(i => i.kind === 'header');
    expect(headers).toHaveLength(1);
    expect(headers[0].kind === 'header' && headers[0].group.kind).toBe('ventil');
    expect(headers[0].kind === 'header' && headers[0].group.totalCents).toBe(10000);
    expect(items.filter(i => i.kind === 'row')).toHaveLength(2);
  });

  it('une seule ligne avec ventilation_group_id null → pas de header', () => {
    const items = buildEcritureGroups([ecr({ id: 'E1', ventilation_group_id: null })]);
    expect(items.filter(i => i.kind === 'header')).toHaveLength(0);
  });
});
