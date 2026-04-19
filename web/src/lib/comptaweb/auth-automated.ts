import * as cheerio from 'cheerio';
import { CookieJar } from './cookie-jar';

const USER_AGENT = 'baloo-compta/0.1 (+https://github.com/benomite/baloo)';

function isAuthSgdfRedirect(loc: string | null): boolean {
  return !!loc && /auth\.sgdf\.fr\//i.test(loc);
}

function extractCodeFromLocation(location: string, base: URL): URLSearchParams {
  const url = new URL(location, base);
  const params = new URLSearchParams();
  // Cas response_mode=query
  url.searchParams.forEach((v, k) => params.set(k, v));
  // Cas response_mode=fragment
  if (url.hash && url.hash.length > 1) {
    const frag = new URLSearchParams(url.hash.slice(1));
    frag.forEach((v, k) => params.set(k, v));
  }
  return params;
}

async function fetchWithJar(
  jar: CookieJar,
  url: URL,
  init: { method?: string; body?: string; contentType?: string; accept?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: init.accept ?? 'text/html,application/xhtml+xml',
  };
  const cookieHeader = jar.header(url.hostname);
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  if (init.contentType) headers['Content-Type'] = init.contentType;
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    redirect: 'manual',
    headers,
    body: init.body,
  });
  jar.absorb(res.headers, url);
  return res;
}

async function followUntilKeycloakForm(
  jar: CookieJar,
  startUrl: URL,
  maxHops = 8,
): Promise<{ finalUrl: URL; html: string }> {
  let current = startUrl;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetchWithJar(jar, current);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirection sans Location depuis ${current.href}`);
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Étape ${current.href} : HTTP ${res.status}`);
    }
    const html = await res.text();
    return { finalUrl: current, html };
  }
  throw new Error(`Trop de redirections (plus de ${maxHops}) depuis ${startUrl.href}`);
}

async function followPostLoginChain(
  jar: CookieJar,
  startUrl: URL,
  maxHops = 8,
): Promise<{ finalUrl: URL; status: number }> {
  let current = startUrl;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetchWithJar(jar, current);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { finalUrl: current, status: res.status };
      current = new URL(loc, current);
      continue;
    }
    return { finalUrl: current, status: res.status };
  }
  throw new Error(`Trop de redirections post-login depuis ${startUrl.href}`);
}

interface ComptawebOidcParams {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  responseMode: string;
}

function extractOidcParams(html: string): ComptawebOidcParams {
  // Les assignations JS apparaissent parfois deux fois (ancienne version commentée
  // puis version active). On filtre les lignes dont le trim commence par //.
  const activeLines = html
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
  const lastMatch = (re: RegExp): string | null => {
    const matches = Array.from(activeLines.matchAll(re));
    return matches.length ? matches[matches.length - 1][1] : null;
  };
  const clientId = lastMatch(/clientKeycloak\s*=\s*["']([^"']+)["']/g);
  const state = lastMatch(/[?&]state=([A-Za-z0-9-]{8,})/g);
  const nonce = lastMatch(/[?&]nonce=([A-Za-z0-9-]{8,})/g);
  const codeChallenge = lastMatch(/codeChallenge\s*=\s*["']([^"']+)["']/g);
  const redirectUriHost = lastMatch(/paramRedirectUri\s*=\s*["']([^"']+)["']/g);
  if (!clientId || !state || !nonce || !codeChallenge || !redirectUriHost) {
    throw new Error(
      "Impossible d'extraire les paramètres OIDC du HTML de /authentification/keycloak (JS a peut-être changé).",
    );
  }
  return {
    clientId,
    state,
    nonce,
    codeChallenge,
    redirectUri: `https://${redirectUriHost}/`,
    responseMode: 'fragment',
  };
}

export interface AutomatedLoginResult {
  cookieHeader: string;
  capturedAt: string;
}

