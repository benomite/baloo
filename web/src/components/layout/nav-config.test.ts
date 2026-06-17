import { describe, it, expect } from 'vitest';
import {
  DESKTOP_GROUPS,
  resolveNavItem,
  visibleItemsForRole,
  visibleTabsForRole,
  type NavGroup,
} from './nav-config';

function group(key: 'process' | 'comptabilite' | 'administration'): NavGroup {
  const g = DESKTOP_GROUPS.find((x) => x.key === key);
  if (!g) throw new Error(`groupe ${key} absent`);
  return g;
}

describe('nav-config — structure des groupes', () => {
  it('expose trois groupes : process, comptabilite, administration', () => {
    expect(DESKTOP_GROUPS.map((g) => g.key)).toEqual(['process', 'comptabilite', 'administration']);
  });

  it('le groupe comptabilité contient Écritures, Caisse, Rapprochement', () => {
    expect(group('comptabilite').items.map((i) => i.href)).toEqual(['/ecritures', '/caisse', '/inbox']);
  });

  it('le bloc administration est repliable et replié par défaut', () => {
    const admin = group('administration');
    expect(admin.collapsible).toBe(true);
    expect(admin.defaultCollapsed).toBe(true);
  });
});

describe('nav-config — desktop, filtrage par rôle', () => {
  it('le trésorier voit les 4 process + comptabilité + administration (système)', () => {
    const process = visibleItemsForRole(group('process').items, 'tresorier').map((i) => i.href);
    expect(process).toEqual(['/depot', '/camps', '/remboursements', '/abandons']);
    const compta = visibleItemsForRole(group('comptabilite').items, 'tresorier').map((i) => i.href);
    expect(compta).toEqual(['/ecritures', '/caisse', '/inbox']);
    const admin = visibleItemsForRole(group('administration').items, 'tresorier').map((i) => i.href);
    expect(admin).toContain('/import');
  });

  it('le chef ne voit aucun item de comptabilité ni d’administration', () => {
    expect(visibleItemsForRole(group('comptabilite').items, 'chef')).toHaveLength(0);
    expect(visibleItemsForRole(group('administration').items, 'chef')).toHaveLength(0);
  });

  it('le membre voit Déposer/Demandes/Abandons mais PAS Camps', () => {
    const process = visibleItemsForRole(group('process').items, 'membre').map((i) => i.href);
    expect(process).toEqual(['/depot', '/remboursements', '/abandons']);
    expect(visibleItemsForRole(group('comptabilite').items, 'membre')).toHaveLength(0);
    expect(visibleItemsForRole(group('administration').items, 'membre')).toHaveLength(0);
  });
});

describe('nav-config — resolveNavItem (role-switch)', () => {
  const depot = group('process').items.find((i) => i.href === '/depot')!;
  const rembs = group('process').items.find((i) => i.href === '/remboursements')!;

  it('Déposer pointe vers /depots avec le libellé "Dépôts" pour un admin', () => {
    expect(resolveNavItem(depot, 'tresorier')).toMatchObject({ href: '/depots', label: 'Dépôts' });
  });

  it('Déposer pointe vers /depot avec le libellé "Déposer" pour un membre', () => {
    expect(resolveNavItem(depot, 'membre')).toMatchObject({ href: '/depot', label: 'Déposer' });
  });

  it('Remboursements : "Remboursements" pour admin, "Mes demandes" pour membre', () => {
    expect(resolveNavItem(rembs, 'RG').label).toBe('Remboursements');
    expect(resolveNavItem(rembs, 'membre').label).toBe('Mes demandes');
  });
});

describe('nav-config — mobile', () => {
  it('le trésorier voit Déposer / Demandes / Abandons / Plus', () => {
    expect(visibleTabsForRole('tresorier').map((t) => t.key)).toEqual([
      'depot', 'demandes', 'abandons', 'plus',
    ]);
  });

  it('le membre voit Déposer / Demandes / Abandons, sans Plus', () => {
    expect(visibleTabsForRole('membre').map((t) => t.key)).toEqual(['depot', 'demandes', 'abandons']);
  });
});
