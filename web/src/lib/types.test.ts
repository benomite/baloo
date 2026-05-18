// Tests sur les enums de domaine — sentinelles pour s'assurer que les
// statuts cibles du pivot "miroir strict + MCP-first" sont bien en place.
//
// Le nouvel enum `ECRITURE_STATUSES` exprime le cycle de vie d'une
// écriture vis-à-vis de Comptaweb :
//   draft         : préparation locale, jamais envoyé à CW
//   pending_cw    : en cours d'envoi vers CW
//   pending_sync  : envoyé à CW avec succès, attend la sync de retour
//   mirror        : synced, miroir CW propre
//   divergent     : sync a détecté un écart entre Baloo et CW

import { describe, it, expect } from 'vitest';
import { ECRITURE_STATUSES, type EcritureStatus } from './types';

describe('ECRITURE_STATUSES', () => {
  it('contient exactement les 5 statuts cibles du pivot', () => {
    expect([...ECRITURE_STATUSES].sort()).toEqual(
      ['divergent', 'draft', 'mirror', 'pending_cw', 'pending_sync'],
    );
  });

  it("ne contient plus aucun statut historique (brouillon/valide/saisie_comptaweb)", () => {
    const arr: readonly string[] = ECRITURE_STATUSES;
    expect(arr).not.toContain('brouillon');
    expect(arr).not.toContain('valide');
    expect(arr).not.toContain('saisie_comptaweb');
  });

  it("EcritureStatus accepte les 5 nouveaux statuts (vérif TS au build)", () => {
    // Si l'un de ces statuts n'est pas dans l'union, le build TS casse.
    const samples: EcritureStatus[] = ['draft', 'pending_cw', 'pending_sync', 'mirror', 'divergent'];
    expect(samples).toHaveLength(5);
  });
});
