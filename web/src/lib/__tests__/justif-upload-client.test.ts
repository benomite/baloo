// Envoi navigateur d'un justificatif (ticket #28) : le fichier part
// directement vers Vercel Blob, en accès PRIVÉ (tout accès doit continuer de
// passer par `GET /api/justificatifs/...`, qui contrôle le group_id).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ upload }));

import { resetUploaderConfig, TELEVERSEMENT_ENDPOINT, uploadJustifFile } from '../justif-upload-client';

const PREFIX = 'televersements/g1/u-alice/';

function configFetch(mode: 'blob' | 'local', putResponse?: Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') {
      return new Response(JSON.stringify({ mode, prefix: PREFIX }), { status: 200 });
    }
    return putResponse ?? new Response(JSON.stringify({ error: 'inattendu' }), { status: 500 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function pdf(mo: number, name = 'Rbst-frais-km-marin.pdf'): File {
  return new File([new Uint8Array(Math.round(mo * 1024 * 1024))], name, { type: 'application/pdf' });
}

beforeEach(() => {
  upload.mockReset();
  resetUploaderConfig();
});

describe('uploadJustifFile — mode blob', () => {
  it('envoie un PDF de 12,8 Mo en direct, en accès privé', async () => {
    upload.mockResolvedValue({ pathname: `${PREFIX}Rbst-frais-km-marin-x7Yz.pdf` });
    const fetchImpl = configFetch('blob');

    const ref = await uploadJustifFile(pdf(12.8), { fetchImpl });

    expect(ref).toEqual({ pathname: `${PREFIX}Rbst-frais-km-marin-x7Yz.pdf`, filename: 'Rbst-frais-km-marin.pdf' });
    expect(upload).toHaveBeenCalledTimes(1);
    const [pathname, , opts] = upload.mock.calls[0];
    expect(pathname).toBe(`${PREFIX}Rbst-frais-km-marin.pdf`);
    expect(opts.access).toBe('private');
    expect(opts.handleUploadUrl).toBe(TELEVERSEMENT_ENDPOINT);
    expect(opts.multipart).toBe(true);
    expect(JSON.parse(opts.clientPayload)).toEqual({
      filename: 'Rbst-frais-km-marin.pdf',
      size: Math.round(12.8 * 1024 * 1024),
      contentType: 'application/pdf',
    });
  });

  it('déduit le type d’une photo HEIC sans MIME navigateur', async () => {
    upload.mockResolvedValue({ pathname: `${PREFIX}IMG_0001.heic` });
    const file = new File([new Uint8Array(10)], 'IMG_0001.HEIC', { type: '' });
    await uploadJustifFile(file, { fetchImpl: configFetch('blob') });
    expect(upload.mock.calls[0][2].contentType).toBe('image/heic');
  });

  it('refuse un type non autorisé avant tout envoi', async () => {
    const fetchImpl = configFetch('blob');
    const file = new File([new Uint8Array(10)], 'virus.exe', { type: 'application/octet-stream' });
    await expect(uploadJustifFile(file, { fetchImpl })).rejects.toThrow(/non autorisé/);
    expect(upload).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('uploadJustifFile — mode local (dev sans Blob)', () => {
  it('envoie le fichier à la route serveur', async () => {
    const fetchImpl = configFetch(
      'local',
      new Response(JSON.stringify({ pathname: `${PREFIX}ab12cd34-facture.pdf`, filename: 'facture.pdf' }), {
        status: 201,
      }),
    );
    const ref = await uploadJustifFile(pdf(1, 'facture.pdf'), { fetchImpl });
    expect(ref).toEqual({ pathname: `${PREFIX}ab12cd34-facture.pdf`, filename: 'facture.pdf' });
    expect(upload).not.toHaveBeenCalled();
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(url).toBe(`${TELEVERSEMENT_ENDPOINT}?filename=facture.pdf`);
    expect(init.method).toBe('PUT');
  });
});
