import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { LibsqlError } from '@libsql/client';

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

function logged(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls
    .flat()
    .map((a: unknown) =>
      a instanceof Error ? `${a.name} ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a),
    )
    .join('\n');
}

// Référence au rendu pour garder l'import utilisé si l'action change de forme.
void renderToStaticMarkup;

describe('login — erreur d’infrastructure (log serveur)', () => {
  beforeEach(() => {
    signInMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('une LibsqlError émet un log d’erreur serveur avec préfixe stable, nom et message de l’erreur', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    signInMock.mockRejectedValue(new LibsqlError('SQLITE_ERROR: no such table: users', 'SQLITE_ERROR'));
    await submitEmail('tresorier@example.fr');
    const out = logged(spy);
    expect(out).toMatch(/\[auth\][^\n]*(indisponible|unavailable|infra)/i);
    expect(out).toContain('LibsqlError');
    expect(out).toContain('no such table: users');
  });
});
