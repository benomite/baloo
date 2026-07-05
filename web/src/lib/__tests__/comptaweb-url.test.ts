import { describe, it, expect } from 'vitest';
import { comptawebEcritureUrl } from '../comptaweb-url';

describe('comptawebEcritureUrl', () => {
  it('pointe la page /afficher de l\'écriture Comptaweb', () => {
    expect(comptawebEcritureUrl(2430377)).toBe(
      'https://sgdf.production.sirom.net/recettedepense/2430377/afficher',
    );
  });
});
