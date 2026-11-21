// Transfert interne (#51) — règles pures : nature d'un brouillon, patch
// correspondant, sens de l'opération de caisse, libellés.

import { describe, it, expect } from 'vitest';
import {
  MODE_TRANSFERT_CW_LABELS,
  NATURES_ECRITURE,
  libelleTransfert,
  natureDeEcriture,
  operationCaisseDuMode,
  patchDeNature,
  vueDepot,
  vueOperationLiee,
  vueRetrait,
} from '../transfert-interne';
import { isModeTransfert, type DepotEspeces, type MouvementCaisse } from '../types';

describe('natureDeEcriture', () => {
  it('dépense / recette : le type', () => {
    expect(natureDeEcriture({ type: 'depense' })).toBe('depense');
    expect(natureDeEcriture({ type: 'recette', mode_transfert: null })).toBe('recette');
  });
  it('transfert interne : son mode, ou vide tant qu’il n’est pas choisi', () => {
    expect(natureDeEcriture({ type: 'transfert_interne', mode_transfert: 'retrait_especes' })).toBe('retrait_especes');
    expect(natureDeEcriture({ type: 'transfert_interne', mode_transfert: null })).toBe('');
  });
});

describe('patchDeNature', () => {
  it('dépense / recette : le type et un mode vidé', () => {
    expect(patchDeNature('depense')).toEqual({ type: 'depense', mode_transfert: null });
    expect(patchDeNature('recette')).toEqual({ type: 'recette', mode_transfert: null });
  });
  it.each(['depot_especes', 'retrait_especes', 'transfert_especes'])('mode %s : transfert interne', (m) => {
    expect(patchDeNature(m)).toEqual({ type: 'transfert_interne', mode_transfert: m });
  });
  it('valeur inconnue : erreur', () => {
    expect(() => patchDeNature('virement')).toThrow(/inconnue/);
    expect(() => patchDeNature('transfert_interne')).toThrow(/inconnue/);
  });
});

describe('isModeTransfert', () => {
  it('reconnaît les trois modes, rien d’autre', () => {
    expect(isModeTransfert('depot_especes')).toBe(true);
    expect(isModeTransfert('depense')).toBe(false);
    expect(isModeTransfert(42)).toBe(false);
  });
});

describe('operationCaisseDuMode', () => {
  it('dépôt → dépôt, retrait → retrait, transfert / rien → aucune', () => {
    expect(operationCaisseDuMode('depot_especes')).toBe('depot');
    expect(operationCaisseDuMode('retrait_especes')).toBe('retrait');
    expect(operationCaisseDuMode('transfert_especes')).toBeNull();
    expect(operationCaisseDuMode(null)).toBeNull();
  });
});

describe('libellés', () => {
  it('libelleTransfert : avec ou sans mode', () => {
    expect(libelleTransfert('depot_especes')).toBe('Transfert interne — Dépôt d’espèces (caisse → banque)');
    expect(libelleTransfert(null)).toBe('Transfert interne');
  });
  it('modes Comptaweb tels que dans le formulaire', () => {
    expect(MODE_TRANSFERT_CW_LABELS).toEqual({
      depot_especes: 'Caisse (dépôt)',
      retrait_especes: 'Caisse (retrait)',
      transfert_especes: 'Caisse (transfert)',
    });
  });
  it('les natures proposées : dépense, recette, puis les trois modes', () => {
    expect(NATURES_ECRITURE.map((n) => n.value)).toEqual([
      'depense', 'recette', 'depot_especes', 'retrait_especes', 'transfert_especes',
    ]);
    expect(NATURES_ECRITURE[3].label).toBe('Transfert interne — Retrait d’espèces (banque → caisse)');
  });
});

describe('vues des opérations de caisse', () => {
  const depot = { id: 'DES-1', date_depot: '2026-10-03', total_amount_cents: 25000 } as DepotEspeces;
  const retrait = { id: 'CAI-1', date_mouvement: '2026-10-05', amount_cents: 8000 } as MouvementCaisse;
  it('dépôt : date et total du dépôt', () => {
    expect(vueDepot(depot)).toEqual({ id: 'DES-1', date: '2026-10-03', amountCents: 25000 });
  });
  it('retrait : date et montant (positif) du mouvement', () => {
    expect(vueRetrait({ ...retrait, amount_cents: -8000 })).toEqual({ id: 'CAI-1', date: '2026-10-05', amountCents: 8000 });
  });
  it('opération liée : selon son genre', () => {
    expect(vueOperationLiee({ kind: 'depot', depot })).toEqual(vueDepot(depot));
    expect(vueOperationLiee({ kind: 'retrait', mouvement: retrait })).toEqual(vueRetrait(retrait));
  });
});
