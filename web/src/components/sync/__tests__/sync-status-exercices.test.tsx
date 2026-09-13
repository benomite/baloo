// @vitest-environment jsdom

// Affichage des exercices couverts dans <SyncStatusButton> (ADR-039).
//
// Les deux cas sont complémentaires et se contrôlent l'un l'autre : le premier
// exige le suffixe quand deux exercices sont couverts, le second l'interdit
// quand il n'y en a qu'un. Un affichage devenu systématique casse le second ;
// un affichage supprimé casse le premier.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SyncStatusButton } from '../sync-status-button';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function mockStatus(exercices: string | null): void {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      group_id: 'g1',
      last_run: {
        id: 'SYNC-2026-320',
        group_id: 'g1',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        finished_at: new Date().toISOString(),
        status: 'ok',
        trigger: 'mcp',
        promoted_to_mirror: 0,
        new_drafts: 0,
        updated_drafts: 0,
        divergent_detected: 0,
        error_message: null,
        duration_ms: 1000,
        remaining: 0,
        exercices,
      },
      is_running: false,
      stale: false,
      throttle_until: null,
    }),
  })) as unknown as typeof fetch;
}

describe('<SyncStatusButton> — exercices couverts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('nomme les deux exercices en période de clôture', async () => {
    mockStatus('2026-2027,2025-2026');
    render(<SyncStatusButton />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /26\/27 \+ 25\/26/ })).toBeTruthy();
    });
  });

  it("ne dit rien quand un seul exercice est couvert — onze mois sur douze", async () => {
    mockStatus('2026-2027');
    render(<SyncStatusButton />);
    const bouton = await screen.findByRole('button', { name: /Synced/ });
    expect(bouton.textContent).not.toMatch(/26\/27/);
  });

  it('ne dit rien pour un run antérieur à ADR-039 (colonne vide)', async () => {
    mockStatus(null);
    render(<SyncStatusButton />);
    const bouton = await screen.findByRole('button', { name: /Synced/ });
    expect(bouton.textContent).not.toMatch(/\d{2}\/\d{2}/);
  });
});
