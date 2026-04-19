import type { ComptawebConfig } from './types.js';

export class ComptawebSessionExpiredError extends Error {
  constructor() {
    super("Session Comptaweb expirée ou invalide (redirection vers /login ou Keycloak).");
    this.name = 'ComptawebSessionExpiredError';
  }
}

export async function fetchHtml(config: ComptawebConfig, path: string): Promise<string> {
  const url = new URL(path, config.baseUrl);
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Cookie: config.cookie,
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'baloo-compta/0.1 (+https://github.com/benomite/baloo)',
    },
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? '';
    if (/auth\.sgdf\.fr|openid-connect|\/login\b/.test(location)) {
      throw new ComptawebSessionExpiredError();
    }
    throw new Error(`Redirection inattendue ${response.status} vers ${location}`);
  }

  if (!response.ok) {
    throw new Error(`GET ${path} a échoué : HTTP ${response.status}`);
  }

  return response.text();
}
