// Critère 4 (#51) : un brouillon « Transfert interne » ne réclame ni catégorie,
// ni unité/activité, ni justificatif : aucune erreur de validation à ce sujet.

import { describe, it, expect } from 'vitest';
import { computeMissingFields } from '../ecritures';

describe('computeMissingFields — transfert interne', () => {
  it.each(['depot_especes', 'retrait_especes', 'transfert_especes'])(
    'ne signale rien pour le mode %s sans catégorie, tiers ni justificatif',
    (mode) => {
      const missing = computeMissingFields({
        status: 'draft',
        category_id: null,
        activite_id: null,
        unite_id: null,
        mode_paiement_id: null,
        type: 'transfert_interne',
        mode_transfert: mode,
        numero_piece: null,
        justif_attendu: 1,
        has_justificatif: false,
        remboursement_id: null,
      } as never);
      expect(missing).toEqual([]);
    },
  );
});
