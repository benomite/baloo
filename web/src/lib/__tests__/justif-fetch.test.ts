import { describe, it, expect } from 'vitest';
import { fetchJustifWithTimeout } from '../justif-fetch';
import type { FetchResult } from '../storage';

const okResult: FetchResult = { body: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };

describe('fetchJustifWithTimeout', () => {
  it('renvoie le résultat quand le fetch aboutit', async () => {
    const out = await fetchJustifWithTimeout(async () => okResult, 'depot/D/f.jpg', 1000);
    expect(out).toEqual({ status: 'ok', result: okResult });
  });

  it('propage un résultat null (blob absent) sans erreur', async () => {
    const out = await fetchJustifWithTimeout(async () => null, 'depot/D/f.jpg', 1000);
    expect(out).toEqual({ status: 'ok', result: null });
  });

  it('capture une erreur du storage', async () => {
    const boom = new Error('blob get failed');
    const out = await fetchJustifWithTimeout(async () => { throw boom; }, 'depot/D/f.jpg', 1000);
    expect(out).toEqual({ status: 'error', error: boom });
  });

  it('renvoie timeout quand le fetch ne répond pas à temps', async () => {
    // Promesse qui ne se résout jamais → seul le timeout tranche.
    const out = await fetchJustifWithTimeout(
      () => new Promise<FetchResult | null>(() => {}),
      'depot/D/f.jpg',
      20,
    );
    expect(out).toEqual({ status: 'timeout' });
  });
});
