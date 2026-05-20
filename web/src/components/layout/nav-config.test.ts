import { describe, it, expect } from 'vitest';
import { DESKTOP_GROUPS, MOBILE_TABS, visibleItemsForRole, visibleTabsForRole } from './nav-config';

describe('nav-config — desktop', () => {
  it('le trésorier voit les 4 groupes d intention', () => {
    const groups = DESKTOP_GROUPS.filter((g) => visibleItemsForRole(g.items, 'tresorier').length > 0);
    expect(groups.map((g) => g.intent)).toEqual(['piloter', 'saisir', 'demandes', 'gerer']);
  });

  it('le chef ne voit que Synthèse et Budget (scopés) dans Piloter', () => {
    const piloter = DESKTOP_GROUPS.find((g) => g.intent === 'piloter')!;
    const items = visibleItemsForRole(piloter.items, 'chef').map((i) => i.href);
    expect(items).toEqual(['/synthese', '/budgets']);
  });

  it('aucun item compta ne fuit vers equipier sur desktop', () => {
    const all = DESKTOP_GROUPS.flatMap((g) => visibleItemsForRole(g.items, 'equipier'));
    expect(all.map((i) => i.href)).not.toContain('/ecritures');
    expect(all.map((i) => i.href)).not.toContain('/caisse');
  });

  it('Import et Clôture ne sont dans aucun groupe', () => {
    const hrefs = DESKTOP_GROUPS.flatMap((g) => g.items).map((i) => i.href);
    expect(hrefs).not.toContain('/import');
    expect(hrefs).not.toContain('/cloture');
  });
});

describe('nav-config — mobile', () => {
  it('equipier voit 3 onglets : accueil, depot, mes-demandes', () => {
    expect(visibleTabsForRole('equipier').map((t) => t.key)).toEqual(['accueil', 'depot', 'demandes']);
  });

  it('parent voit accueil + mes reçus (pas depot)', () => {
    const keys = visibleTabsForRole('parent').map((t) => t.key);
    expect(keys).toContain('recus');
    expect(keys).not.toContain('depot');
  });

  it('trésorier voit les 3 onglets membre + onglet plus', () => {
    expect(visibleTabsForRole('tresorier').map((t) => t.key)).toEqual(['accueil', 'depot', 'demandes', 'plus']);
  });
});
