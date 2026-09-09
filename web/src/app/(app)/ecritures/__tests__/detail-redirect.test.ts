// La route /ecritures/[id] n'est plus qu'une redirection vers la liste avec
// la ligne ouverte. Elle doit reporter la query string : les actions serveur
// (rattachement d'un dépôt, partage de justif…) signalent leurs échecs par
// `redirect('/ecritures/<id>?error=…')`. Sans report, succès et échec
// atterrissent au même endroit sans message — cas terrain 2026-09-09 :
// dépôt « Voiture de location » réputé rattaché, resté dans la file.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

const { default: EcritureDetailRedirect } = await import('../[id]/page');

describe('redirection /ecritures/[id]', () => {
  beforeEach(() => redirect.mockClear());

  it('ouvre la ligne dans la liste', async () => {
    await EcritureDetailRedirect({ params: Promise.resolve({ id: 'ECR-2026-607' }) });
    expect(redirect).toHaveBeenCalledWith('/ecritures?open=ECR-2026-607');
  });

  it('reporte le message d’erreur d’une action serveur', async () => {
    await EcritureDetailRedirect({
      params: Promise.resolve({ id: 'ECR-2026-607' }),
      searchParams: Promise.resolve({ error: 'Dépôt déjà rattache, impossible de rattacher.' }),
    });
    expect(redirect).toHaveBeenCalledWith(
      '/ecritures?open=ECR-2026-607&error=D%C3%A9p%C3%B4t+d%C3%A9j%C3%A0+rattache%2C+impossible+de+rattacher.',
    );
  });
});
