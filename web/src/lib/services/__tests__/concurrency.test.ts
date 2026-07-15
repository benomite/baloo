import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../concurrency';

const deferred = () => {
  let resolve!: (v: number) => void;
  const promise = new Promise<number>((r) => (resolve = r));
  return { promise, resolve };
};

describe('mapWithConcurrency', () => {
  it('ne dépasse jamais la limite de concurrence', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = async (n: number) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    };
    const res = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, fn);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(res.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16,
    ]);
  });

  it("préserve l'ordre malgré des durées variables", async () => {
    const fn = async (n: number) => {
      await new Promise((r) => setTimeout(r, (10 - n) * 3));
      return n;
    };
    const res = await mapWithConcurrency([1, 2, 3, 4], 2, fn);
    expect(res.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2, 3, 4]);
  });

  it("isole les rejets (une erreur n'annule pas les autres)", async () => {
    const fn = async (n: number) => {
      if (n === 2) throw new Error('boom');
      return n;
    };
    const res = await mapWithConcurrency([1, 2, 3], 2, fn);
    expect(res[0]).toMatchObject({ status: 'fulfilled', value: 1 });
    expect(res[1].status).toBe('rejected');
    expect(res[2]).toMatchObject({ status: 'fulfilled', value: 3 });
  });

  it('gère la liste vide et limit ≥ longueur', async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
    const res = await mapWithConcurrency([1, 2], 10, async (n) => n);
    expect(res.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2]);
  });
});
