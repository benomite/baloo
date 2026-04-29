import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmount } from './format';

// Le séparateur entre montant et `€` est volontairement un NBSP
// ( ) — empêche la coupure de ligne dans les rendus HTML.
const NBSP = ' ';

describe('formatAmount', () => {
  it('formate des centimes positifs avec 2 décimales fixes', () => {
    expect(formatAmount(0)).toBe(`0,00${NBSP}€`);
    expect(formatAmount(50)).toBe(`0,50${NBSP}€`);
    expect(formatAmount(1234)).toBe(`12,34${NBSP}€`);
    expect(formatAmount(123456)).toBe(`1234,56${NBSP}€`);
  });

  it('formate les montants négatifs avec un signe -', () => {
    expect(formatAmount(-50)).toBe(`-0,50${NBSP}€`);
    expect(formatAmount(-1234)).toBe(`-12,34${NBSP}€`);
  });

  it('pad les centimes inférieurs à 10 avec un 0', () => {
    expect(formatAmount(105)).toBe(`1,05${NBSP}€`);
    expect(formatAmount(101)).toBe(`1,01${NBSP}€`);
  });

  it('utilise un NBSP (et non un espace simple) avant le €', () => {
    const out = formatAmount(1234);
    expect(out).toContain(NBSP);
    expect(out).not.toContain(' €');
  });
});

describe('parseAmount', () => {
  it('parse les formats français standard', () => {
    expect(parseAmount('0,50')).toBe(50);
    expect(parseAmount('12,34')).toBe(1234);
    expect(parseAmount('1234,56')).toBe(123456);
  });

  it('parse les montants sans virgule (entiers)', () => {
    expect(parseAmount('42')).toBe(4200);
    expect(parseAmount('0')).toBe(0);
  });

  it('parse les montants avec point décimal (format anglo)', () => {
    expect(parseAmount('12.34')).toBe(1234);
    expect(parseAmount('0.50')).toBe(50);
  });

  it('gère le signe -', () => {
    expect(parseAmount('-12,34')).toBe(-1234);
    expect(parseAmount('-0,50')).toBe(-50);
  });

  it('ignore les espaces simples, NBSP et le symbole €', () => {
    expect(parseAmount(`12,34${NBSP}€`)).toBe(1234);
    expect(parseAmount(' 12,34€ ')).toBe(1234);
    expect(parseAmount('1 234,56 €')).toBe(123456);
    expect(parseAmount(`1${NBSP}234,56${NBSP}€`)).toBe(123456);
  });

  it('tronque les centimes au-delà de 2 décimales', () => {
    expect(parseAmount('1,2345')).toBe(123);
    expect(parseAmount('1,9')).toBe(190);
  });

  it('parse 0 sans erreur', () => {
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('0,00')).toBe(0);
  });
});

describe('formatAmount/parseAmount round-trip', () => {
  it('parse(format(x)) === x pour une variété de valeurs', () => {
    for (const cents of [0, 50, 1234, 123456, -50, -1234, -123456, 1, 99, 100, 999, 1000]) {
      expect(parseAmount(formatAmount(cents))).toBe(cents);
    }
  });
});
