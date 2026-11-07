import { describe, it, expect } from 'vitest';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  checkJustifMeta,
  mimeFromFilename,
  sanitizeFilename,
  validateClientFile,
} from '../justif-allowed';

describe('limite de taille (ticket #28)', () => {
  it('dépasse largement l’ancien plafond edge Vercel (~4,5 Mo)', () => {
    expect(MAX_FILE_SIZE_BYTES).toBeGreaterThan(4.5 * 1024 * 1024);
  });

  it('accepte le PDF de 12,8 Mo refusé le 2026-08-17', () => {
    const size = Math.round(12.8 * 1024 * 1024);
    expect(checkJustifMeta({ filename: 'Rbst-frais-km-marin.pdf', size, mime_type: 'application/pdf' })).toBeNull();
  });

  it('annonce la limite réelle, celle imposée par le token d’upload', () => {
    const msg = checkJustifMeta({ filename: 'a.pdf', size: MAX_FILE_SIZE_BYTES + 1, mime_type: 'application/pdf' });
    expect(msg).toContain(`Limite : ${MAX_FILE_SIZE_LABEL}`);
    expect(msg).not.toMatch(/10 MB/);
  });

  it('taille inconnue (null) : seule la whitelist est vérifiée', () => {
    expect(checkJustifMeta({ filename: 'a.pdf', size: null, mime_type: 'application/pdf' })).toBeNull();
    expect(checkJustifMeta({ filename: 'a.exe', size: null })).toMatch(/non autorisé/);
  });
});

describe('checkJustifMeta — whitelist', () => {
  it('refuse une extension hors whitelist', () => {
    expect(checkJustifMeta({ filename: 'script.html', size: 10 })).toMatch(/\.html/);
  });

  it('refuse un MIME inconnu, tolère un MIME absent', () => {
    expect(checkJustifMeta({ filename: 'a.pdf', size: 10, mime_type: 'text/html' })).toMatch(/MIME/);
    expect(checkJustifMeta({ filename: 'a.pdf', size: 10, mime_type: null })).toBeNull();
  });
});

describe('validateClientFile', () => {
  it('préfixe le message par le nom du fichier', () => {
    const f = new File([new Uint8Array(10)], 'virus.exe', { type: 'application/octet-stream' });
    expect(validateClientFile(f)).toMatch(/^virus\.exe : /);
  });
});

describe('mimeFromFilename', () => {
  it('couvre les photos iOS, que le navigateur laisse souvent sans type', () => {
    expect(mimeFromFilename('IMG_0001.HEIC')).toBe('image/heic');
    expect(mimeFromFilename('scan.pdf')).toBe('application/pdf');
    expect(mimeFromFilename('inconnu.bin')).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  it('produit un nom sûr pour un pathname, en gardant l’extension', () => {
    expect(sanitizeFilename('Rbst frais km (marin).PDF')).toBe('Rbst_frais_km_marin.pdf');
    expect(sanitizeFilename('reçu été.jpg')).toBe('recu_ete.jpg');
    expect(sanitizeFilename('../../etc/passwd.pdf')).toBe('etc_passwd.pdf');
    expect(sanitizeFilename('...pdf')).toBe('fichier.pdf');
  });
});
