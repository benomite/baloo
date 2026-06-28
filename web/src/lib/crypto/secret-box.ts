// Chiffrement symétrique réversible pour secrets applicatifs (ex. mot de passe
// Comptaweb). AES-256-GCM : confidentialité + authentification (toute
// altération est détectée au déchiffrement). Clé depuis CREDENTIALS_KEY
// (base64, 32 octets) — jamais en BDD ni en git.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

function getKey(): Buffer {
  const b64 = process.env.CREDENTIALS_KEY;
  if (!b64) {
    throw new Error('CREDENTIALS_KEY manquante (clé de chiffrement des secrets).');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_KEY invalide : 32 octets attendus (base64).');
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Format de secret chiffré invalide.');
  }
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
