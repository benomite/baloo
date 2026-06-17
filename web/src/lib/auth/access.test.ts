import { describe, it, expect, vi, beforeEach } from 'vitest';

// redirect() de Next lève en réalité ; on le simule par un throw repérable.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  requireAdmin,
  requireComptaAccess,
  requireCanSubmit,
  requireCampsAccess,
} from './access';

function allowed(fn: (r: string) => void, role: string): boolean {
  try {
    fn(role);
    return true;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('REDIRECT:')) return false;
    throw e;
  }
}

describe('access — requireCanSubmit (process : dépôt/rembs/abandon)', () => {
  it('autorise tresorier, RG, chef, membre', () => {
    for (const r of ['tresorier', 'RG', 'chef', 'membre']) {
      expect(allowed(requireCanSubmit, r)).toBe(true);
    }
  });
  it('autorise les alias legacy equipier/parent (avant migration)', () => {
    expect(allowed(requireCanSubmit, 'equipier')).toBe(true);
    expect(allowed(requireCanSubmit, 'parent')).toBe(true);
  });
  it('refuse un rôle inconnu', () => {
    expect(allowed(requireCanSubmit, 'inconnu')).toBe(false);
  });
});

describe('access — requireCampsAccess (chef + admin uniquement)', () => {
  it('autorise tresorier, RG, chef', () => {
    for (const r of ['tresorier', 'RG', 'chef']) {
      expect(allowed(requireCampsAccess, r)).toBe(true);
    }
  });
  it('refuse le membre (et les legacy equipier/parent)', () => {
    expect(allowed(requireCampsAccess, 'membre')).toBe(false);
    expect(allowed(requireCampsAccess, 'equipier')).toBe(false);
    expect(allowed(requireCampsAccess, 'parent')).toBe(false);
  });
});

describe('access — requireComptaAccess (sur /ecritures)', () => {
  it('autorise tresorier, RG, chef', () => {
    expect(allowed(requireComptaAccess, 'chef')).toBe(true);
  });
  it('refuse le membre', () => {
    expect(allowed(requireComptaAccess, 'membre')).toBe(false);
  });
});

describe('access — requireAdmin', () => {
  it('autorise tresorier/RG, refuse chef et membre', () => {
    expect(allowed(requireAdmin, 'tresorier')).toBe(true);
    expect(allowed(requireAdmin, 'chef')).toBe(false);
    expect(allowed(requireAdmin, 'membre')).toBe(false);
  });
});
