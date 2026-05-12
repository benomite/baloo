# MCP HTTP + OAuth 2.0 — Phases 1-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Livrer un OAuth Authorization Server complet (Phase 1) + une route MCP HTTP minimale exposant 3 tools de démo (Phase 2), afin que toi puisses brancher Claude Desktop sur `baloo.benomite.com` via OAuth flow, sans coder de config locale ni installer Node.js. Phase 3 (port complet 60+ tools) et Phase 4 (suppression compta/) seront des plans séparés livrés ensuite.

**Architecture :** OAuth Authorization Server custom (RFC 6749/7591/7636/8414/9728) dans la webapp Next.js 16, coexiste avec NextAuth pour la session web. Stockage hashé en BDD libsql (3 tables `oauth_*`). Route `/api/mcp` utilise `WebStandardStreamableHTTPServerTransport` du SDK MCP 1.29.0 (Web Standard Request/Response). Auth Bearer token OAuth, tools appellent directement les services métier.

**Tech Stack :** Next.js 16 (App Router, route handlers, server components, server actions), `@auth/core` 5 (NextAuth pour session web), `@modelcontextprotocol/sdk` 1.29.0, libsql/Turso, zod, vitest. Aucune nouvelle dépendance majeure.

**Spec source :** [`doc/specs/2026-05-12-mcp-http-oauth-design.md`](../specs/2026-05-12-mcp-http-oauth-design.md)

**Tests :** Modules purs OAuth (PKCE, tokens) testés en vitest. Reste (routes, services BDD-coupled, UI) = vérification manuelle via curl + Claude Desktop, cohérent avec la convention projet.

---

## File Structure

**Créés :**

- `web/src/lib/oauth/pkce.ts` — fonctions pures PKCE S256
- `web/src/lib/oauth/pkce.test.ts` — tests vitest
- `web/src/lib/oauth/tokens.ts` — génération + hash des tokens (codes et access tokens)
- `web/src/lib/oauth/tokens.test.ts` — tests vitest
- `web/src/lib/services/oauth-clients.ts` — CRUD `oauth_clients`
- `web/src/lib/services/oauth-codes.ts` — issue/consume authorization codes
- `web/src/lib/services/oauth-access-tokens.ts` — issue/verify/revoke/list access tokens
- `web/src/app/.well-known/oauth-authorization-server/route.ts` — metadata RFC 8414
- `web/src/app/.well-known/oauth-protected-resource/route.ts` — metadata RFC 9728
- `web/src/app/oauth/register/route.ts` — Dynamic Client Registration (RFC 7591)
- `web/src/app/oauth/authorize/page.tsx` — page consentement
- `web/src/app/oauth/authorize/actions.ts` — server action pour autoriser
- `web/src/app/oauth/token/route.ts` — exchange code → token (RFC 6749 §4.1.3)
- `web/src/app/oauth/revoke/route.ts` — révocation (RFC 7009)
- `web/src/app/(app)/moi/connexions/page.tsx` — liste + révocation des tokens
- `web/src/app/(app)/moi/connexions/actions.ts` — server action de révocation
- `web/src/lib/mcp/auth.ts` — `verifyOauthAccessToken(rawToken)` → contexte
- `web/src/lib/mcp/register-all.ts` — agrège les tools à enregistrer (V1 : 3 tools)
- `web/src/lib/mcp/tools/overview.ts` — tool `vue_ensemble`
- `web/src/lib/mcp/tools/ecritures.ts` — tool `list_ecritures` (V1, le minimal)
- `web/src/lib/mcp/tools/recherche.ts` — tool `recherche`
- `web/src/app/api/mcp/route.ts` — handler MCP Streamable HTTP

**Modifiés :**

- `web/src/lib/db/business-schema.ts` — ajout des 3 tables `oauth_*`

**Hors scope (autres plans) :**

- Port des 57 autres tools (Phase 3)
- Suppression de `compta/` (Phase 4)
- Refresh tokens, scopes granulaires, admin panel (V2+)

---

## Phase A — OAuth Authorization Server (Tasks 1-12)

### Task 1 — Tables BDD `oauth_*`

**Files :**
- Modify: `web/src/lib/db/business-schema.ts` (ajouter à la fin du template literal SQL)

- [ ] **Step 1 — Ajouter les 3 tables**

Repérer dans `web/src/lib/db/business-schema.ts` la fin du template literal SQL (juste avant la backtick fermante). Ajouter :

```sql
-- OAuth 2.0 Authorization Server (RFC 6749 + PKCE) — cf. spec
-- 2026-05-12-mcp-http-oauth-design.md. Tokens hashés en BDD (SHA-256).
-- Pas de CHECK SQL (doctrine ADR-019).

CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id);
```

- [ ] **Step 2 — Vérifier que `ensureBusinessSchema` ne plante pas**

Démarrer le dev server en local :
```bash
cd web && pnpm dev
```
Attendre 10 sec, puis ouvrir `http://localhost:3000` dans un browser. Si la home charge sans erreur, les `CREATE TABLE IF NOT EXISTS` ont passé.

En cas d'erreur : lire les logs Vercel/console pour debugger (cf. piège `business-schema.ts` documenté dans `web/AGENTS.md`).

- [ ] **Step 3 — Commit**

```bash
cd <repo-root>
git add web/src/lib/db/business-schema.ts
git commit -m "$(cat <<'EOF'
feat(db): tables OAuth 2.0 (clients, codes, access tokens)

3 nouvelles tables pour l'Authorization Server MCP HTTP :
- oauth_clients : DCR (Dynamic Client Registration)
- oauth_authorization_codes : codes one-shot avec PKCE
- oauth_access_tokens : tokens 30j, hashes SHA-256

Doctrine projet : pas de CHECK SQL, CREATE TABLE IF NOT EXISTS
(idempotent en prod sur libsql).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 — Module pur PKCE

**Files :**
- Create: `web/src/lib/oauth/pkce.ts`
- Create: `web/src/lib/oauth/pkce.test.ts`

- [ ] **Step 1 — Écrire les tests vitest**

Créer `web/src/lib/oauth/pkce.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { computeS256Challenge, verifyS256Pkce } from './pkce';

