// Transfert interne (#51) : le bouton « Valider » ne réclame ni catégorie, ni
// unité, ni activité, ni mode de paiement — seulement le mode de transfert.

import { describe, it, expect } from 'vitest';
import { computeReadiness, computeGroupReadiness } from '../sync-readiness';
import type { Ecriture } from '../types';

const refs = { categories: [], unites: [], modesPaiement: [], activites: [] };

function ecriture(over: Partial<Ecriture>): Ecriture {
  return {
    id: 'E1', group_id: 'g1', unite_id: null, date_ecriture: '2026-10-03', description: 'Dépôt',
    amount_cents: 25000, type: 'transfert_interne', mode_transfert: 'depot_especes',
    category_id: null, mode_paiement_id: null, activite_id: null, numero_piece: null,
    status: 'draft', justif_attendu: 1, comptaweb_synced: 0, ligne_bancaire_id: 4242,
    ligne_bancaire_sous_index: null, comptaweb_ecriture_id: null, ventilation_group_id: null,
    carte_id: null, libelle_origine: null, notes: null, created_at: '', updated_at: '',
    ...over,
  };
}

describe('readiness — transfert interne', () => {
  it('avec son mode : prête, sans imputation ni mode de paiement', () => {
    expect(computeReadiness(ecriture({}), refs)).toMatchObject({ level: 'ready', missingFields: [] });
    expect(computeGroupReadiness([ecriture({})], refs).level).toBe('ready');
  });

  it('sans mode : seul le mode de transfert manque — une recette garde son imputation', () => {
    expect(computeReadiness(ecriture({ mode_transfert: null }), refs)).toMatchObject({
      level: 'incomplete',
      missingFields: ['mode de transfert'],
    });
    const r = computeReadiness(ecriture({ type: 'recette', mode_transfert: null }), refs);
    expect(r.missingFields).toEqual(['catégorie', 'unité', 'activité', 'mode de paiement']);
  });

  it('pièce de deux lignes sans mode : le mode (en-tête) n’est demandé qu’une fois', () => {
    const r = computeGroupReadiness([ecriture({ mode_transfert: null }), ecriture({ id: 'E2', mode_transfert: null })], refs);
    expect(r.missingFields).toEqual(['mode de transfert']);
  });
});
