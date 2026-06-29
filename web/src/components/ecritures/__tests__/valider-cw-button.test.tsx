// @vitest-environment jsdom

// Contrat du bouton « Valider » d'une écriture draft. Depuis 2026-06-29 il est
// purement présentational : pas de window.confirm (le trésorier valide en
// série), pas d'appel direct à l'action — il délègue à `onValidate`, et c'est
// le parent (EcrituresInfiniteList) qui verrouille la ligne puis la retire.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ValiderCwButton } from '../valider-cw-button';

describe('ValiderCwButton', () => {
  afterEach(cleanup);

  it('appelle onValidate au clic', () => {
    const onValidate = vi.fn();
    render(<ValiderCwButton onValidate={onValidate} />);
    fireEvent.click(screen.getByText('Valider'));
    expect(onValidate).toHaveBeenCalledTimes(1);
  });

  it('ne déclenche pas window.confirm (validation en série)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<ValiderCwButton onValidate={vi.fn()} />);
    fireEvent.click(screen.getByText('Valider'));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('est désactivé et n’appelle pas onValidate quand incomplet', () => {
    const onValidate = vi.fn();
    render(<ValiderCwButton disabled missing={['catégorie']} onValidate={onValidate} />);
    const btn = screen.getByText('Valider') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onValidate).not.toHaveBeenCalled();
  });
});
