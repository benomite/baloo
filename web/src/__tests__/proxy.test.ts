import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, config } from '../proxy';
import { buildSessionCookie } from '@/lib/auth/session-mint';

function request(cookie?: string): NextRequest {
  return new NextRequest('https://baloo.example/', {
    headers: cookie ? { cookie } : {},
  });
}

describe('proxy — home publique sur /', () => {
  it('ne tourne que sur la racine', () => {
    expect(config.matcher).toBe('/');
  });

  it('réécrit / vers la présentation sans cookie de session', () => {
    const res = proxy(request());
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://baloo.example/about');
    expect(res.headers.get('x-middleware-next')).toBeNull();
  });

  it('ignore un cookie sans rapport avec la session', () => {
    const res = proxy(request('baloo_welcome_dismissed=1'));
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://baloo.example/about');
  });

  // Les deux noms que pose la connexion (http en dev, https en prod).
  it.each([false, true])('laisse passer vers le dashboard (cookie secure=%s)', (secure) => {
    const { name } = buildSessionCookie('abc', new Date(), secure);
    const res = proxy(request(`${name}=abc`));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
