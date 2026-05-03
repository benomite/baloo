import { describe, it, expect } from 'vitest';
import {
  isAllowedRembsTransition,
  REMBOURSEMENTS_TRANSITIONS,
} from './remboursements-transitions';

describe('isAllowedRembsTransition', () => {
  describe('chemin nominal a_traiter → valide_tresorier → valide_rg → virement_effectue → termine', () => {
    it('a_traiter → valide_tresorier par tresorier : OK', () => {
      expect(isAllowedRembsTransition('a_traiter', 'valide_tresorier', 'tresorier'))
        .toEqual({ ok: true });
    });
    it('a_traiter → valide_tresorier par RG : refusé (rôle interdit)', () => {
      const r = isAllowedRembsTransition('a_traiter', 'valide_tresorier', 'RG');
      expect(r).toEqual({ ok: false, reason: 'wrong_role' });
    });
    it('valide_tresorier → valide_rg par RG : OK', () => {
      expect(isAllowedRembsTransition('valide_tresorier', 'valide_rg', 'RG'))
        .toEqual({ ok: true });
    });
    it('valide_tresorier → valide_rg par tresorier : refusé (RG only)', () => {
      const r = isAllowedRembsTransition('valide_tresorier', 'valide_rg', 'tresorier');
      expect(r).toEqual({ ok: false, reason: 'wrong_role' });
    });
    it('valide_rg → virement_effectue par tresorier ou RG : OK', () => {
      expect(isAllowedRembsTransition('valide_rg', 'virement_effectue', 'tresorier'))
        .toEqual({ ok: true });
      expect(isAllowedRembsTransition('valide_rg', 'virement_effectue', 'RG'))
        .toEqual({ ok: true });
    });
    it('virement_effectue → termine par tresorier ou RG : OK', () => {
      expect(isAllowedRembsTransition('virement_effectue', 'termine', 'tresorier'))
        .toEqual({ ok: true });
    });
  });

  describe('saut d étape interdit (anti-fraude / anti-bug UI)', () => {
    it('a_traiter → valide_rg : refusé (faut passer par valide_tresorier)', () => {
      const r = isAllowedRembsTransition('a_traiter', 'valide_rg', 'RG');
      expect(r).toEqual({ ok: false, reason: 'wrong_source' });
    });
    it('a_traiter → virement_effectue : refusé', () => {
      const r = isAllowedRembsTransition('a_traiter', 'virement_effectue', 'tresorier');
      expect(r).toEqual({ ok: false, reason: 'wrong_source' });
    });
    it('valide_tresorier → termine : refusé (manque virement)', () => {
      const r = isAllowedRembsTransition('valide_tresorier', 'termine', 'tresorier');
      expect(r).toEqual({ ok: false, reason: 'wrong_source' });
    });
  });

  describe('refus depuis n importe quelle étape sauf termine/refuse', () => {
    const fromStatuses = ['a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue'];
    for (const from of fromStatuses) {
      it(`${from} → refuse par tresorier : OK`, () => {
        expect(isAllowedRembsTransition(from, 'refuse', 'tresorier'))
          .toEqual({ ok: true });
      });
    }
    it('termine → refuse : refusé (terminal)', () => {
      const r = isAllowedRembsTransition('termine', 'refuse', 'tresorier');
      expect(r).toEqual({ ok: false, reason: 'wrong_source' });
    });
    it('refuse → refuse : refusé', () => {
      const r = isAllowedRembsTransition('refuse', 'refuse', 'tresorier');
      expect(r).toEqual({ ok: false, reason: 'wrong_source' });
    });
  });

  describe('rôles non autorisés', () => {
    it('chef ne peut rien valider', () => {
      expect(isAllowedRembsTransition('a_traiter', 'valide_tresorier', 'chef'))
        .toEqual({ ok: false, reason: 'wrong_role' });
      expect(isAllowedRembsTransition('valide_tresorier', 'valide_rg', 'chef'))
        .toEqual({ ok: false, reason: 'wrong_role' });
    });
    it('equipier ne peut rien valider', () => {
      expect(isAllowedRembsTransition('a_traiter', 'valide_tresorier', 'equipier'))
        .toEqual({ ok: false, reason: 'wrong_role' });
    });
    it('parent ne peut rien valider', () => {
      expect(isAllowedRembsTransition('a_traiter', 'valide_tresorier', 'parent'))
        .toEqual({ ok: false, reason: 'wrong_role' });
    });
  });

  describe('garde-fous', () => {
    it('status cible inconnu : unknown_status', () => {
      const r = isAllowedRembsTransition('a_traiter', 'foo_bar', 'tresorier');
      expect(r).toEqual({ ok: false, reason: 'unknown_status' });
    });
    it('a_traiter n est jamais une cible (statut initial)', () => {
      expect(REMBOURSEMENTS_TRANSITIONS['a_traiter']).toBeUndefined();
      const r = isAllowedRembsTransition('refuse', 'a_traiter', 'tresorier');
      expect(r).toEqual({ ok: false, reason: 'unknown_status' });
    });
  });
});
