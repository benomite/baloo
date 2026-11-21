// Transfert interne (#51) : le corps POST envoyé au formulaire Comptaweb
// `/recettedepense/creer` choisit les options comme le trésorier le ferait —
// type « Transfert interne à la structure », mode « Caisse (dépôt) » /
// « (retrait) » / « (transfert) », la caisse du groupe, tiers « Mon groupe » —
// sans ventilation. Les options sont lues dans le formulaire du jour.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CreateEcritureInput } from '../types';

const html = { value: '' };
vi.mock('../http', () => ({
  fetchHtml: async () => html.value,
  ComptawebSessionExpiredError: class extends Error {},
}));

import { createEcriture, resolveSelectsEcriture } from '../ecritures-write';

function formulaire(caisses: Array<[string, string]>): string {
  const opts = (o: Array<[string, string]>) => o.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  return `<form name="ecriturecomptable">
    <input name="ecriturecomptable[_token]" value="tok" />
    <select name="ecriturecomptable[depenserecette]">${opts([['', ''], ['1', 'Dépense'], ['2', 'Recette'], ['3', 'Transfert interne à la structure']])}</select>
    <select name="ecriturecomptable[devise]">${opts([['7', 'Euro']])}</select>
    <select name="ecriturecomptable[modetransaction]">${opts([
      ['', ''], ['1', 'Virement'], ['14', 'Caisse (dépôt)'], ['15', 'Caisse (retrait)'], ['16', 'Caisse (transfert)'],
    ])}</select>
    <select name="ecriturecomptable[caisse]">${opts([['', ''], ...caisses])}</select>
    <table><tbody data-prototype=""></tbody></table>
  </form>`;
}

const transfert = (mode: CreateEcritureInput['modeTransfert']): CreateEcritureInput => ({
  type: 'transfert_interne',
  modeTransfert: mode,
  libel: 'Dépôt espèces camp',
  dateecriture: '03/10/2026',
  montant: '250,50',
  numeropiece: 'ECR-2026-001',
  modetransactionId: '',
  comptebancaireId: '791',
  tiersCategId: '4',
  tiersStructureId: '',
  ventilations: [],
});

describe('createEcriture — transfert interne (corps POST)', () => {
  beforeEach(() => {
    html.value = formulaire([['141', 'Caisse Groupe']]);
  });

  it.each([
    ['depot_especes', '14'],
    ['retrait_especes', '15'],
    ['transfert_especes', '16'],
  ] as const)('mode %s : type 3, mode %s, caisse, date, montant, titre, sans ventilation', async (mode, modeId) => {
    const r = await createEcriture({ baseUrl: 'https://cw.test', cookie: '' }, transfert(mode), { dryRun: true });
    expect(r.warnings).toEqual([]);
    expect(r.postBody).toMatchObject({
      'ecriturecomptable[depenserecette]': '3',
      'ecriturecomptable[modetransaction]': modeId,
      'ecriturecomptable[caisse]': '141',
      'ecriturecomptable[libel]': 'Dépôt espèces camp',
      'ecriturecomptable[dateecriture]': '03/10/2026',
      'ecriturecomptable[montant]': '250.50',
      'ecriturecomptable[numeropiece]': 'ECR-2026-001',
      'ecriturecomptable[tierscateg]': '4',
    });
    expect(Object.keys(r.postBody ?? {}).some((k) => k.includes('ecriturecomptabledetails'))).toBe(false);
  });

  it('un transfert sans libellé reste signalé', async () => {
    const r = await createEcriture({ baseUrl: 'https://cw.test', cookie: '' }, { ...transfert('depot_especes'), libel: ' ' }, { dryRun: true });
    expect(r.warnings).toEqual(['libel vide']);
  });

  it('une dépense garde ses options et exige toujours une ventilation', async () => {
    const r = await createEcriture(
      { baseUrl: 'https://cw.test', cookie: '' },
      { ...transfert(undefined), type: 'depense', modetransactionId: '1', tiersCategId: '10' },
      { dryRun: true },
    );
    expect(r.postBody).toMatchObject({
      'ecriturecomptable[depenserecette]': '1',
      'ecriturecomptable[modetransaction]': '1',
      'ecriturecomptable[caisse]': '',
    });
    expect(r.warnings).toContain('aucune ventilation — au moins une est obligatoire');
  });
});

describe('resolveSelectsEcriture', () => {
  const refs = {
    depenserecette: [{ value: '3', label: 'Transfert interne à la structure' }],
    modetransaction: [{ value: '14', label: 'Caisse (depot)' }],
    caisse: [{ value: '141', label: 'Caisse Groupe' }, { value: '142', label: 'Caisse Camp' }],
  };

  it('recette : option 2 et caisse fournie', () => {
    expect(resolveSelectsEcriture({ ...transfert(undefined), type: 'recette', modetransactionId: '1', caisseId: '9' }, refs))
      .toEqual({ depenserecette: '2', modetransaction: '1', caisse: '9' });
  });

  it('libellé sans accent toléré ; plusieurs caisses → aucune devinée', () => {
    expect(resolveSelectsEcriture(transfert('depot_especes'), refs)).toEqual({
      depenserecette: '3', modetransaction: '14', caisse: '',
    });
  });

  it('caisse demandée explicitement', () => {
    expect(resolveSelectsEcriture({ ...transfert('depot_especes'), caisseId: '142' }, refs).caisse).toBe('142');
  });

  it('sans mode : erreur', () => {
    expect(() => resolveSelectsEcriture(transfert(undefined), refs)).toThrow(/mode de transfert/);
  });

  it('mode absent du formulaire : erreur, pas de valeur devinée', () => {
    expect(() => resolveSelectsEcriture(transfert('retrait_especes'), refs)).toThrow(/Caisse \(retrait\)/);
  });

  it('option « Transfert interne » absente : erreur', () => {
    expect(() => resolveSelectsEcriture(transfert('depot_especes'), { ...refs, depenserecette: [] }))
      .toThrow(/Transfert interne/);
  });

  it('une option vide ne compte pas', () => {
    const vides = {
      depenserecette: [{ value: '', label: 'Transfert interne' }, { value: '3', label: 'Transfert interne à la structure' }],
      modetransaction: [{ value: '', label: 'Caisse (dépôt)' }, { value: '14', label: 'Caisse (dépôt)' }],
      caisse: [{ value: '', label: '' }, { value: '141', label: 'Caisse Groupe' }],
    };
    expect(resolveSelectsEcriture(transfert('depot_especes'), vides)).toEqual({
      depenserecette: '3', modetransaction: '14', caisse: '141',
    });
  });
});
