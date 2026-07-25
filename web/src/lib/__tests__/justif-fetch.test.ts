import { describe, it, expect } from 'vitest';
import { fetchJustifWithTimeout, readBodyWithTimeout } from '../justif-fetch';
import type { FetchResult } from '../storage';

const okResult: FetchResult = { body: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };

// Fabrique un ReadableStream qui émet les chunks fournis puis se termine.
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

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

describe('readBodyWithTimeout', () => {
  it('passe-plat un Uint8Array (backend FS, déjà bufferisé)', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const out = await readBodyWithTimeout(bytes, 1000);
    expect(out).toEqual({ status: 'ok', bytes });
  });

  it('draine un stream complet et concatène les chunks', async () => {
    const out = await readBodyWithTimeout(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), 1000);
    expect(out.status).toBe('ok');
    if (out.status === 'ok') expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
  });

  it('renvoie timeout et annule le reader quand le stream cale en cours de transfert', async () => {
    let cancelled = false;
    // Stream qui émet un 1er chunk puis ne fournit JAMAIS la suite → drain bloqué.
    const stalling = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        // pas de close ni d'autre enqueue : pull ne résout jamais
      },
      cancel() {
        cancelled = true;
      },
    });
    const out = await readBodyWithTimeout(stalling, 20);
    expect(out).toEqual({ status: 'timeout' });
    // laisse la microtask de cancel() se propager
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelled).toBe(true);
  });

  it('capture une erreur de lecture du stream', async () => {
    const boom = new Error('read failed');
    const failing = new ReadableStream<Uint8Array>({
      pull() {
        throw boom;
      },
    });
    const out = await readBodyWithTimeout(failing, 1000);
    expect(out).toEqual({ status: 'error', error: boom });
  });
});
