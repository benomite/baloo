import { describe, it, expect, vi } from 'vitest';
import { parseExercicesHtml, assurerExercice, type PageExercices } from '../exercices';
import type { ComptawebConfig } from '../types';

const HTML = `
<html><body>
  <h3>CHANGEMENT DE L'EXERCICE DE TRAVAIL</h3>
  <form method="post" action="/exercice/upd?id=33">
    <select name="exercice_change[identifiants_exercices]">
      <option value="34">Sept 2026 - Août 2027</option>
      <option value="33" selected="selected">Sept 2025 - Août 2026</option>
      <option value="32">Sept 2024 - Aout 2025</option>
    </select>
    <input type="hidden" name="exercice_change[_token]" value="tok-abc" />
    <button type="submit" name="exercice_change[submit]">Prendre ce nouvel exercice</button>
  </form>
</body></html>`;

const CONFIG: ComptawebConfig = { baseUrl: 'https://comptaweb.sgdf.fr', cookie: 'PHPSESSID=x' };

describe('parseExercicesHtml', () => {
  it("lit le contexte courant dans l'action du formulaire", () => {
    expect(parseExercicesHtml(HTML).contexteCwId).toBe(33);
  });

  it('liste les exercices proposés', () => {
    expect(parseExercicesHtml(HTML).options).toEqual([
      { cwId: 34, libelle: 'Sept 2026 - Août 2027' },
      { cwId: 33, libelle: 'Sept 2025 - Août 2026' },
      { cwId: 32, libelle: 'Sept 2024 - Aout 2025' },
    ]);
  });

  it('lit le jeton CSRF', () => {
    expect(parseExercicesHtml(HTML).csrfToken).toBe('tok-abc');
  });

  it('échoue clairement si le formulaire a changé', () => {
    expect(() => parseExercicesHtml('<html><body>rien</body></html>')).toThrow(/exercice/i);
  });
});

describe('assurerExercice', () => {
  const page = (contexteCwId: number): PageExercices => ({
    contexteCwId,
    options: [
      { cwId: 34, libelle: 'Sept 2026 - Août 2027' },
      { cwId: 33, libelle: 'Sept 2025 - Août 2026' },
    ],
    csrfToken: 'tok-abc',
    actionPath: `/exercice/upd?id=${contexteCwId}`,
  });

  it('ne bascule pas quand la session est déjà sur le bon exercice', async () => {
    const poster = vi.fn();
    await assurerExercice(CONFIG, 33, { lirePage: async () => page(33), poster });
    expect(poster).not.toHaveBeenCalled();
  });

  it('bascule puis relit pour confirmer', async () => {
    const poster = vi.fn();
    const lirePage = vi.fn().mockResolvedValueOnce(page(33)).mockResolvedValueOnce(page(34));

    await assurerExercice(CONFIG, 34, { lirePage, poster });

    expect(poster).toHaveBeenCalledTimes(1);
    const [, path, body] = poster.mock.calls[0]!;
    expect(path).toBe('/exercice/upd?id=33');
    expect((body as URLSearchParams).get('exercice_change[identifiants_exercices]')).toBe('34');
    expect((body as URLSearchParams).get('exercice_change[_token]')).toBe('tok-abc');
    expect(lirePage).toHaveBeenCalledTimes(2);
  });

  it('throw si la relecture ne confirme pas la bascule', async () => {
    const lirePage = vi.fn().mockResolvedValueOnce(page(33)).mockResolvedValueOnce(page(33));

    await expect(
      assurerExercice(CONFIG, 34, { lirePage, poster: async () => {} }),
    ).rejects.toThrow(/exercice 34/i);
  });

  it("throw si l'exercice demandé n'est pas proposé par CW", async () => {
    await expect(
      assurerExercice(CONFIG, 99, { lirePage: async () => page(33), poster: async () => {} }),
    ).rejects.toThrow(/99/);
  });
});
