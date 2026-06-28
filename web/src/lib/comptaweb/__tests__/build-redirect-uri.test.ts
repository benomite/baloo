import { describe, it, expect } from 'vitest';
import { buildRedirectUri } from '../auth-automated';

// Comptaweb fournit `paramRedirectUri` dans le JS de /authentification/keycloak.
// Historiquement = juste le HOST ; depuis 2026-06 = l'URL COMPLÈTE (souvent
// déjà URL-encodée). Le redirect_uri envoyé à Keycloak doit valoir exactement
// `https://sgdf.production.sirom.net/` dans les deux cas — sinon HTTP 400
// (bug terrain : double `https://https%3A%2F%2F...` quand on préfixait le
// schéma à une valeur qui en contenait déjà un).

describe('buildRedirectUri', () => {
  const EXPECTED = 'https://sgdf.production.sirom.net/';

  it('ancien format : host seul → préfixe le schéma', () => {
    expect(buildRedirectUri('sgdf.production.sirom.net')).toBe(EXPECTED);
  });

  it('nouveau format : URL complète déjà encodée → décodée telle quelle', () => {
    expect(buildRedirectUri('https%3A%2F%2Fsgdf.production.sirom.net%2F')).toBe(EXPECTED);
  });

  it('URL complète non encodée → telle quelle', () => {
    expect(buildRedirectUri('https://sgdf.production.sirom.net/')).toBe(EXPECTED);
  });
});
