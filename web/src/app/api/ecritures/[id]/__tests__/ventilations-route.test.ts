import { describe, it, expect, vi, beforeEach } from 'vitest';

const ventilateDraft = vi.fn();
vi.mock('@/lib/services/ecritures-ventilate', () => ({ ventilateDraft: (...a: unknown[]) => ventilateDraft(...a) }));
vi.mock('@/lib/api/route-helpers', () => ({
  requireApiContext: async () => ({ ctx: { groupId: 'g1', scopeUniteIds: [] } }),
  parseJsonBody: async (_req: Request, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) => {
    const body = await (_req as Request).json();
    const r = schema.safeParse(body);
    return r.success ? { data: r.data } : { error: new Response('bad', { status: 400 }) };
  },
  jsonError: (msg: string, status: number) => new Response(msg, { status }),
}));

import { PUT } from '../ventilations/route';

const req = (body: unknown) => new Request('http://x', { method: 'PUT', body: JSON.stringify(body) });
const params = Promise.resolve({ id: 'E1' });

describe('PUT /api/ecritures/[id]/ventilations', () => {
  beforeEach(() => ventilateDraft.mockReset());

  it('renvoie 200 + le résultat quand le service accepte', async () => {
    ventilateDraft.mockResolvedValue({ ok: true, ventilation_group_id: 'vg_1', ids: ['E1', 'ECR-2'] });
    const res = await PUT(req({ ventilations: [
      { amount_cents: 700, category_id: 'c1', unite_id: 'u1', activite_id: 'a1' },
      { amount_cents: 364, category_id: 'c2', unite_id: 'u1', activite_id: 'a1' },
    ] }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ids: ['E1', 'ECR-2'] });
  });

  it('renvoie 409 sur sum_mismatch', async () => {
    ventilateDraft.mockResolvedValue({ ok: false, reason: 'sum_mismatch' });
    const res = await PUT(req({ ventilations: [{ amount_cents: 1, category_id: 'c', unite_id: 'u', activite_id: 'a' }] }), { params });
    expect(res.status).toBe(409);
  });

  it('renvoie 404 sur not_found', async () => {
    ventilateDraft.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await PUT(req({ ventilations: [{ amount_cents: 1, category_id: 'c', unite_id: 'u', activite_id: 'a' }] }), { params });
    expect(res.status).toBe(404);
  });

  it('renvoie 400 si ventilations vide', async () => {
    const res = await PUT(req({ ventilations: [] }), { params });
    expect(res.status).toBe(400);
    expect(ventilateDraft).not.toHaveBeenCalled();
  });
});
