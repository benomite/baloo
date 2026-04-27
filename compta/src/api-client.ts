// Client HTTP minimaliste pour appeler l'API webapp depuis le serveur MCP
// `baloo-compta`. Chantier 3 (cf. doc/p2-pivot-webapp.md).
//
// Auth : en P1/P2, l'API webapp résout le user via `BALOO_USER_EMAIL` côté
// serveur — on n'a donc pas encore de token à passer. L'env `BALOO_API_TOKEN`
// est prévu mais inutilisé tant que l'auth multi-user n'est pas activée
// (chantier 4).
//
// La base URL vient de `BALOO_API_URL` ; valeur par défaut : http://localhost:3000.

const DEFAULT_BASE = 'http://localhost:3000';

function baseUrl(): string {
  return (process.env.BALOO_API_URL ?? DEFAULT_BASE).replace(/\/$/, '');
}

function authHeader(): Record<string, string> {
  const token = process.env.BALOO_API_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? `API ${status}: ${(body as { error: string }).error}`
        : `API ${status}`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  const url = `${baseUrl()}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...authHeader(),
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readBody(response));
  }
  return readBody(response);
}

function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    search.set(k, typeof v === 'boolean' ? String(v) : String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await request(`${path}${buildQuery(query)}`, { method: 'GET' })) as T;
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await request(path, {
      method: 'POST',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })) as T;
  },
  async patch<T>(path: string, body: unknown): Promise<T> {
    return (await request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })) as T;
  },
  async del<T>(path: string): Promise<T> {
    return (await request(path, { method: 'DELETE' })) as T;
  },
};
