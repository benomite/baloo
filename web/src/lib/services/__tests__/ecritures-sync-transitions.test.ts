import { describe, it, expect } from 'vitest';
import {
  isAllowedSyncTransition,
  canHardDelete,
} from '../ecritures-sync-transitions';

describe('isAllowedSyncTransition', () => {
  it('autorise les transitions de réconciliation', () => {
    expect(isAllowedSyncTransition('pending_sync', 'mirror')).toBe(true);
    expect(isAllowedSyncTransition('pending_sync', 'divergent')).toBe(true);
    expect(isAllowedSyncTransition('mirror', 'supprimee_cw')).toBe(true);
    expect(isAllowedSyncTransition('pending_sync', 'supprimee_cw')).toBe(true);
    expect(isAllowedSyncTransition('draft', 'mirror')).toBe(true);
    expect(isAllowedSyncTransition('supprimee_cw', 'draft')).toBe(true);
    expect(isAllowedSyncTransition('divergent', 'mirror')).toBe(true);
  });

  it('autorise l’identité (no-op idempotent)', () => {
    expect(isAllowedSyncTransition('mirror', 'mirror')).toBe(true);
    expect(isAllowedSyncTransition('supprimee_cw', 'supprimee_cw')).toBe(true);
  });

  it('interdit les transitions hors périmètre', () => {
    expect(isAllowedSyncTransition('mirror', 'draft')).toBe(false);
    expect(isAllowedSyncTransition('draft', 'supprimee_cw')).toBe(false);
    expect(isAllowedSyncTransition('mirror', 'pending_sync')).toBe(false);
    expect(isAllowedSyncTransition('supprimee_cw', 'mirror')).toBe(false);
    expect(isAllowedSyncTransition('pending_cw', 'mirror')).toBe(false);
  });
});

describe('canHardDelete', () => {
  it('autorise draft / supprimee_cw sans pièce', () => {
    expect(canHardDelete('draft', false)).toBe(true);
    expect(canHardDelete('supprimee_cw', false)).toBe(true);
  });

  it('refuse si pièce attachée', () => {
    expect(canHardDelete('draft', true)).toBe(false);
    expect(canHardDelete('supprimee_cw', true)).toBe(false);
  });

  it('refuse les autres statuts', () => {
    expect(canHardDelete('mirror', false)).toBe(false);
    expect(canHardDelete('pending_sync', false)).toBe(false);
    expect(canHardDelete('divergent', false)).toBe(false);
  });
});
