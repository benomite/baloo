import { describe, it, expect } from 'vitest';
import {
  DESKTOP_GROUPS,
  resolveNavItem,
  visibleItemsForRole,
  visibleTabsForRole,
  type NavGroup,
} from './nav-config';

function group(key: 'process' | 'administration'): NavGroup {
  const g = DESKTOP_GROUPS.find((x) => x.key === key);
  if (!g) throw new Error(`groupe ${key} absent`);
  return g;
}

describe('nav-config — structure des groupes', () => {
  it('expose exactement deux groupes : process puis administration', () => {
    expect(DESKTOP_GROUPS.map((g) => g.key)).toEqual(['process', 'administration']);
  });

  it('le bloc administration est repliable et replié par défaut', () => {
    const admin = group('administration');
    expect(admin.collapsible).toBe(true);
    expect(admin.defaultCollapsed).toBe(true);
  });
});

describe('nav-config — desktop, filtrage par rôle', () => {
  it('le trésorier voit les 3 process + tout le bloc administration', () => {
    const process = visibleItemsForRole(group('process').items, 'tresorier').map((i) => i.href);
    expect(process).toEqual(['/depot', '/remboursements', '/abandons']);
    const admin = visibleItemsForRole(group('administration').items, 'tresorier').map((i) => i.href);
    expect(admin).toContain('/ecritures');
    expect(admin).toContain('/caisse');
    expect(admin).toContain('/import');
  });

  it('le chef ne voit aucun item du bloc administration', () => {
    expect(visibleItemsForRole(group('administration').items, 'chef')).toHaveLength(0);
  });

  it('le parent ne voit que Remboursements dans process', () => {
    const process = visibleItemsForRole(group('process').items, 'parent').map((i) => i.href);
    expect(process).toEqual(['/remboursements']);
    expect(visibleItemsForRole(group('administration').items, 'parent')).toHaveLength(0);
  });
});

describe('nav-config — resolveNavItem (role-switch)', () => {
  const depot = group('process').items.find((i) => i.href === '/depot')!;
  const rembs = group('process').items.find((i) => i.href === '/remboursements')!;

  it('Déposer pointe vers /depots avec le libellé "Dépôts" pour un admin', () => {
    expect(resolveNavItem(depot, 'tresorier')).toMatchObject({ href: '/depots', label: 'Dépôts' });
  });

  it('Déposer pointe vers /depot avec le libellé "Déposer" pour un equipier', () => {
    expect(resolveNavItem(depot, 'equipier')).toMatchObject({ href: '/depot', label: 'Déposer' });
  });

  it('Remboursements : "Remboursements" pour admin, "Mes demandes" pour equipier, "Mes reçus"→/ pour parent', () => {
    expect(resolveNavItem(rembs, 'RG').label).toBe('Remboursements');
    expect(resolveNavItem(rembs, 'equipier').label).toBe('Mes demandes');
    expect(resolveNavItem(rembs, 'parent')).toMatchObject({ href: '/', label: 'Mes reçus' });
  });
});

describe('nav-config — mobile', () => {
  it('le trésorier voit Déposer / Demandes / Abandons / Plus', () => {
    expect(visibleTabsForRole('tresorier').map((t) => t.key)).toEqual([
      'depot', 'demandes', 'abandons', 'plus',
    ]);
  });

  it("l'equipier voit Déposer / Demandes / Abandons, sans Plus", () => {
    expect(visibleTabsForRole('equipier').map((t) => t.key)).toEqual(['depot', 'demandes', 'abandons']);
  });

  it('le parent voit seulement "Mes reçus" pointant vers /', () => {
    const tabs = visibleTabsForRole('parent');
    expect(tabs.map((t) => t.key)).toEqual(['recus']);
    expect(tabs[0].href).toBe('/');
  });
});
