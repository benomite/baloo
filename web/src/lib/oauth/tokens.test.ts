import { describe, it, expect } from 'vitest';
import {
  generateAuthorizationCode,
  generateAccessToken,
  hashOauthToken,
} from './tokens';

describe('generateAuthorizationCode', () => {
  it('a le prefixe boc_ et est base64url', () => {
    const { plain } = generateAuthorizationCode();
    expect(plain.startsWith('boc_')).toBe(true);
    expect(plain.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('plain et hash sont coherents (hashOauthToken(plain) === hash)', () => {
    const { plain, hash } = generateAuthorizationCode();
    expect(hashOauthToken(plain)).toBe(hash);
  });

  it('produit des codes uniques (collision improbable sur 100 iterations)', () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) codes.add(generateAuthorizationCode().plain);
    expect(codes.size).toBe(100);
  });
});

describe('generateAccessToken', () => {
  it('a le prefixe boa_', () => {
    const { plain } = generateAccessToken();
    expect(plain.startsWith('boa_')).toBe(true);
  });

  it('hash matche', () => {
    const { plain, hash } = generateAccessToken();
    expect(hashOauthToken(plain)).toBe(hash);
  });
});

describe('hashOauthToken', () => {
  it('retourne le SHA-256 hex (64 chars)', () => {
    const hash = hashOauthToken('boa_test');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('est deterministe', () => {
    expect(hashOauthToken('xxx')).toBe(hashOauthToken('xxx'));
  });
});
