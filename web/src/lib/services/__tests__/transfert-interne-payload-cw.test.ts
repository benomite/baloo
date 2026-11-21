// Critère 6 (#51) : à la validation, ce qui part vers Comptaweb est un
// « Transfert interne à la structure » avec le mode choisi, la date, le montant
// et le titre du brouillon — comme si l'utilisateur les saisissait dans le
// formulaire Comptaweb. Aucune catégorie, unité ni activité n'est requise.
//
// Contrat : `buildCwInputFromPayload` renvoie `type: 'transfert_interne'` et
// `modeTransfert` ('depot_especes' | 'retrait_especes' | 'transfert_especes').

import { describe, it, expect } from 'vitest';
import { buildCwInputFromPayload } from '../ecritures-create-cw-adapter';

const deps = {
  lookupComptawebId: async () => null,
  lookupCarte: async () => null,
};

describe('buildCwInputFromPayload — transfert interne', () => {
  it.each(['depot_especes', 'retrait_especes', 'transfert_especes'])(
    'mode %s : type, mode, date, montant et titre du brouillon',
    async (mode) => {
      const input = await buildCwInputFromPayload(
        {
          date_ecriture: '2026-10-03',
          description: 'Dépôt espèces camp',
          amount_cents: 25050,
          type: 'transfert_interne',
          mode_transfert: mode,
          ventilations: [],
        } as never,
        deps,
      );
      expect(input).toMatchObject({
        type: 'transfert_interne',
        modeTransfert: mode,
        libel: 'Dépôt espèces camp',
        dateecriture: '03/10/2026',
        montant: '250,50',
      });
    },
  );
});
