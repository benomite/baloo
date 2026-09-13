import { describe, it, expect, beforeEach } from 'vitest';
import { readStoredSession, writeStoredSession, clearStoredSession } from '../session-store';

describe('session-store par exercice', () => {
  beforeEach(() => {
    clearStoredSession('33');
    clearStoredSession('34');
  });

  it('deux exercices ont des sessions indépendantes', () => {
    writeStoredSession('33', { cookieHeader: 'PHPSESSID=ancien', capturedAt: new Date().toISOString() });
    writeStoredSession('34', { cookieHeader: 'PHPSESSID=nouveau', capturedAt: new Date().toISOString() });

    expect(readStoredSession('33')?.cookieHeader).toBe('PHPSESSID=ancien');
    expect(readStoredSession('34')?.cookieHeader).toBe('PHPSESSID=nouveau');
  });

  it('vider la session d’un exercice ne touche pas l’autre', () => {
    writeStoredSession('33', { cookieHeader: 'PHPSESSID=ancien', capturedAt: new Date().toISOString() });
    writeStoredSession('34', { cookieHeader: 'PHPSESSID=nouveau', capturedAt: new Date().toISOString() });

    clearStoredSession('34');

    expect(readStoredSession('33')?.cookieHeader).toBe('PHPSESSID=ancien');
    expect(readStoredSession('34')).toBeNull();
  });

  it('une session périmée (plus de 8 h) n’est pas rendue', () => {
    const vieux = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();
    writeStoredSession('33', { cookieHeader: 'PHPSESSID=vieux', capturedAt: vieux });
    expect(readStoredSession('33')).toBeNull();
  });
});
