import { describe, it, expect } from 'vitest';
import { parseLignesFromForm, resolveLignesWithRate } from './_helpers';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const fail = (msg: string): never => {
  throw new Error(msg);
};

describe('parseLignesFromForm — type depense / km', () => {
  it('parse une ligne dépense (montant)', () => {
    const lignes = parseLignesFromForm(
      fd({ ligne_count: '1', ligne_0_type: 'depense', ligne_0_date: '2026-05-09', ligne_0_nature: 'Courses', ligne_0_montant: '37,04' }),
      fail,
    );
    expect(lignes[0]).toMatchObject({ type: 'depense', amount_cents: 3704, distance_km_dixiemes: null });
  });

  it('parse une ligne km (distance, montant ignoré)', () => {
    const lignes = parseLignesFromForm(
      fd({ ligne_count: '1', ligne_0_type: 'km', ligne_0_date: '2026-05-09', ligne_0_nature: 'Trajet', ligne_0_km: '120' }),
      fail,
    );
    expect(lignes[0]).toMatchObject({ type: 'km', distance_km_dixiemes: 1200, amount_cents: 0 });
  });

  it('défaut depense si type absent (rétrocompat)', () => {
    const lignes = parseLignesFromForm(
      fd({ ligne_count: '1', ligne_0_date: '2026-05-09', ligne_0_nature: 'X', ligne_0_montant: '10,00' }),
      fail,
    );
    expect(lignes[0].type).toBe('depense');
  });

  it('échoue si ligne km sans distance', () => {
    expect(() =>
      parseLignesFromForm(
        fd({ ligne_count: '1', ligne_0_type: 'km', ligne_0_date: '2026-05-09', ligne_0_nature: 'Trajet' }),
        fail,
      ),
    ).toThrow();
  });
});

describe('resolveLignesWithRate', () => {
  it('calcule le montant des lignes km au taux fourni et fige le taux', () => {
    const resolved = resolveLignesWithRate(
      [
        { type: 'depense', date: '2026-05-09', nature: 'Courses', amount_cents: 3704, distance_km_dixiemes: null },
        { type: 'km', date: '2026-05-09', nature: 'Trajet', amount_cents: 0, distance_km_dixiemes: 1200 },
      ],
      354,
    );
    expect(resolved[0]).toMatchObject({ type: 'depense', amount_cents: 3704, distance_km_dixiemes: null, taux_km_millicents: null });
    expect(resolved[1]).toMatchObject({ type: 'km', amount_cents: 4248, distance_km_dixiemes: 1200, taux_km_millicents: 354 });
  });
});
