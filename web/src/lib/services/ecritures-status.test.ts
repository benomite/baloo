import { describe, it, expect } from 'vitest';
import {
  isMirrorStatus,
  isPendingStatus,
  mirrorStatuses,
  pendingStatuses,
} from './ecritures-status';
import { isBouclee } from './ecritures-status';

describe('ecritures-status helpers', () => {
  describe('isMirrorStatus', () => {
    it('renvoie true pour mirror et divergent', () => {
      expect(isMirrorStatus('mirror')).toBe(true);
      expect(isMirrorStatus('divergent')).toBe(true);
    });

    it('renvoie false pour draft, pending_cw, pending_sync', () => {
      expect(isMirrorStatus('draft')).toBe(false);
      expect(isMirrorStatus('pending_cw')).toBe(false);
      expect(isMirrorStatus('pending_sync')).toBe(false);
    });

    it("renvoie false pour les anciens statuts (sécurité)", () => {
      expect(isMirrorStatus('brouillon')).toBe(false);
      expect(isMirrorStatus('valide')).toBe(false);
      expect(isMirrorStatus('saisie_comptaweb')).toBe(false);
    });
  });

  describe('isPendingStatus', () => {
    it('renvoie true pour draft, pending_cw, pending_sync', () => {
      expect(isPendingStatus('draft')).toBe(true);
      expect(isPendingStatus('pending_cw')).toBe(true);
      expect(isPendingStatus('pending_sync')).toBe(true);
    });

    it('renvoie false pour mirror et divergent', () => {
      expect(isPendingStatus('mirror')).toBe(false);
      expect(isPendingStatus('divergent')).toBe(false);
    });
  });

  describe('listes utilitaires pour clauses SQL IN()', () => {
    it('mirrorStatuses() expose mirror + divergent', () => {
      expect([...mirrorStatuses()].sort()).toEqual(['divergent', 'mirror']);
    });

    it('pendingStatuses() expose draft + pending_cw + pending_sync', () => {
      expect([...pendingStatuses()].sort()).toEqual(['draft', 'pending_cw', 'pending_sync']);
    });
  });
});

describe('isBouclee — frontière À traiter / Bouclées (mirror strict)', () => {
  it('mirror → bouclée', () => {
    expect(isBouclee('mirror')).toBe(true);
  });
  it('divergent → PAS bouclée (demande un arbitrage humain)', () => {
    expect(isBouclee('divergent')).toBe(false);
  });
  it.each(['draft', 'pending_cw', 'pending_sync'])('%s → PAS bouclée', (s) => {
    expect(isBouclee(s)).toBe(false);
  });
});
