import { describe, it, expect } from 'vitest';
import { escapeCsv, formatAmountCsv, buildCsv } from '../csv';

describe('escapeCsv', () => {
  it('laisse une valeur simple intacte', () => {
    expect(escapeCsv('Intermarché')).toBe('Intermarché');
  });
  it('entoure et double les guillemets quand il le faut', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('il a dit "oui"')).toBe('"il a dit ""oui"""');
    expect(escapeCsv('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });
  it('rend null et undefined comme une chaîne vide', () => {
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
  });
});

describe('formatAmountCsv', () => {
  it('formate en virgule décimale sans séparateur de milliers', () => {
    expect(formatAmountCsv(8777)).toBe('87,77');
    expect(formatAmountCsv(197757)).toBe('1977,57');
    expect(formatAmountCsv(-1059)).toBe('-10,59');
    expect(formatAmountCsv(5)).toBe('0,05');
  });
});

describe('buildCsv', () => {
  it('préfixe le BOM UTF-8 et joint en CRLF', () => {
    const csv = buildCsv(['id', 'montant'], [['E1', '87,77']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // La valeur '87,77' contient une virgule : escapeCsv l'entoure de
    // guillemets (même règle que la description ci-dessus), c'est le
    // comportement déjà produit par la route avant ce déplacement.
    expect(csv).toContain('id,montant\r\nE1,"87,77"');
  });
});