export async function performAutomatedLogin(
  username: string,
  password: string,
  opts: { baseUrl: string } = { baseUrl: 'https://sgdf.production.sirom.net' },
): Promise<AutomatedLoginResult> {
  if (!username || !password) {
    throw new Error("COMPTAWEB_USERNAME et COMPTAWEB_PASSWORD sont requis pour l'auth automatisée.");
  }

  const jar = new CookieJar();
  const baseUrl = new URL(opts.baseUrl);

  // 1. GET /authentification/keycloak : pose les cookies de session initiaux
  //    (sf_redirect, PHPSESSID) et renvoie une page HTML contenant du JS qui
  //    construit l'URL de redirection Keycloak. Ce JS ne s'exécute pas côté
  //    Node — on extrait les paramètres OIDC (statiques côté Comptaweb) à
  //    la main dans le HTML source.
  const ssoStartUrl = new URL('/authentification/keycloak', baseUrl);
  const ssoRes = await fetchWithJar(jar, ssoStartUrl);
  if (!ssoRes.ok) {
    throw new Error(`GET ${ssoStartUrl.pathname} : HTTP ${ssoRes.status}`);
  }
  const ssoHtml = await ssoRes.text();
  const oidcParams = extractOidcParams(ssoHtml);

  // 2. GET auth.sgdf.fr/auth/... avec les params extraits de Comptaweb, puis
  //    suivre les éventuelles redirections jusqu'au form de login.
  const keycloakEntryUrl = new URL('/auth/realms/sgdf_production/protocol/openid-connect/auth', 'https://auth.sgdf.fr');
  keycloakEntryUrl.searchParams.set('client_id', oidcParams.clientId);
  keycloakEntryUrl.searchParams.set('redirect_uri', oidcParams.redirectUri);
  keycloakEntryUrl.searchParams.set('state', oidcParams.state);
  keycloakEntryUrl.searchParams.set('response_mode', oidcParams.responseMode);
  keycloakEntryUrl.searchParams.set('response_type', 'code');
  keycloakEntryUrl.searchParams.set('scope', 'openid');
  keycloakEntryUrl.searchParams.set('nonce', oidcParams.nonce);
  keycloakEntryUrl.searchParams.set('code_challenge', oidcParams.codeChallenge);
  keycloakEntryUrl.searchParams.set('code_challenge_method', 'S256');

  const startChain = await followUntilKeycloakForm(jar, keycloakEntryUrl);
  if (!/auth\.sgdf\.fr/i.test(startChain.finalUrl.hostname)) {
    throw new Error(
      `Redirection inattendue : on voulait Keycloak, reçu ${startChain.finalUrl.href}.`,
    );
  }

  // 3. Parser le form Keycloak et POST les credentials.
  const $ = cheerio.load(startChain.html);
  const form = $('#kc-form-login');
  if (!form.length) {
    throw new Error("Form #kc-form-login introuvable — MFA activé ou layout Keycloak changé.");
  }
  const rawAction = form.attr('action');
  if (!rawAction) throw new Error('Form Keycloak sans attribut action.');
  const postUrl = new URL(rawAction, startChain.finalUrl);

  const body = new URLSearchParams();
  body.set('username', username);
  body.set('password', password);
  body.set('credentialId', '');

  const loginRes = await fetchWithJar(jar, postUrl, {
    method: 'POST',
    body: body.toString(),
    contentType: 'application/x-www-form-urlencoded',
  });

  if (loginRes.status !== 302 && loginRes.status !== 303) {
    const bodyText = await loginRes.text();
    const hint = cheerio.load(bodyText)('.kc-feedback-text, .pf-c-alert__title, .alert-error').first().text().trim();
    throw new Error(
      `Login Keycloak refusé (HTTP ${loginRes.status})${hint ? ` : "${hint}"` : ''}.`,
    );
  }

  const loginLocation = loginRes.headers.get('location');
  if (!loginLocation) throw new Error('Redirection sans Location après POST login Keycloak.');

  // 3. Extraire le code (response_mode=fragment côté Comptaweb : on parse le
  //    fragment manuellement puisque fetch ne le voit pas).
  const codeParams = extractCodeFromLocation(loginLocation, postUrl);
  const code = codeParams.get('code');
  if (!code) {
    throw new Error(
      `Pas de code dans la redirection post-login (${loginLocation.slice(0, 150)}).`,
    );
  }

  // 4. POST /curl_code_autorisation_keycloak : Comptaweb échange le code
  //    contre un JWT access_token côté backend et le retourne tel quel.
  const exchangeUrl = new URL('/curl_code_autorisation_keycloak', baseUrl);
  const exchangeBody = new URLSearchParams();
  exchangeBody.set('code', code);
  const exchangeRes = await fetchWithJar(jar, exchangeUrl, {
    method: 'POST',
    body: exchangeBody.toString(),
    contentType: 'application/x-www-form-urlencoded',
    accept: 'application/json, text/plain, */*',
  });
  if (!exchangeRes.ok) {
    const txt = await exchangeRes.text();
    throw new Error(
      `Échange de code refusé par Comptaweb (HTTP ${exchangeRes.status}). Body: ${txt.slice(0, 200)}`,
    );
  }
  const jwt = (await exchangeRes.text()).trim().replace(/^"|"$/g, '');
  const codeUtilisateur = extractUserIdFromJwt(jwt);
  if (!codeUtilisateur) {
    throw new Error("Impossible d'extraire l'identifiant utilisateur depuis le JWT retourné par Comptaweb.");
  }

  // 5. POST /login : c'est ce submit qui crée la vraie session PHP. Le champ
  //    _username reçoit le codeUtilisateur extrait du JWT, _password est une
  //    valeur littérale utilisée côté Symfony ("sgdf") — le vrai contrôle
  //    d'identité est fait par Keycloak en amont.
  const symfonyLogin = new URL('/login', baseUrl);
  const sfBody = new URLSearchParams();
  sfBody.set('_username', codeUtilisateur);
  sfBody.set('_password', 'sgdf');
  sfBody.set('action', '');
  const sfRes = await fetchWithJar(jar, symfonyLogin, {
    method: 'POST',
    body: sfBody.toString(),
    contentType: 'application/x-www-form-urlencoded',
  });
  if (sfRes.status !== 302 && sfRes.status !== 303) {
    throw new Error(`POST /login n'a pas renvoyé de redirection (HTTP ${sfRes.status}).`);
  }
  const sfLocation = sfRes.headers.get('location');
  if (sfLocation) {
    const follow = await followPostLoginChain(jar, new URL(sfLocation, symfonyLogin));
    if (follow.status >= 400 || /\/login\b/.test(follow.finalUrl.pathname)) {
      throw new Error(
        `Session Comptaweb non créée après /login : final=${follow.finalUrl.href} status=${follow.status}`,
      );
    }
  }

  const cookieHeader = jar.header(baseUrl.hostname);
  if (!cookieHeader) {
    throw new Error("Aucun cookie de session Comptaweb après login.");
  }

  return {
    cookieHeader,
    capturedAt: new Date().toISOString(),
  };
}

function extractUserIdFromJwt(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payloadRaw = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    const candidates = ['codeUtilisateur', 'preferred_username', 'sub', 'email'];
    for (const k of candidates) {
      const v = payload[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  } catch {
    return null;
  }
}
