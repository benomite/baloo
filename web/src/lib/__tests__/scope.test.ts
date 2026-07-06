import { describe, it, expect } from 'vitest';
import { uniteScopeSql, resolveScopedUnite, ScopeUniteError } from '../scope';

describe('uniteScopeSql', () => {
  it('scope vide (global) → aucune clause', () => {
    expect(uniteScopeSql([], 'e.unite_id')).toEqual({ sql: '', params: [] });
  });
  it('une unité → IN à un placeholder', () => {
    expect(uniteScopeSql(['u1'], 'e.unite_id')).toEqual({ sql: 'e.unite_id IN (?)', params: ['u1'] });
  });
  it('plusieurs unités → IN multi-placeholders, ordre préservé', () => {
    expect(uniteScopeSql(['u1', 'u2'], 'c.unite_id')).toEqual({
      sql: 'c.unite_id IN (?, ?)',
      params: ['u1', 'u2'],
    });
  });
});

describe('resolveScopedUnite', () => {
  it('global → renvoie le choix (peut être null)', () => {
    expect(resolveScopedUnite([], 'u3')).toBe('u3');
    expect(resolveScopedUnite([], null)).toBeNull();
  });
  it('scope à 1 unité → imposée, ignore le choix', () => {
    expect(resolveScopedUnite(['u1'], null)).toBe('u1');
    expect(resolveScopedUnite(['u1'], 'u9')).toBe('u1');
  });
  it('scope à N → un choix valide parmi les siennes', () => {
    expect(resolveScopedUnite(['u1', 'u2'], 'u2')).toBe('u2');
  });
  it('scope à N + choix hors périmètre → erreur (pas de fuite)', () => {
    expect(() => resolveScopedUnite(['u1', 'u2'], 'u9')).toThrow(ScopeUniteError);
    expect(() => resolveScopedUnite(['u1', 'u2'], null)).toThrow(/choisis une unité/i);
  });
});