describe('computeS256Challenge', () => {
  it('retourne le hash SHA-256 base64url du verifier (vecteur RFC 7636)', () => {
    // Vecteur officiel de la RFC 7636 §B.1.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(computeS256Challenge(verifier)).toBe(expected);
  });

  it('produit toujours du base64url (pas de + / =)', () => {
    const challenge = computeS256Challenge('any-verifier-with-padding-chars');
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it('est déterministe', () => {
    const v = 'abcdef123456';
    expect(computeS256Challenge(v)).toBe(computeS256Challenge(v));
  });
});

describe('verifyS256Pkce', () => {
  it('retourne true quand SHA256(verifier) == challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(verifyS256Pkce(verifier, challenge)).toBe(true);
  });

  it('retourne false quand verifier ne matche pas', () => {
    expect(verifyS256Pkce('wrong-verifier', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
  });
});
```

- [ ] **Step 2 — Lancer les tests pour voir qu'ils fail**

```bash
cd web && pnpm test web/src/lib/oauth/pkce.test.ts
```
Attendu : `FAIL` avec "Cannot find module './pkce'".

- [ ] **Step 3 — Implémenter pkce.ts**

Créer `web/src/lib/oauth/pkce.ts` :

```ts
import { createHash } from 'crypto';

// PKCE (RFC 7636) avec méthode S256 uniquement (plain non supporté).
// Le verifier est généré côté client (Claude Desktop) ; le challenge =
// base64url(SHA-256(verifier)) est envoyé au /authorize. Lors du POST
// /token, le client envoie le verifier ; le serveur recalcule le
// challenge et compare.

export function computeS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function verifyS256Pkce(verifier: string, expectedChallenge: string): boolean {
  return computeS256Challenge(verifier) === expectedChallenge;
}
```

- [ ] **Step 4 — Lancer les tests, ils doivent passer**

```bash
cd web && pnpm test web/src/lib/oauth/pkce.test.ts
```
Attendu : `PASS` 4 tests.

- [ ] **Step 5 — Commit**

```bash
cd <repo-root>
git add web/src/lib/oauth/pkce.ts web/src/lib/oauth/pkce.test.ts
git commit -m "$(cat <<'EOF'
feat(oauth): module pur PKCE S256 (RFC 7636)

computeS256Challenge + verifyS256Pkce, testes contre le vecteur
officiel de la RFC. Brique de base pour le flow Authorization Code
+ PKCE de Claude Desktop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 — Module pur tokens

**Files :**
- Create: `web/src/lib/oauth/tokens.ts`
- Create: `web/src/lib/oauth/tokens.test.ts`

- [ ] **Step 1 — Écrire les tests**

Créer `web/src/lib/oauth/tokens.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  generateAuthorizationCode,
  generateAccessToken,
  hashOauthToken,
} from './tokens';

describe('generateAuthorizationCode', () => {
  it('a le préfixe boc_ et est base64url', () => {
    const { plain } = generateAuthorizationCode();
    expect(plain.startsWith('boc_')).toBe(true);
    expect(plain.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('plain et hash sont cohérents (hashOauthToken(plain) === hash)', () => {
    const { plain, hash } = generateAuthorizationCode();
    expect(hashOauthToken(plain)).toBe(hash);
  });

  it('produit des codes uniques (collision improbable sur 100 itérations)', () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) codes.add(generateAuthorizationCode().plain);
    expect(codes.size).toBe(100);
  });
});

describe('generateAccessToken', () => {
  it('a le préfixe boa_', () => {
    const { plain } = generateAccessToken();
    expect(plain.startsWith('boa_')).toBe(true);
  });

  it('hash matche', () => {
    const { plain, hash } = generateAccessToken();
    expect(hashOauthToken(plain)).toBe(hash);
  });
});

describe('hashOauthToken', () => {
  it('retourne le SHA-256 hex (64 chars)', () => {
    const hash = hashOauthToken('boa_test');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('est déterministe', () => {
    expect(hashOauthToken('xxx')).toBe(hashOauthToken('xxx'));
  });
});
```

- [ ] **Step 2 — Test fail attendu**

```bash
cd web && pnpm test web/src/lib/oauth/tokens.test.ts
```
Attendu : FAIL "Cannot find module './tokens'".

- [ ] **Step 3 — Implémenter tokens.ts**

Créer `web/src/lib/oauth/tokens.ts` :

```ts
import { createHash, randomBytes } from 'crypto';

// Tokens OAuth :
//   - Authorization code (boc_*) : éphémère (~2 min), single-use
//   - Access token (boa_*) : 30 jours
// Tous deux : 32 bytes aléatoires en base64url. Stockage en BDD =
// SHA-256 hex (cf. doctrine api_tokens existante).

const CODE_PREFIX = 'boc_';
const ACCESS_TOKEN_PREFIX = 'boa_';

export interface GeneratedToken {
  plain: string;
  hash: string;
}

function genToken(prefix: string): GeneratedToken {
  const plain = prefix + randomBytes(32).toString('base64url');
  return { plain, hash: hashOauthToken(plain) };
}

export function generateAuthorizationCode(): GeneratedToken {
  return genToken(CODE_PREFIX);
}

export function generateAccessToken(): GeneratedToken {
  return genToken(ACCESS_TOKEN_PREFIX);
}

export function hashOauthToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
```

- [ ] **Step 4 — Tests pass**

```bash
cd web && pnpm test web/src/lib/oauth/tokens.test.ts
```
Attendu : PASS.

- [ ] **Step 5 — Commit**

```bash
git add web/src/lib/oauth/tokens.ts web/src/lib/oauth/tokens.test.ts
git commit -m "$(cat <<'EOF'
feat(oauth): generation et hashage des tokens (codes + access)

generateAuthorizationCode (boc_), generateAccessToken (boa_),
hashOauthToken (SHA-256 hex). Tokens 32 bytes aleatoires en base64url.
Pattern coherent avec api_tokens existant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4 — Service `oauth-clients`

**Files :**
- Create: `web/src/lib/services/oauth-clients.ts`

- [ ] **Step 1 — Créer le service**

Créer `web/src/lib/services/oauth-clients.ts` :

```ts
import { randomBytes } from 'crypto';
import { getDb } from '../db';

export interface OauthClient {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
  last_used_at: string | null;
}

interface OauthClientRow {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string;
  created_at: string;
  last_used_at: string | null;
}

function rowToClient(row: OauthClientRow): OauthClient {
  return {
    ...row,
    redirect_uris: JSON.parse(row.redirect_uris) as string[],
  };
}

export interface RegisterClientInput {
  client_name: string;
  redirect_uris: string[];
}

export async function registerClient(input: RegisterClientInput): Promise<OauthClient> {
  const id = `cli_${randomBytes(8).toString('hex')}`;
  const client_id = randomBytes(16).toString('base64url');
  await getDb()
    .prepare(
      `INSERT INTO oauth_clients (id, client_id, client_name, redirect_uris)
       VALUES (?, ?, ?, ?)`,
    )
    .run(id, client_id, input.client_name, JSON.stringify(input.redirect_uris));
  return {
    id,
    client_id,
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
}

export async function findClientByClientId(clientId: string): Promise<OauthClient | null> {
  const row = await getDb()
    .prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`)
    .get<OauthClientRow>(clientId);
  return row ? rowToClient(row) : null;
}

export function validateRedirectUri(client: OauthClient, candidate: string): boolean {
  return client.redirect_uris.includes(candidate);
}

export async function touchLastUsed(clientId: string): Promise<void> {
  await getDb()
    .prepare(`UPDATE oauth_clients SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE client_id = ?`)
    .run(clientId);
}
```

- [ ] **Step 2 — Vérifier compile**

```bash
cd web && pnpm lint 2>&1 | grep "oauth-clients" | head -5
```
Attendu : pas d'erreur.

- [ ] **Step 3 — Commit**

```bash
git add web/src/lib/services/oauth-clients.ts
git commit -m "$(cat <<'EOF'
feat(oauth): service oauth-clients (DCR)

registerClient cree un client OAuth via Dynamic Client Registration
(RFC 7591), findClientByClientId pour lookup, validateRedirectUri
valide la cible du redirect. touchLastUsed pour l'audit log.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5 — Service `oauth-codes`

**Files :**
- Create: `web/src/lib/services/oauth-codes.ts`

- [ ] **Step 1 — Créer le service**

Créer `web/src/lib/services/oauth-codes.ts` :

```ts
import { getDb } from '../db';
import { generateAuthorizationCode, hashOauthToken } from '../oauth/tokens';
import { verifyS256Pkce } from '../oauth/pkce';

const CODE_TTL_SECONDS = 120;

export interface IssueCodeInput {
  client_id: string;
  user_id: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string; // 'S256'
  redirect_uri: string;
}

export async function issueAuthorizationCode(input: IssueCodeInput): Promise<string> {
  const { plain, hash } = generateAuthorizationCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
  await getDb()
    .prepare(
      `INSERT INTO oauth_authorization_codes
       (code_hash, client_id, user_id, scope, code_challenge,
        code_challenge_method, redirect_uri, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hash,
      input.client_id,
      input.user_id,
      input.scope,
      input.code_challenge,
      input.code_challenge_method,
      input.redirect_uri,
      expiresAt,
    );
  return plain;
}

export class AuthorizationCodeError extends Error {
  constructor(public reason: 'invalid_grant' | 'invalid_request') {
    super(`OAuth code rejected: ${reason}`);
  }
}

export interface ConsumeCodeInput {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier: string;
}

export interface ConsumeCodeResult {
  user_id: string;
  scope: string;
}

export async function consumeAuthorizationCode(input: ConsumeCodeInput): Promise<ConsumeCodeResult> {
  const hash = hashOauthToken(input.code);
  const db = getDb();
  const row = await db
    .prepare(
      `SELECT user_id, scope, client_id, redirect_uri, code_challenge,
              code_challenge_method, expires_at, used_at
       FROM oauth_authorization_codes WHERE code_hash = ?`,
    )
    .get<{
      user_id: string;
      scope: string;
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      code_challenge_method: string;
      expires_at: string;
      used_at: string | null;
    }>(hash);

  if (!row) throw new AuthorizationCodeError('invalid_grant');
  if (row.used_at) throw new AuthorizationCodeError('invalid_grant');
  if (new Date(row.expires_at).getTime() < Date.now())
    throw new AuthorizationCodeError('invalid_grant');
  if (row.client_id !== input.client_id) throw new AuthorizationCodeError('invalid_grant');
  if (row.redirect_uri !== input.redirect_uri) throw new AuthorizationCodeError('invalid_grant');
  if (row.code_challenge_method !== 'S256')
    throw new AuthorizationCodeError('invalid_request');
  if (!verifyS256Pkce(input.code_verifier, row.code_challenge))
    throw new AuthorizationCodeError('invalid_grant');

  // Single-use : marquer used_at avant retour.
  await db
    .prepare(
      `UPDATE oauth_authorization_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE code_hash = ? AND used_at IS NULL`,
    )
    .run(hash);

  return { user_id: row.user_id, scope: row.scope };
}
```

- [ ] **Step 2 — Compile check**

```bash
cd web && pnpm lint 2>&1 | grep "oauth-codes" | head -5
```

- [ ] **Step 3 — Commit**

```bash
git add web/src/lib/services/oauth-codes.ts
git commit -m "$(cat <<'EOF'
feat(oauth): service oauth-codes (issue + consume + PKCE check)

issueAuthorizationCode emet un code one-shot 2min avec challenge PKCE
stocke. consumeAuthorizationCode verifie : non-utilise + non-expire +
match client_id + match redirect_uri + PKCE valide. AuthorizationCodeError
typee pour mapping HTTP 400 invalid_grant / invalid_request.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6 — Service `oauth-access-tokens`

**Files :**
- Create: `web/src/lib/services/oauth-access-tokens.ts`

- [ ] **Step 1 — Créer le service**

Créer `web/src/lib/services/oauth-access-tokens.ts` :

```ts
import { getDb } from '../db';
import { generateAccessToken, hashOauthToken } from '../oauth/tokens';

const ACCESS_TOKEN_TTL_DAYS = 30;

export interface IssuedAccessToken {
  plain: string;
  expires_at: string;
}

export async function issueAccessToken(opts: {
  client_id: string;
  user_id: string;
  scope: string;
}): Promise<IssuedAccessToken> {
  const { plain, hash } = generateAccessToken();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_DAYS * 86400 * 1000).toISOString();
  await getDb()
    .prepare(
      `INSERT INTO oauth_access_tokens (token_hash, client_id, user_id, scope, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hash, opts.client_id, opts.user_id, opts.scope, expiresAt);
  return { plain, expires_at: expiresAt };
}

export interface AccessTokenContext {
  user_id: string;
  scope: string;
  client_id: string;
}

export async function verifyAccessToken(plain: string): Promise<AccessTokenContext | null> {
  const hash = hashOauthToken(plain);
  const db = getDb();
  const row = await db
    .prepare(
      `SELECT user_id, scope, client_id, expires_at, revoked_at
       FROM oauth_access_tokens WHERE token_hash = ?`,
    )
    .get<{
      user_id: string;
      scope: string;
      client_id: string;
      expires_at: string;
      revoked_at: string | null;
    }>(hash);

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  // Fire-and-forget : on n'attend pas l'update pour ne pas ralentir la verif.
  db.prepare(
    `UPDATE oauth_access_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE token_hash = ?`,
  ).run(hash).catch(() => {});

  return { user_id: row.user_id, scope: row.scope, client_id: row.client_id };
}

export async function revokeAccessToken(plain: string): Promise<void> {
  const hash = hashOauthToken(plain);
  await getDb()
    .prepare(
      `UPDATE oauth_access_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(hash);
}

export interface UserAccessToken {
  token_hash: string;
  client_id: string;
  client_name: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}

export async function listActiveTokensForUser(userId: string): Promise<UserAccessToken[]> {
  const rows = await getDb()
    .prepare(
      `SELECT t.token_hash, t.client_id, c.client_name, t.scope,
              t.created_at, t.last_used_at, t.expires_at
       FROM oauth_access_tokens t
       JOIN oauth_clients c ON c.client_id = t.client_id
       WHERE t.user_id = ?
         AND t.revoked_at IS NULL
         AND t.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       ORDER BY t.created_at DESC`,
    )
    .all<UserAccessToken>(userId);
  return rows;
}

export async function revokeTokenByHash(userId: string, tokenHash: string): Promise<void> {
  await getDb()
    .prepare(
      `UPDATE oauth_access_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(tokenHash, userId);
}
```

- [ ] **Step 2 — Compile check**

```bash
cd web && pnpm lint 2>&1 | grep "oauth-access-tokens" | head -5
```

- [ ] **Step 3 — Commit**

```bash
git add web/src/lib/services/oauth-access-tokens.ts
git commit -m "$(cat <<'EOF'
feat(oauth): service oauth-access-tokens (issue/verify/revoke/list)

issueAccessToken emet un token 30j, verifyAccessToken check
expiration + revocation + update last_used_at (fire-and-forget),
revokeAccessToken pour revocation manuelle, listActiveTokensForUser
+ revokeTokenByHash pour la page /moi/connexions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7 — Routes `.well-known/oauth-*`

**Files :**
- Create: `web/src/app/.well-known/oauth-authorization-server/route.ts`
- Create: `web/src/app/.well-known/oauth-protected-resource/route.ts`

- [ ] **Step 1 — Helper baseUrl**

D'abord vérifier s'il existe un helper qui retourne l'URL publique de la webapp (ex: `getBaseUrl()` ou similaire). Chercher :

```bash
grep -rn "AUTH_URL\|NEXTAUTH_URL\|baseUrl" &lt;repo-root&gt;/web/src/lib/ 2>/dev/null | head -10
```

S'il existe : l'utiliser. Sinon, écrire inline :
```ts
function getIssuerUrl(): string {
  return process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}
```

- [ ] **Step 2 — Créer route oauth-authorization-server**

Créer `web/src/app/.well-known/oauth-authorization-server/route.ts` :

```ts
function getIssuerUrl(): string {
  return process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

export async function GET() {
  const issuer = getIssuerUrl();
  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      registration_endpoint: `${issuer}/oauth/register`,
      scopes_supported: ['treso'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
```

- [ ] **Step 3 — Créer route oauth-protected-resource**

Créer `web/src/app/.well-known/oauth-protected-resource/route.ts` :

```ts
function getIssuerUrl(): string {
  return process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

export async function GET() {
  const issuer = getIssuerUrl();
  return Response.json(
    {
      resource: `${issuer}/api/mcp`,
      authorization_servers: [issuer],
      scopes_supported: ['treso'],
      bearer_methods_supported: ['header'],
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
```

- [ ] **Step 4 — Tester avec curl en local**

Démarrer le dev server si pas déjà fait :
```bash
cd web && pnpm dev
```

```bash
curl -s http://localhost:3000/.well-known/oauth-authorization-server | jq
curl -s http://localhost:3000/.well-known/oauth-protected-resource | jq
```

Attendu : JSON cohérent avec les schémas RFC 8414 et 9728.

- [ ] **Step 5 — Commit**

```bash
git add web/src/app/.well-known/oauth-authorization-server/route.ts web/src/app/.well-known/oauth-protected-resource/route.ts
git commit -m "$(cat <<'EOF'
feat(oauth): metadata RFC 8414 + RFC 9728 (well-known endpoints)

GET /.well-known/oauth-authorization-server : decouverte de l'AS,
expose endpoints et capacites (S256, code grant, scope treso,
public client = auth method 'none').

GET /.well-known/oauth-protected-resource : pointe vers l'AS depuis
le resource server /api/mcp. Permet a Claude Desktop de redeclencher
l'auth quand un token expire (cf. WWW-Authenticate de /api/mcp).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8 — Route `POST /oauth/register` (DCR)

**Files :**
- Create: `web/src/app/oauth/register/route.ts`

- [ ] **Step 1 — Créer la route**

Créer `web/src/app/oauth/register/route.ts` :

```ts
import { z } from 'zod';
import { registerClient } from '@/lib/services/oauth-clients';

const registerSchema = z
  .object({
    client_name: z.string().min(1).max(100),
    redirect_uris: z.array(z.string().url().or(z.string().regex(/^[a-z][a-z0-9+\-.]*:\/\//i))).min(1),
    token_endpoint_auth_method: z.literal('none').optional(),
    grant_types: z.array(z.literal('authorization_code')).optional(),
    response_types: z.array(z.literal('code')).optional(),
  })
  .strict();

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  const client = await registerClient({
    client_name: parsed.data.client_name,
    redirect_uris: parsed.data.redirect_uris,
  });

  return Response.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201 },
  );
}
```

Note : le schema accepte les URI custom (`claude://`) en plus des URLs HTTPS — Claude Desktop peut utiliser des deep links.

- [ ] **Step 2 — Test curl**

```bash
curl -s -X POST http://localhost:3000/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"client_name":"Test Client","redirect_uris":["http://localhost:33418/callback"]}' | jq
```

Attendu : `201` avec un `client_id` aléatoire.

- [ ] **Step 3 — Commit**

```bash
git add web/src/app/oauth/register/route.ts
git commit -m "$(cat <<'EOF'
feat(oauth): POST /oauth/register (Dynamic Client Registration)

Endpoint public RFC 7591 pour public clients (auth method 'none').
Claude Desktop l'appelle au premier branchement pour s'enregistrer
comme client OAuth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9 — Page + server action `/oauth/authorize`

**Files :**
- Create: `web/src/app/oauth/authorize/page.tsx`
- Create: `web/src/app/oauth/authorize/actions.ts`

- [ ] **Step 1 — Identifier le helper de session NextAuth utilisé dans le projet**

Chercher comment les autres pages récupèrent la session :
```bash
grep -rn "await auth()" &lt;repo-root&gt;/web/src/app/\(app\)/ 2>/dev/null | head -5
```

Attendu : pattern `const session = await auth()` puis `session?.user?.id`. À utiliser dans la page.

- [ ] **Step 2 — Créer la page**

Créer `web/src/app/oauth/authorize/page.tsx` :

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { findClientByClientId, validateRedirectUri } from '@/lib/services/oauth-clients';
import { authorizeAction, denyAction } from './actions';

export const dynamic = 'force-dynamic';

interface SearchParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // Validation des params (avant auth pour donner un message clair en cas d'erreur de config).
  if (params.response_type !== 'code') {
    return <ErrorBlock message="response_type doit être 'code'." />;
  }
  if (!params.client_id) {
    return <ErrorBlock message="client_id manquant." />;
  }
  if (!params.redirect_uri) {
    return <ErrorBlock message="redirect_uri manquant." />;
  }
  if (!params.code_challenge) {
    return <ErrorBlock message="code_challenge manquant (PKCE requis)." />;
  }
  if (params.code_challenge_method !== 'S256') {
    return <ErrorBlock message="code_challenge_method doit être S256." />;
  }
  const scope = params.scope ?? 'treso';
  if (scope !== 'treso') {
    return <ErrorBlock message={`scope inconnu : ${scope}.`} />;
  }

  const client = await findClientByClientId(params.client_id);
  if (!client) {
    return <ErrorBlock message="Client OAuth inconnu." />;
  }
  if (!validateRedirectUri(client, params.redirect_uri)) {
    return <ErrorBlock message="redirect_uri non autorisé pour ce client." />;
  }

  const session = await auth();
  if (!session?.user?.id) {
    const callbackUrl = `/oauth/authorize?${new URLSearchParams(
      params as Record<string, string>,
    ).toString()}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold mb-2">Autoriser {client.client_name}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Cette application demande l'accès à ton compte Baloo (
        <strong>{session.user.email}</strong>).
      </p>

      <div className="rounded border p-4 mb-6">
        <p className="font-medium mb-2">Permissions demandées :</p>
        <ul className="text-sm list-disc pl-5">
          <li>Trésorerie complète (lecture et écriture, selon ton rôle)</li>
        </ul>
      </div>

      <form action={authorizeAction} className="flex gap-2">
        <input type="hidden" name="client_id" value={params.client_id} />
        <input type="hidden" name="redirect_uri" value={params.redirect_uri} />
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="state" value={params.state ?? ''} />
        <input type="hidden" name="code_challenge" value={params.code_challenge} />
        <input type="hidden" name="code_challenge_method" value={params.code_challenge_method} />
        <button type="submit" className="rounded bg-primary text-primary-foreground px-4 py-2">
          Autoriser
        </button>
      </form>
      <form action={denyAction} className="mt-3">
        <input type="hidden" name="redirect_uri" value={params.redirect_uri} />
        <input type="hidden" name="state" value={params.state ?? ''} />
        <button type="submit" className="rounded border px-4 py-2 text-muted-foreground">
          Refuser
        </button>
      </form>
    </main>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold mb-2 text-destructive">Erreur OAuth</h1>
      <p>{message}</p>
    </main>
  );
}
```

- [ ] **Step 3 — Créer le server action**

Créer `web/src/app/oauth/authorize/actions.ts` :

```ts
'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { issueAuthorizationCode } from '@/lib/services/oauth-codes';
import { touchLastUsed } from '@/lib/services/oauth-clients';

export async function authorizeAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const client_id = formData.get('client_id') as string;
  const redirect_uri = formData.get('redirect_uri') as string;
  const scope = formData.get('scope') as string;
  const state = formData.get('state') as string;
  const code_challenge = formData.get('code_challenge') as string;
  const code_challenge_method = formData.get('code_challenge_method') as string;

  const code = await issueAuthorizationCode({
    client_id,
    user_id: session.user.id,
    scope,
    code_challenge,
    code_challenge_method,
    redirect_uri,
  });
  await touchLastUsed(client_id);

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  redirect(url.toString());
}

export async function denyAction(formData: FormData): Promise<void> {
  const redirect_uri = formData.get('redirect_uri') as string;
  const state = formData.get('state') as string;
  const url = new URL(redirect_uri);
  url.searchParams.set('error', 'access_denied');
  if (state) url.searchParams.set('state', state);
  redirect(url.toString());
}
```

- [ ] **Step 4 — Test manuel browser**

Ouvrir dans le browser (en étant déjà logué sur localhost:3000) :
```
http://localhost:3000/oauth/authorize?response_type=code&client_id=<copier d'un register précédent>&redirect_uri=http://localhost:33418/callback&code_challenge=<un challenge S256 quelconque>&code_challenge_method=S256&state=abc
```

Note pour générer un code_challenge de test :
```bash
node -e "console.log(require('crypto').createHash('sha256').update('test-verifier-12345').digest('base64url'))"
```

Attendu : la page de consentement s'affiche, le bouton "Autoriser" redirige vers `http://localhost:33418/callback?code=boc_xxx&state=abc` (404 attendu côté client car pas de callback monté localement, mais l'URL en barre d'adresse doit montrer le code).

- [ ] **Step 5 — Commit**

```bash
git add web/src/app/oauth/authorize/page.tsx web/src/app/oauth/authorize/actions.ts
git commit -m "$(cat <<'EOF'
feat(oauth): page + actions /oauth/authorize (consentement user)

Valide les query params (response_type=code, PKCE S256, scope treso),
verifie le client OAuth + redirect_uri en BDD, exige une session
NextAuth (redirect /login sinon). Affiche le consentement.

Server actions authorizeAction (emet code + redirect avec code+state)
et denyAction (redirect avec error=access_denied).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10 — Route `POST /oauth/token`

**Files :**
- Create: `web/src/app/oauth/token/route.ts`

- [ ] **Step 1 — Créer la route**

Créer `web/src/app/oauth/token/route.ts` :

```ts
import { consumeAuthorizationCode, AuthorizationCodeError } from '@/lib/services/oauth-codes';
import { issueAccessToken } from '@/lib/services/oauth-access-tokens';

export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    const text = await request.text();
    form = new URLSearchParams(text);
  } catch {
    return errorResponse('invalid_request', 'Body invalide.', 400);
  }

  const grant_type = form.get('grant_type');
  const code = form.get('code');
  const redirect_uri = form.get('redirect_uri');
  const client_id = form.get('client_id');
  const code_verifier = form.get('code_verifier');

  if (grant_type !== 'authorization_code') {
    return errorResponse('unsupported_grant_type', 'Seul authorization_code est supporté.', 400);
  }
  if (!code || !redirect_uri || !client_id || !code_verifier) {
    return errorResponse('invalid_request', 'Paramètres manquants.', 400);
  }

  try {
    const { user_id, scope } = await consumeAuthorizationCode({
      code,
      client_id,
      redirect_uri,
      code_verifier,
    });
    const issued = await issueAccessToken({ client_id, user_id, scope });
    const expiresIn = Math.floor(
      (new Date(issued.expires_at).getTime() - Date.now()) / 1000,
    );
    return Response.json(
      {
        access_token: issued.plain,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (err) {
    if (err instanceof AuthorizationCodeError) {
      return errorResponse(err.reason, undefined, 400);
    }
    throw err;
  }
}

function errorResponse(error: string, description: string | undefined, status: number): Response {
  return Response.json(
    description ? { error, error_description: description } : { error },
    { status },
  );
}
```

- [ ] **Step 2 — Test manuel curl**

Le test E2E complet du flow (register → authorize → token) sera fait en Task 16. Pour cette task, juste valider que le handler est appelable avec un code invalide :

```bash
curl -s -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=boc_invalid&redirect_uri=http://x&client_id=cli_invalid&code_verifier=abc" -i
```

Attendu : `400` avec `{"error":"invalid_grant"}`.

- [ ] **Step 3 — Commit**

```bash
git add web/src/app/oauth/token/route.ts
git commit -m "$(cat <<'EOF'
feat(oauth): POST /oauth/token (echange code -> access_token)

Form-encoded body (RFC 6749), grant_type=authorization_code uniquement.
Verifie PKCE + match client_id + match redirect_uri + non-expire +
single-use via service oauth-codes. Emet un access_token 30j.
Cache-Control: no-store (recommandation RFC).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11 — Route `POST /oauth/revoke`

**Files :**
- Create: `web/src/app/oauth/revoke/route.ts`

- [ ] **Step 1 — Créer la route**

Créer `web/src/app/oauth/revoke/route.ts` :

```ts
import { revokeAccessToken } from '@/lib/services/oauth-access-tokens';

export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    const text = await request.text();
    form = new URLSearchParams(text);
  } catch {
    return new Response(null, { status: 200 });
  }

  const token = form.get('token');
  if (!token) {
    // RFC 7009 : 200 même si pas de token (pas de leak d'info).
    return new Response(null, { status: 200 });
  }

  await revokeAccessToken(token);
  return new Response(null, { status: 200 });
}
```

- [ ] **Step 2 — Test curl**

```bash
curl -s -X POST http://localhost:3000/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=boa_inexistant" -i
```

Attendu : `200` (vide).

- [ ] **Step 3 — Commit**

```bash
git add web/src/app/oauth/revoke/route.ts
git commit -m "$(cat <<'EOF'
feat(oauth): POST /oauth/revoke (RFC 7009)

Revocation de token : marque revoked_at en BDD. Retourne 200 meme si
le token n'existe pas (pas de leak d'info, conforme RFC).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12 — Page `/moi/connexions`

**Files :**
- Create: `web/src/app/(app)/moi/connexions/page.tsx`
- Create: `web/src/app/(app)/moi/connexions/actions.ts`

- [ ] **Step 1 — Créer la page**

Créer `web/src/app/(app)/moi/connexions/page.tsx` :

```tsx
import { auth } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';
import { listActiveTokensForUser } from '@/lib/services/oauth-access-tokens';
import { revokeAction } from './actions';

export const dynamic = 'force-dynamic';

function getMcpUrl(): string {
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${base}/api/mcp`;
}

export default async function ConnexionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/moi/connexions');

  const tokens = await listActiveTokensForUser(session.user.id);
  const mcpUrl = getMcpUrl();

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Connexions externes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Apps autorisées à accéder à ton compte via OAuth (notamment Claude Desktop).
        </p>
      </header>

      <section className="rounded border p-4 space-y-2">
        <h2 className="font-medium">Connecter Claude Desktop</h2>
        <p className="text-sm">
          Dans Claude Desktop : Settings → Connectors → Add custom connector → colle
          l'URL ci-dessous. Tu seras renvoyé sur Baloo pour confirmer l'autorisation.
        </p>
        <code className="block bg-muted p-2 rounded font-mono text-sm select-all">{mcpUrl}</code>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Apps autorisées</h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune app autorisée. Quand tu en connectes une, elle apparaîtra ici.
          </p>
        ) : (
          <ul className="divide-y border rounded">
            {tokens.map((t) => (
              <li key={t.token_hash} className="p-3 flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">{t.client_name}</div>
                  <div className="text-muted-foreground">
                    Connectée le {new Date(t.created_at).toLocaleDateString('fr-FR')} ·{' '}
                    Expire le {new Date(t.expires_at).toLocaleDateString('fr-FR')} ·{' '}
                    {t.last_used_at
                      ? `Utilisée le ${new Date(t.last_used_at).toLocaleDateString('fr-FR')}`
                      : 'Jamais utilisée'}
                  </div>
                </div>
                <form action={revokeAction}>
                  <input type="hidden" name="token_hash" value={t.token_hash} />
                  <button
                    type="submit"
                    className="text-sm text-destructive hover:underline"
                  >
                    Révoquer
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2 — Créer le server action**

Créer `web/src/app/(app)/moi/connexions/actions.ts` :

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { revokeTokenByHash } from '@/lib/services/oauth-access-tokens';

export async function revokeAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const tokenHash = formData.get('token_hash');
  if (typeof tokenHash !== 'string' || !tokenHash) return;
  await revokeTokenByHash(session.user.id, tokenHash);
  revalidatePath('/moi/connexions');
}
```

- [ ] **Step 3 — Vérifier visuellement**

Browser : `http://localhost:3000/moi/connexions`. La page doit charger sans erreur (liste vide si aucun token).

- [ ] **Step 4 — Commit**

```bash
git add "web/src/app/(app)/moi/connexions/page.tsx" "web/src/app/(app)/moi/connexions/actions.ts"
git commit -m "$(cat <<'EOF'
feat(moi): page /moi/connexions (gestion tokens OAuth)

Liste les apps OAuth autorisees par l'user (client_name, dates),
permet de revoquer une connexion en un clic. En haut, encart
'Connecter Claude Desktop' avec l'URL /api/mcp a copier.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — MCP route minimale (Tasks 13-16)

### Task 13 — Helper `verifyOauthAccessToken` + contexte MCP

**Files :**
- Create: `web/src/lib/mcp/auth.ts`

- [ ] **Step 1 — Identifier la fonction qui résout user → group_id/role**

Lire `web/src/lib/auth/api-tokens.ts` pour voir comment `ApiTokenContext` est construit à partir d'un user_id. Il y a probablement une fonction qui fait le join `users → groupes`. Sinon, query directe.

```bash
grep -n "groupId\|group_id" &lt;repo-root&gt;/web/src/lib/auth/api-tokens.ts | head -10
```

- [ ] **Step 2 — Créer le helper**

Créer `web/src/lib/mcp/auth.ts` :

```ts
import { getDb } from '../db';
import { verifyAccessToken } from '../services/oauth-access-tokens';

export interface McpContext {
  userId: string;
  groupId: string;
  role: string;
  scopeUniteId: string | null;
  scope: string; // OAuth scope (toujours 'treso' en V1)
  clientId: string;
}

export async function verifyOauthAccessToken(rawToken: string): Promise<McpContext | null> {
  const tokenCtx = await verifyAccessToken(rawToken);
  if (!tokenCtx) return null;

  // Resoudre user → group_id + role + scope_unite_id (meme pattern
  // qu'api-tokens.ts).
  const row = await getDb()
    .prepare(
      `SELECT u.group_id, u.role, u.scope_unite_id
       FROM users u
       WHERE u.id = ?`,
    )
    .get<{ group_id: string; role: string; scope_unite_id: string | null }>(tokenCtx.user_id);

  if (!row) return null;

  return {
    userId: tokenCtx.user_id,
    groupId: row.group_id,
    role: row.role,
    scopeUniteId: row.scope_unite_id,
    scope: tokenCtx.scope,
    clientId: tokenCtx.client_id,
  };
}
```

⚠️ Adapter la query SQL selon la vraie structure de la table `users` (colonnes peuvent être `groupId`/`group_id`, `scope_unite_id`/`scopeUniteId`). Vérifier dans `business-schema.ts` ou `auth/schema.ts`.

- [ ] **Step 3 — Compile check**

```bash
cd web && pnpm lint 2>&1 | grep "mcp/auth" | head -5
```

- [ ] **Step 4 — Commit**

```bash
git add web/src/lib/mcp/auth.ts
git commit -m "$(cat <<'EOF'
feat(mcp): helper verifyOauthAccessToken (Bearer -> McpContext)

Verifie le token OAuth (signature + expiration + revocation via le
service oauth-access-tokens), puis resout le user en BDD pour hydrater
groupId, role, scopeUniteId. Pattern coherent avec ApiTokenContext.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14 — 3 tools MCP (overview, list_ecritures, recherche)

**Files :**
- Create: `web/src/lib/mcp/tools/overview.ts`
- Create: `web/src/lib/mcp/tools/ecritures.ts`
- Create: `web/src/lib/mcp/tools/recherche.ts`
- Create: `web/src/lib/mcp/register-all.ts`

- [ ] **Step 1 — Identifier les signatures des services à appeler**

Vérifier que ces services existent et leurs signatures :

```bash
grep -nE "^export async function (getOverview|listEcritures|recherche|searchAcrossTables)" &lt;repo-root&gt;/web/src/lib/services/overview.ts &lt;repo-root&gt;/web/src/lib/services/ecritures.ts &lt;repo-root&gt;/web/src/lib/services/recherche.ts 2>/dev/null
```

Noter les signatures réelles. Si la fonction est `getOverview(ctx)` ou `getOverview({ groupId, scopeUniteId })` ou autre, adapter en conséquence.

- [ ] **Step 2 — Créer `tools/overview.ts`**

Créer `web/src/lib/mcp/tools/overview.ts` (adapter au service réel) :

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../auth';
import { getOverview } from '@/lib/services/overview';

export function registerOverviewTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'vue_ensemble',
    "Vue d'ensemble de la trésorerie : soldes par compte, écritures récentes, alertes.",
    {},
    async () => {
      const overview = await getOverview({ groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId });
      return { content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }] };
    },
  );
}
```

- [ ] **Step 3 — Créer `tools/ecritures.ts`**

Créer `web/src/lib/mcp/tools/ecritures.ts` (adapter à la signature réelle de `listEcritures`) :

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listEcritures } from '@/lib/services/ecritures';

export function registerEcrituresTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_ecritures',
    "Liste les écritures comptables, filtrables par type, période, mode de paiement.",
    {
      type: z.enum(['depense', 'recette']).optional(),
      date_min: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_max: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (params) => {
      const rows = await listEcritures(
        { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId },
        params,
      );
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );
}
```

- [ ] **Step 4 — Créer `tools/recherche.ts`**

Créer `web/src/lib/mcp/tools/recherche.ts` :

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { recherche } from '@/lib/services/recherche';

export function registerRechercheTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'recherche',
    'Recherche libre dans toutes les tables (écritures, remboursements, abandons, caisse, chèques).',
    {
      q: z.string().min(1).describe('Terme de recherche'),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async (params) => {
      const results = await recherche(
        { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId },
        params,
      );
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );
}
```

- [ ] **Step 5 — Créer `register-all.ts`**

Créer `web/src/lib/mcp/register-all.ts` :

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from './auth';
import { registerOverviewTools } from './tools/overview';
import { registerEcrituresTools } from './tools/ecritures';
import { registerRechercheTools } from './tools/recherche';

export function registerAllTools(server: McpServer, ctx: McpContext): void {
  registerOverviewTools(server, ctx);
  registerEcrituresTools(server, ctx);
  registerRechercheTools(server, ctx);
}
```

- [ ] **Step 6 — Compile check**

```bash
cd web && pnpm lint 2>&1 | grep "mcp/" | head -10
```

Pas d'erreur sur les fichiers touchés. Si l'un des services attend une signature différente (ex: `getOverview(ctx)` sans `scopeUniteId`), adapter.

- [ ] **Step 7 — Commit**

```bash
git add web/src/lib/mcp/tools/ web/src/lib/mcp/register-all.ts
git commit -m "$(cat <<'EOF'
feat(mcp): 3 tools de demo + registerAllTools

vue_ensemble, list_ecritures, recherche. Chaque tool appelle
directement le service correspondant (pas de rebond HTTP).
registerAllTools agrege l'enregistrement pour la route /api/mcp.

V1 minimal : Phase 3 portera les ~57 autres tools depuis compta/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15 — Route `/api/mcp` (Streamable HTTP)

**Files :**
- Create: `web/src/app/api/mcp/route.ts`

- [ ] **Step 1 — Créer la route**

Créer `web/src/app/api/mcp/route.ts` :

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { verifyOauthAccessToken } from '@/lib/mcp/auth';
import { registerAllTools } from '@/lib/mcp/register-all';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function unauthorized(): Response {
  const issuer = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
    },
  });
}

async function handle(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return unauthorized();

  const ctx = await verifyOauthAccessToken(auth.slice(7).trim());
  if (!ctx) return unauthorized();

  const server = new McpServer({ name: 'baloo', version: '1.0.0' });
  registerAllTools(server, ctx);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode (simple)
    enableJsonResponse: true,      // évite SSE pour V1
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  return handle(request);
}
```

Note : `sessionIdGenerator: undefined` = mode stateless (chaque requête est indépendante, pas de session MCP persistante). Plus simple pour V1.

`enableJsonResponse: true` = répond en JSON pour les calls request/response simples au lieu d'ouvrir un SSE stream. Simplifie la vérif curl.

- [ ] **Step 2 — Test curl (sans token, attendu 401)**

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{}}' -i | head -20
```

Attendu : `401` avec header `WWW-Authenticate: Bearer resource_metadata=...`.

- [ ] **Step 3 — Commit**

```bash
git add web/src/app/api/mcp/route.ts
git commit -m "$(cat <<'EOF'
feat(mcp): route /api/mcp (Streamable HTTP transport)

WebStandardStreamableHTTPServerTransport en mode stateless +
JSON-only (pas de SSE pour V1). Auth Bearer OAuth token, 401 avec
WWW-Authenticate qui pointe vers /.well-known/oauth-protected-resource
pour permettre a Claude Desktop de redeclencher le flow OAuth.

POST/GET/DELETE supportes (selon le standard MCP HTTP).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16 — Vérification E2E complète

**Pas de fichier à créer. Vérification manuelle bout en bout, en local puis en prod.**

- [ ] **Step 1 — Flow complet en local via curl**

Avec dev server tournant (`pnpm dev`), simuler Claude Desktop :

```bash
BASE=http://localhost:3000

# 1. Discovery
curl -s $BASE/.well-known/oauth-authorization-server | jq

# 2. Register a test client
CLIENT_RESP=$(curl -s -X POST $BASE/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"client_name":"E2E Test","redirect_uris":["http://localhost:33418/callback"]}')
echo "$CLIENT_RESP" | jq
CLIENT_ID=$(echo "$CLIENT_RESP" | jq -r '.client_id')
echo "CLIENT_ID=$CLIENT_ID"

# 3. Generate PKCE verifier and challenge
VERIFIER=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-43)
CHALLENGE=$(echo -n "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr -d "=" | tr "+/" "-_")
echo "VERIFIER=$VERIFIER"
echo "CHALLENGE=$CHALLENGE"

# 4. Open browser at the authorize URL (tu dois être logué sur localhost:3000)
echo "$BASE/oauth/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=http://localhost:33418/callback&code_challenge=$CHALLENGE&code_challenge_method=S256&state=test123&scope=treso"
# → Ouvrir dans browser, autoriser, copier le `code=` de l'URL de redirect (le browser tombera sur 404).
read -p "Colle le code reçu (boc_xxx): " CODE

# 5. Exchange code → access token
TOKEN_RESP=$(curl -s -X POST $BASE/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=http://localhost:33418/callback&client_id=$CLIENT_ID&code_verifier=$VERIFIER")
echo "$TOKEN_RESP" | jq
ACCESS=$(echo "$TOKEN_RESP" | jq -r '.access_token')
echo "ACCESS=$ACCESS"

# 6. Test MCP initialize
curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"1.0"}}}' | jq

# 7. Test list tools
curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}' | jq

# 8. Test call vue_ensemble
curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":3,"params":{"name":"vue_ensemble","arguments":{}}}' | jq
```

Attendu : chaque step retourne un résultat sensé. Au step 7, `tools/list` doit renvoyer les 3 tools (`vue_ensemble`, `list_ecritures`, `recherche`). Au step 8, la vue d'ensemble du groupe est retournée.

Si une étape échoue, débugger et corriger les tâches concernées. Ne pas committer ces fixes comme partie de Task 16 — créer un commit dédié `fix(oauth): ...` ou `fix(mcp): ...`.

- [ ] **Step 2 — Vérification dans /moi/connexions**

Ouvrir `http://localhost:3000/moi/connexions` dans le browser. Le client "E2E Test" doit apparaître dans la liste, avec `last_used_at` rempli après les calls curl.

Tester le bouton "Révoquer" → vérifier que le token ne marche plus :

```bash
curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":4}' -i | head -5
```

Attendu : `401`.

- [ ] **Step 3 — Push + deploy + test prod (avec accord user)**

Demander explicitement l'accord du user avant push (règle projet : pas de push sans accord).

Si OK :
```bash
git push origin main
```

Attendre le deploy Vercel (~1-2 min). Vérifier que les routes répondent :

```bash
curl -s https://baloo.benomite.com/.well-known/oauth-authorization-server | jq
```

Si OK, refaire le flow curl complet contre prod (en se loguant sur baloo.benomite.com pour l'étape browser).

- [ ] **Step 4 — Test depuis Claude Desktop**

Dans Claude Desktop, ouvrir Settings → Connectors → Add custom connector. Coller `https://baloo.benomite.com/api/mcp`. Suivre le flow OAuth (browser s'ouvre, autoriser). Dans une nouvelle conversation, vérifier que les 3 tools sont visibles et fonctionnels :

> "Donne-moi la vue d'ensemble de la trésorerie"
> "Liste mes 5 dernières écritures"
> "Cherche 'camp été' dans la compta"

Si Claude Desktop ne propose pas le flow OAuth (peut-être DCR non supportée), debugger : peut-être pré-enregistrer un client static en BDD pour Claude Desktop.

Pas de commit final ici, juste une vérif.

---

## Self-Review

**1. Spec coverage** :

- 3 tables BDD oauth_* → Task 1 ✓
- Modules purs PKCE + tokens → Tasks 2-3 ✓
- 3 services oauth-clients/codes/access-tokens → Tasks 4-6 ✓
- 2 endpoints metadata (RFC 8414 + 9728) → Task 7 ✓
- POST /oauth/register (DCR) → Task 8 ✓
- /oauth/authorize page + action → Task 9 ✓
- POST /oauth/token → Task 10 ✓
- POST /oauth/revoke → Task 11 ✓
- Page /moi/connexions → Task 12 ✓
- Helper verifyOauthAccessToken → Task 13 ✓
- 3 tools démo + registerAllTools → Task 14 ✓
- Route /api/mcp Streamable HTTP → Task 15 ✓
- Vérif E2E + Claude Desktop → Task 16 ✓

Phase 1 + Phase 2 entièrement couvertes. Phase 3 (port complet) + Phase 4 (suppression compta/) sont **explicitement hors scope** de ce plan, avec un mot dans le préambule expliquant qu'ils feront l'objet de plans séparés.

**2. Placeholders** : aucun `TODO`, `TBD`, `implement later`. Chaque step a du code complet ou une commande concrète.

**3. Cohérence des types** :

- `McpContext` défini en Task 13 utilisé en Task 14 ✓
- `AccessTokenContext` retourné par `verifyAccessToken` (Task 6) utilisé dans `verifyOauthAccessToken` (Task 13) ✓
- `IssuedAccessToken` (Task 6) avec `plain` + `expires_at` matche ce qu'attend `/oauth/token` (Task 10) ✓
- `OauthClient.redirect_uris` est `string[]` côté TS (sérialisé en JSON en BDD) — cohérent dans tout l'usage ✓
- Le préfixe des tokens (`boa_` access, `boc_` code) cohérent entre Tasks 3, 10, 11 ✓

**4. Project conventions respected** :

- Pattern auth via `requireApiContext` ✓ (réutilisé sans modif)
- Pas de CHECK SQL ajouté ✓
- Pas de `'use server'` mélangé avec helpers (Task 9 & 12 ont leur `actions.ts` séparé) ✓
- `export const dynamic = 'force-dynamic'` sur les pages utilisant `auth()` ✓
- Tests vitest seulement sur modules purs (Tasks 2-3) ✓
- Pas de push sans accord (Task 16 step 3 demande explicitement) ✓
- Commits français + HEREDOC + Co-Authored-By ✓
- Pre-commit hook bloque mention du home dir absolu : utiliser `<repo-root>` au lieu de `/Users/...` dans les commit messages et le code ✓

**5. Points d'attention** :

- Task 13 : la query SQL sur `users` peut nécessiter ajustement selon la vraie shape. Le subagent doit lire le schema avant.
- Task 14 : les signatures de `getOverview`, `listEcritures`, `recherche` doivent être confirmées avant. Adapter le code en conséquence.
- Task 9 : NextAuth `session.user.email` doit être présent sur le type. Si non, fallback `session.user.name` ou autre. Vérifier les types NextAuth du projet.
- Task 16 step 4 (Claude Desktop) : si DCR n'est pas supportée par la version de Claude Desktop installée, prévoir un fallback (pré-enregistrer un client static). À déboguer si besoin.

---

## Suite

Après merge de ce plan :

1. **Plan séparé Phase 3** : port des ~57 autres tools depuis `compta/` vers `web/src/lib/mcp/tools/` (mécanique).
2. **Plan séparé Phase 4** : suppression de `compta/` + mise à jour `.mcp.json` Claude Code pour pointer vers `http://localhost:3000/api/mcp`.
3. **V2 (plus tard)** : refresh tokens, scopes granulaires (`treso:read` pour un parent organisateur), admin panel global, audit log détaillé, rate limiting.
