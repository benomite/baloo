import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encodeJustifPath, justifUrl } from '../justif-url';

describe('encodeJustifPath / justifUrl', () => {
  it('laisse intact un chemin ordinaire', () => {
    expect(encodeJustifPath('ecriture/ECR-2026-933/JUS-2026-326-facture.pdf')).toBe(
      'ecriture/ECR-2026-933/JUS-2026-326-facture.pdf',
    );
  });

  it('encode #, ? et % du nom de fichier sans toucher aux séparateurs', () => {
    expect(encodeJustifPath('ecriture/ECR-2026-933/JUS-2026-326-#FA099103.pdf')).toBe(
      'ecriture/ECR-2026-933/JUS-2026-326-%23FA099103.pdf',
    );
    expect(encodeJustifPath('a/b/c?d%e.pdf')).toBe('a/b/c%3Fd%25e.pdf');
  });

  it("produit une adresse dont le '#' ne coupe plus le chemin", () => {
    const url = new URL(justifUrl('ecriture/E/J-#FA.pdf'), 'http://x');
    expect(url.hash).toBe('');
    expect(url.pathname).toBe('/api/justificatifs/ecriture/E/J-%23FA.pdf');
    // Le routeur décode : on retrouve le file_path stocké.
    expect(decodeURIComponent(url.pathname.slice('/api/justificatifs/'.length))).toBe('ecriture/E/J-#FA.pdf');
  });
});

describe('VercelBlobBackend.fetch', () => {
  const get = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    get.mockReset();
    vi.doMock('@vercel/blob', () => ({ get }));
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test_secret');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@vercel/blob');
  });

  it("demande le blob sous un chemin encodé (un '#' ne tronque pas l'URL)", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: new Uint8Array([1]), blob: { contentType: 'application/pdf' } });
    const { getStorage } = await import('../storage');
    const res = await getStorage().fetch('ecriture/E/J-#FA 1?.pdf');
    expect(get).toHaveBeenCalledWith('ecriture/E/J-%23FA%201%3F.pdf', { access: 'private' });
    expect(res?.contentType).toBe('application/pdf');
  });
});
