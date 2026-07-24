// @vitest-environment jsdom
//
// Garde d'envoi côté formulaire : le cumul des NOUVEAUX fichiers (justifs +
// RIB) est plafonné avant submit pour éviter le 413 edge Vercel (~4,5 MB),
// qui court-circuiterait la server action et ne laisserait qu'un message
// opaque. On vérifie le CÂBLAGE (message + bouton désactivé), la logique de
// seuil étant couverte par le test pur de `validateUploadTotal`.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RemboursementForm } from '../remboursement-form';

// L'uploader multi-fichiers utilise DataTransfer (indispo en jsdom) et n'est
// pas le chemin sous test ici : on le neutralise en stub.
vi.mock('@/components/ui/file-multi-uploader', () => ({
  FileMultiUploader: () => <div data-testid="justifs-uploader" />,
}));

afterEach(cleanup);

const baseProps = {
  action: vi.fn(async () => null),
  unites: [],
  today: '2026-07-24',
  defaultIdentity: { prenom: 'Flo', nom: 'Mersch', email: 'flo@example.org' },
  tauxKmMillicents: 354,
};

function ribInput(): HTMLInputElement {
  return document.querySelector('input[name="rib_file"]') as HTMLInputElement;
}
function submitBtn(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Envoyer la demande/i }) as HTMLButtonElement;
}
function bigFile(mo: number): File {
  return new File([new Uint8Array(mo * 1024 * 1024)], 'facture.jpg', { type: 'image/jpeg' });
}

describe('RemboursementForm — garde de taille d’envoi', () => {
  it('un RIB sous la limite laisse le submit actif, sans message', () => {
    render(<RemboursementForm {...baseProps} />);
    fireEvent.change(ribInput(), { target: { files: [bigFile(1)] } });
    expect(submitBtn().disabled).toBe(false);
    expect(screen.queryByText(/trop volumineuses/i)).toBeNull();
  });

  it('un RIB au-dessus de la limite affiche le message et désactive le submit', () => {
    render(<RemboursementForm {...baseProps} />);
    fireEvent.change(ribInput(), { target: { files: [bigFile(6)] } });
    expect(screen.getByText(/trop volumineuses/i)).toBeTruthy();
    expect(submitBtn().disabled).toBe(true);
  });
});
