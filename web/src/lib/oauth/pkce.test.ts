import { describe, it, expect } from 'vitest';
import { computeS256Challenge, verifyS256Pkce } from './pkce';

describe('computeS256Challenge', () => {
  it('retourne le hash SHA-256 base64url du verifier (vecteur RFC 7636)', () => {
    // Vecteur officiel de la RFC 7636 §B.1.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(computeS256Challenge(verifier)).toBe(expected);
  });

  it('produit toujours du base64url (pas de + / =)', () => {
    const challenge = computeS256Challenge('any-verifier-with-padding-chars');
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it('est déterministe', () => {
    const v = 'abcdef123456';
    expect(computeS256Challenge(v)).toBe(computeS256Challenge(v));
  });
});

describe('verifyS256Pkce', () => {
  it('retourne true quand SHA256(verifier) == challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(verifyS256Pkce(verifier, challenge)).toBe(true);
  });

  it('retourne false quand verifier ne matche pas', () => {
    expect(verifyS256Pkce('wrong-verifier', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
  });
});
