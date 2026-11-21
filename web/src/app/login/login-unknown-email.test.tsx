import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

const signInMock = vi.fn();

vi.mock('@/lib/auth/auth', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  auth: async () => null,
}));
vi.mock('@/lib/db', () => ({
  getDb: () => ({ prepare: () => ({ run: async () => ({}), get: async () => undefined }) }),
}));
vi.mock('@/lib/auth/login-codes', () => ({ verifyLoginCode: vi.fn() }));
vi.mock('@/lib/auth/session-mint', () => ({ createDbSession: vi.fn(), buildSessionCookie: vi.fn() }));
vi.mock('@/lib/auth/invite-links', () => ({ markUserConnected: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    const err = new Error('NEXT_REDIRECT') as Error & { digest: string; url: string };
    err.digest = `NEXT_REDIRECT;replace;${url};307;`;
    err.url = url;
    throw err;
  },
}));

import LoginPage from './page';

type Action = (formData: FormData) => Promise<void>;

function findAction(node: unknown): Action | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findAction(n);
      if (found) return found;
    }
    return null;
  }
  const props = (node as ReactElement<Record<string, unknown>>).props;
  if (!props) return null;
  if (typeof props.action === 'function') return props.action as Action;
  return findAction(props.children);
}

async function renderPage(search: Record<string, string>): Promise<string> {
  const el = await LoginPage({ searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(el as ReactElement);
}

// Soumet le formulaire d'email et renvoie l'URL de redirection de l'action.
async function submitEmail(email: string): Promise<string> {
  const el = await LoginPage({ searchParams: Promise.resolve({}) });
  const action = findAction(el);
  if (!action) throw new Error('action du formulaire introuvable');
  const fd = new FormData();
  fd.set('email', email);
  try {
    await action(fd);
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return url;
    throw err;
  }
  throw new Error("aucune redirection renvoyée par l'action");
}

function searchOf(url: string): Record<string, string> {
  const u = new URL(url, 'http://localhost');
  return Object.fromEntries(u.searchParams.entries());
}

const CODE_SENT = /On a envoyé un mail/;

describe('login — email inconnu, base saine', () => {
  beforeEach(() => {
    signInMock.mockReset();
    signInMock.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  // brigade:guard
  it('renvoie le même résultat neutre « code envoyé » qu’un email connu, sans log d’erreur', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const known = await submitEmail('connu@example.fr');
    const unknown = await submitEmail('inconnu@example.fr');
    const strip = (u: string) => u.replace(/email=[^&]*/, 'email=X');
    expect(strip(unknown)).toBe(strip(known));
    const html = await renderPage(searchOf(unknown));
    expect(html).toMatch(CODE_SENT);
    expect(html).not.toMatch(/indisponible/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
