import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret } from '../secret-box';

beforeAll(() => {
  // Clé de test déterministe (32 octets) en base64.
  process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('secret-box', () => {
  it('roundtrip : decrypt(encrypt(x)) === x', () => {
    const secret = 'mon-mot-de-passe-comptaweb-é@#';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('deux chiffrements du même clair donnent des sorties différentes (IV aléatoire)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('toute altération du ciphertext fait échouer le déchiffrement (auth GCM)', () => {
    const enc = encryptSecret('secret');
    const [iv, tag, ct] = enc.split('.');
    const tampered = [iv, tag, Buffer.from('autre-chose').toString('base64')].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('clé absente → erreur explicite', () => {
    const saved = process.env.CREDENTIALS_KEY;
    delete process.env.CREDENTIALS_KEY;
    try {
      expect(() => encryptSecret('x')).toThrow(/CREDENTIALS_KEY/);
    } finally {
      process.env.CREDENTIALS_KEY = saved;
    }
  });
});
