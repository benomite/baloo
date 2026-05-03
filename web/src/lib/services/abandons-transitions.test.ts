import { describe, it, expect } from 'vitest';
import { isAllowedAbandonTransition, type AbandonStatus } from './abandons';

describe('isAllowedAbandonTransition', () => {
  // a_traiter peut aller vers valide ou refuse
  it('a_traiter → valide est autorisé', () => {
    expect(isAllowedAbandonTransition('a_traiter', 'valide')).toBe(true);
  });
  it('a_traiter → refuse est autorisé', () => {
    expect(isAllowedAbandonTransition('a_traiter', 'refuse')).toBe(true);
  });
  it('a_traiter → envoye_national est interdit (faut valider d abord)', () => {
    expect(isAllowedAbandonTransition('a_traiter', 'envoye_national')).toBe(false);
  });

  // valide peut aller vers envoye_national ou refuse
  it('valide → envoye_national est autorisé', () => {
    expect(isAllowedAbandonTransition('valide', 'envoye_national')).toBe(true);
  });
  it('valide → refuse reste autorisé (cas d annulation tardive)', () => {
    expect(isAllowedAbandonTransition('valide', 'refuse')).toBe(true);
  });
  it('valide → a_traiter est interdit (pas de retour arrière)', () => {
    expect(isAllowedAbandonTransition('valide', 'a_traiter')).toBe(false);
  });

  // envoye_national est terminal côté workflow (le CERFA est un flag séparé)
  it('envoye_national est terminal', () => {
    const transitions: AbandonStatus[] = ['a_traiter', 'valide', 'refuse'];
    for (const target of transitions) {
      expect(isAllowedAbandonTransition('envoye_national', target)).toBe(false);
    }
  });

  // refuse est terminal
  it('refuse est terminal', () => {
    const transitions: AbandonStatus[] = ['a_traiter', 'valide', 'envoye_national'];
    for (const target of transitions) {
      expect(isAllowedAbandonTransition('refuse', target)).toBe(false);
    }
  });

  // self-transitions interdites
  it('un status ne peut pas aller vers lui-même', () => {
    const all: AbandonStatus[] = ['a_traiter', 'valide', 'envoye_national', 'refuse'];
    for (const s of all) {
      expect(isAllowedAbandonTransition(s, s)).toBe(false);
    }
  });
});
