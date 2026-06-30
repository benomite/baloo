// @vitest-environment jsdom

// Contrat InlineText : clic → input ; Entrée/blur valident (si changé et non
// vide), Échap annule, vide ou inchangé n'appellent jamais onSave (pas de
// titre vide — cf. garde service updateEcritureField).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InlineText } from '../inline-text';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function setup(onSave = vi.fn().mockResolvedValue({ ok: true })) {
  render(<InlineText value="Libellé brut" display={<span>Libellé brut</span>} onSave={onSave} />);
  fireEvent.click(screen.getByText('Libellé brut')); // passe en édition
  return { onSave, input: screen.getByRole('textbox') as HTMLInputElement };
}

describe('InlineText', () => {
  afterEach(cleanup);

  it('Entrée avec une nouvelle valeur (trim) appelle onSave', async () => {
    const { onSave, input } = setup();
    fireEvent.change(input, { target: { value: '  Tentes Décathlon  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Tentes Décathlon'));
  });

  it('Entrée avec une valeur vide n’appelle pas onSave', async () => {
    const { onSave, input } = setup();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Entrée avec la valeur inchangée n’appelle pas onSave', async () => {
    const { onSave, input } = setup();
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Échap annule sans appeler onSave', async () => {
    const { onSave, input } = setup();
    fireEvent.change(input, { target: { value: 'Autre' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 0));
    expect(onSave).not.toHaveBeenCalled();
  });
});
