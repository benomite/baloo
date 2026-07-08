// Test isolé du schema Zod `createSchema` de POST /api/ecritures
// (multi-ventilation, S0 2026-07-08). On teste uniquement la validation
// du body — pas le handler (qui dépend de la BDD/scraper CW).

import { describe, it, expect, vi } from 'vitest';

// `route.ts` importe `requireApiContext` → `auth.ts` → `next-auth`, qui
// plante à l'import sous Vitest (résolution ESM stricte de `next/server`
// incompatible avec cette version de next-auth hors runtime Next). On ne
// teste ici QUE `createSchema` (validation pure) : mocker `auth.ts`
// évite de charger next-auth pour ce test sans toucher au comportement
// runtime réel de la route (jamais exercé ici).
vi.mock('@/lib/auth/auth', () => ({ auth: async () => null }));

const { createSchema } = await import('../ecritures/route');

const base = {
  date_ecriture: '2026-07-08', description: 'x', amount_cents: 10000, type: 'depense',
  mode_paiement_id: 'MODE-CB',
};

describe('createSchema (route ecritures)', () => {
  it('accepte N ventilations dont la somme = total', () => {
    const r = createSchema.safeParse({ ...base, ventilations: [
      { amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
      { amount_cents: 3000, category_id: 'CAT-MAT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
    ]});
    expect(r.success).toBe(true);
  });
  it('rejette si la somme des ventilations ≠ amount_cents', () => {
    const r = createSchema.safeParse({ ...base, ventilations: [
      { amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
    ]});
    expect(r.success).toBe(false);
  });
  it('accepte une seule ventilation (mono-catégorie)', () => {
    const r = createSchema.safeParse({ ...base, amount_cents: 5000, ventilations: [
      { amount_cents: 5000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
    ]});
    expect(r.success).toBe(true);
  });
});
