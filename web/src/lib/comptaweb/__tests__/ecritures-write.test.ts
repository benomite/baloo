// Réponse du POST de création d'écriture Comptaweb. Seule une redirection vers
// la fiche créée (/recettedepense/<id>/afficher) prouve la création. Cas réel
// 2026-09-11 : 5 écritures datées de septembre, hors de l'exercice ouvert
// (25/26) — CW a redirigé ailleurs, Baloo a pris ça pour un succès et les a
// marquées « mirror » sans id CW. Aucune n'existait dans Comptaweb.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FORM_HTML = `
  <form name="ecriturecomptable">
    <input name="ecriturecomptable[_token]" value="csrf-123" />
    <select name="ecriturecomptable[devise]"><option value="1">Euro</option></select>
    <table><tbody data-prototype=""></tbody></table>
  </form>`;

vi.mock('../http', () => ({
  fetchHtml: async () => FORM_HTML,
  ComptawebSessionExpiredError: class ComptawebSessionExpiredError extends Error {},
}));

import { createEcriture } from '../ecritures-write';
import type { CreateEcritureInput } from '../types';

const config = { baseUrl: 'https://comptaweb.test', cookie: 'x=y' } as never;

const input: CreateEcritureInput = {
  type: 'depense',
  libel: 'Remboursement Pauline Chanel',
  dateecriture: '11/09/2026',
  montant: '139,07',
  modetransactionId: '1',
  comptebancaireId: '791',
  tiersCategId: '10',
  tiersStructureId: '',
  ventilations: [{ montant: '139,07', natureId: '5', activiteId: '7', brancheprojetId: '9' }],
};

function mockPostResponse(status: number, location?: string, body = '') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers: location ? { location } : {} })),
  );
}

describe('createEcriture — interprétation de la réponse CW', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('redirection vers la fiche créée : succès avec id CW', async () => {
    mockPostResponse(302, '/recettedepense/2530001/afficher');
    const res = await createEcriture(config, input, { dryRun: false });
    expect(res.ecritureId).toBe(2530001);
  });

  it("redirection ailleurs (ex. retour au formulaire) : échec, jamais un succès sans id", async () => {
    mockPostResponse(302, '/recettedepense/creer');
    await expect(createEcriture(config, input, { dryRun: false })).rejects.toThrow(/recettedepense\/creer/);
  });

  it('redirection vers la liste : échec aussi', async () => {
    mockPostResponse(303, '/recettedepense');
    await expect(createEcriture(config, input, { dryRun: false })).rejects.toThrow(/non confirmée/);
  });
});
