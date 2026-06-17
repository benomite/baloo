import { describe, it, expect } from 'vitest';
import {
  parseDistanceToDixiemes,
  computeKmAmountCents,
  formatKmRate,
  formatDistance,
} from './km';

describe('km — parseDistanceToDixiemes', () => {
  it('parse les entiers et décimales (virgule ou point)', () => {
    expect(parseDistanceToDixiemes('100')).toBe(1000);
    expect(parseDistanceToDixiemes('12,5')).toBe(125);
    expect(parseDistanceToDixiemes('12.5')).toBe(125);
    expect(parseDistanceToDixiemes(' 8,4 ')).toBe(84);
  });
  it('arrondit au dixième', () => {
    expect(parseDistanceToDixiemes('12,54')).toBe(125);
    expect(parseDistanceToDixiemes('12,56')).toBe(126);
  });
  it('rejette une saisie invalide ou <= 0', () => {
    expect(() => parseDistanceToDixiemes('')).toThrow();
    expect(() => parseDistanceToDixiemes('abc')).toThrow();
    expect(() => parseDistanceToDixiemes('0')).toThrow();
    expect(() => parseDistanceToDixiemes('-5')).toThrow();
  });
});

describe('km — computeKmAmountCents', () => {
  it('100 km au taux 0,354 → 35,40 €', () => {
    expect(computeKmAmountCents(1000, 354)).toBe(3540);
  });
  it('12,5 km au taux 0,354 → 4,43 € (arrondi)', () => {
    expect(computeKmAmountCents(125, 354)).toBe(443);
  });
  it('taux alternatif 0,40 €/km, 50 km → 20,00 €', () => {
    expect(computeKmAmountCents(500, 400)).toBe(2000);
  });
});

describe('km — formatage', () => {
  it('formatKmRate affiche le taux en euros', () => {
    expect(formatKmRate(354)).toBe('0,354 €');
  });
  it('formatDistance affiche la distance en km', () => {
    expect(formatDistance(1000)).toBe('100 km');
    expect(formatDistance(125)).toBe('12,5 km');
  });
});
