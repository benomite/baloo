// Transfert interne (#51) : le panneau propose la nature (dépense / recette /
// transfert interne) sur un brouillon issu de la banque, et masque
// l'imputation et les justificatifs d'un transfert interne.

import { describe, it, expect } from 'vitest';
import { panelViewModel } from '../panel-view-model';

type E = Parameters<typeof panelViewModel>[0];
const brouillonBanque: E = {
  status: 'draft',
  ligne_bancaire_id: 4242,
  comptaweb_ecriture_id: null,
  type: 'recette',
  justif_attendu: 0,
};

describe('panelViewModel — nature et transfert interne', () => {
  it('brouillon banque : nature proposée, imputation visible', () => {
    expect(panelViewModel(brouillonBanque)).toMatchObject({ showNature: true, showImputation: true });
  });

  it('brouillon banque en transfert interne : nature proposée, pas d’imputation', () => {
    expect(panelViewModel({ ...brouillonBanque, type: 'transfert_interne' })).toMatchObject({
      showNature: true,
      showImputation: false,
    });
  });

  it('saisie manuelle : pas de choix de nature', () => {
    expect(panelViewModel({ ...brouillonBanque, ligne_bancaire_id: null }).showNature).toBe(false);
  });

  it('banque mais plus un brouillon (envoyée, en attente) : pas de choix de nature', () => {
    expect(panelViewModel({ ...brouillonBanque, status: 'pending_sync' }).showNature).toBe(false);
  });

  it('dans Comptaweb : lecture seule, imputation masquée pour un transfert', () => {
    expect(panelViewModel({ ...brouillonBanque, status: 'mirror', type: 'transfert_interne' })).toMatchObject({
      mode: 'readonly',
      showNature: false,
      showImputation: false,
    });
    expect(panelViewModel({ ...brouillonBanque, status: 'mirror' }).showImputation).toBe(true);
  });
});
