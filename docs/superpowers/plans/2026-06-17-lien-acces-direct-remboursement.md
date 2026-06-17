# Lien d'accès direct au formulaire de remboursement — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis `/admin/invitations`, créer (ou réutiliser) le compte d'une personne et lui fournir un lien d'auto-connexion vers `/remboursements/nouveau`, copiable (WhatsApp) et embarqué dans le mail d'invitation.

**Architecture:** Une table `invite_links` (token hashé, expiry 7 j, réutilisable, révocable) ; une route publique `GET /i/[token]` qui forge une session Auth.js en BDD (cookie de session) et redirige vers le formulaire ; l'action `createInvitation` génère le lien et le renvoie au client (via `useActionState`) sans le faire transiter par l'URL.

**Tech Stack:** Next.js 16 (App Router, route handlers), Auth.js v5 (sessions `database`), libsql/Turso, Vitest. Réutilise `hashToken` (`api-tokens.ts`) et l'adapter SQLite existant.

---

## Contexte indispensable (à lire avant de coder)

- **Tout le code applicatif est dans `web/`.** Les chemins ci-dessous sont relatifs à `web/`.
- **Lire `web/AGENTS.md`** : pièges Next 16 / Turso. En particulier :
  - Pages utilisant `cookies()`/`headers()`/`auth()` → `export const dynamic = 'force-dynamic'`.
  - `'use server'` n'exporte que des server actions sérialisables — ne pas y mettre de helpers de lecture.
  - Pas de `CHECK` SQL sur des champs de workflow.
- **Pattern DB testable** (cf. `src/lib/services/__tests__/ecritures-create.test.ts`) : les fonctions de service prennent `db: DbWrapper` en premier argument ; les tests créent un client mémoire `createClient({ url: 'file::memory:' })` + `wrapClient(client)` et un schéma SQL minimal. **On suit ce pattern pour toutes les nouvelles fonctions de service.**
- **`DbWrapper`** (de `src/lib/db.ts`) expose `db.prepare(sql).run(...args)`, `.get<T>(...args)`, `.all<T>(...args)`.
- **Hash des tokens** : `hashToken(raw)` (`src/lib/auth/api-tokens.ts`) = SHA-256 hex. On stocke **uniquement** le hash.
- **Règle projet** : JAMAIS de `DELETE` sur données métier. Ici les liens sont révoqués (`revoked_at`), pas supprimés.
- **Lancer les tests** : depuis `web/`, `pnpm test` (= `vitest run`). Un seul fichier : `pnpm vitest run src/lib/auth/invite-links.test.ts`.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/auth/schema.ts` *(modif)* | Ajout du `CREATE TABLE invite_links` dans `ensureAuthSchema`. |
| `src/lib/auth/invite-links.ts` *(create)* | Service : `generateInviteLink`, `resolveInviteLink`, `markUserConnected`, `buildInviteUrl`. |
| `src/lib/auth/invite-links.test.ts` *(create)* | Tests du service. |
| `src/lib/auth/session-mint.ts` *(create)* | `createDbSession` (forge une session BDD) + `buildSessionCookie` (cookie Auth.js). |
| `src/lib/auth/session-mint.test.ts` *(create)* | Tests du minting + du cookie. |
| `src/app/i/[token]/route.ts` *(create)* | Route publique : résout le lien, forge la session, redirige. |
| `src/lib/services/invitations.ts` *(modif)* | `createInvitation` génère le lien + idempotence si l'email existe ; `resendInvitation` régénère un lien. |
| `src/lib/email/invitation.ts` *(modif)* | `sendInvitationEmail` accepte un `inviteUrl` et l'utilise comme CTA. |
| `src/lib/actions/invitations.ts` *(modif)* | `createInvitation` (action) renvoie un `State` (avec le lien) au lieu de rediriger. |
| `src/app/(app)/admin/invitations/invitation-form.tsx` *(modif)* | `useActionState` + affichage du lien copiable. |
| `src/app/(app)/admin/invitations/page.tsx` *(modif)* | Ajuste le sous-titre (le lien remplace le 2e mail). |
| `src/app/login/page.tsx` *(modif)* | Libellés d'erreur `InviteExpired` / `InviteError`. |

---

## Task 1 : Migration — table `invite_links`

**Files:**
- Modify: `src/lib/auth/schema.ts` (bloc `db.exec` initial de `ensureAuthSchema`, autour des lignes 67-79 où `api_tokens` est créé)

- [ ] **Step 1 : Ajouter le CREATE TABLE dans le premier `db.exec`**

Dans `ensureAuthSchema`, à la fin du `db.exec(\`...\`)` qui crée `sessions`/`verification_tokens`/`signin_attempts`/`api_tokens` (juste après le bloc `idx_api_tokens_hash`, avant la fermeture `` ` `` et `);`), ajouter :

```sql

    CREATE TABLE IF NOT EXISTS invite_links (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      callback_url TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invite_links_hash ON invite_links(token_hash);
    CREATE INDEX IF NOT EXISTS idx_invite_links_user ON invite_links(user_id);
```

Note : `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX` dans le même `db.exec` est sûr ici car table et index sont créés ensemble (pas le piège « ALTER puis INDEX sur BDD existante » de AGENTS.md — ici la table est neuve).

- [ ] **Step 2 : Vérifier la compilation**

Run: `cd web && pnpm tsc --noEmit`
Expected: pas d'erreur liée à `schema.ts`.

- [ ] **Step 3 : Commit**

```bash
git add web/src/lib/auth/schema.ts
git commit -m "feat(invite-links): table invite_links (migration ensureAuthSchema)"
```

---

## Task 2 : Service `invite-links` (génération + résolution)

**Files:**
- Create: `src/lib/auth/invite-links.ts`
- Test: `src/lib/auth/invite-links.test.ts`

- [ ] **Step 1 : Écrire le test (échoue car module absent)**

Créer `src/lib/auth/invite-links.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import {
  generateInviteLink,
  resolveInviteLink,
  markUserConnected,
  buildInviteUrl,
} from './invite-links';

// Schéma minimal : users + invite_links (les FK suffisent à exercer la logique).
const SETUP_SQL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    email TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'actif',
    email_verified TEXT,
    updated_at TEXT
  );
  CREATE TABLE invite_links (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    callback_url TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    revoked_at TEXT
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.executeMultiple(SETUP_SQL);
  const db = wrapClient(client);
  await db
    .prepare("INSERT INTO users (id, group_id, email, statut) VALUES ('u1','g1','a@b.fr','actif')")
    .run();
  return db;
}

describe('invite-links', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('génère un lien résolvable vers le bon user', async () => {
    const { rawToken } = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
      createdBy: 'admin1',
    });
    expect(rawToken).toMatch(/^inv_/);
    const resolved = await resolveInviteLink(db, rawToken);
    expect(resolved).toEqual({
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
  });

  it('ne stocke jamais le token en clair', async () => {
    const { rawToken } = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
    const row = await db
      .prepare('SELECT token_hash FROM invite_links LIMIT 1')
      .get<{ token_hash: string }>();
    expect(row?.token_hash).toBeTruthy();
    expect(row?.token_hash).not.toBe(rawToken);
  });

  it('résout null pour un token inconnu', async () => {
    expect(await resolveInviteLink(db, 'inv_inexistant')).toBeNull();
  });

  it('résout null pour un lien expiré', async () => {
    const { rawToken } = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
      ttlDays: -1, // déjà expiré
    });
    expect(await resolveInviteLink(db, rawToken)).toBeNull();
  });

  it('résout null pour un lien révoqué (régénération)', async () => {
    const first = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
    // Régénérer révoque le précédent (un seul lien actif par user).
    await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
    expect(await resolveInviteLink(db, first.rawToken)).toBeNull();
  });

  it('résout null si le user est désactivé', async () => {
    const { rawToken } = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
    await db.prepare("UPDATE users SET statut='ancien' WHERE id='u1'").run();
    expect(await resolveInviteLink(db, rawToken)).toBeNull();
  });

  it('markUserConnected remplit email_verified seulement si null', async () => {
    await markUserConnected(db, 'u1');
    const row1 = await db
      .prepare("SELECT email_verified FROM users WHERE id='u1'")
      .get<{ email_verified: string | null }>();
    expect(row1?.email_verified).toBeTruthy();
    const firstValue = row1!.email_verified;
    await markUserConnected(db, 'u1'); // ne doit pas écraser
    const row2 = await db
      .prepare("SELECT email_verified FROM users WHERE id='u1'")
      .get<{ email_verified: string | null }>();
    expect(row2?.email_verified).toBe(firstValue);
  });

  it('buildInviteUrl assemble appUrl + /i/token sans double slash', () => {
    expect(buildInviteUrl('https://baloo.test/', 'inv_abc')).toBe(
      'https://baloo.test/i/inv_abc',
    );
    expect(buildInviteUrl('https://baloo.test', 'inv_abc')).toBe(
      'https://baloo.test/i/inv_abc',
    );
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run: `cd web && pnpm vitest run src/lib/auth/invite-links.test.ts`
Expected: FAIL — `Cannot find module './invite-links'`.

- [ ] **Step 3 : Écrire l'implémentation**

Créer `src/lib/auth/invite-links.ts` :

```ts
import { randomBytes } from 'crypto';
import type { DbWrapper } from '../db';
import { hashToken } from './api-tokens';

// Liens d'auto-connexion (chantier "lien accès direct remboursement").
//
// - Le token brut a la forme `inv_<base64url 32 bytes>`. Affiché une seule
//   fois à la génération (on ne stocke que le hash SHA-256).
// - Réutilisable jusqu'à expiration (7 j par défaut) — résiste aux robots
//   d'aperçu WhatsApp/iMessage qui visitent les liens.
// - Un seul lien actif par user : générer en révoque les précédents.
// - Révocable (revoked_at). Jamais de DELETE (cf. règle projet).

const INVITE_PREFIX = 'inv_';
const DEFAULT_TTL_DAYS = 7;

export interface GenerateInviteLinkInput {
  userId: string;
  groupId: string;
  callbackUrl: string;
  createdBy?: string | null;
  ttlDays?: number;
}

export interface GeneratedInviteLink {
  id: string;
  rawToken: string;
}

export async function generateInviteLink(
  db: DbWrapper,
  input: GenerateInviteLinkInput,
): Promise<GeneratedInviteLink> {
  // Un seul lien actif par user : révoque les précédents non révoqués.
  await db
    .prepare(
      `UPDATE invite_links
       SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .run(input.userId);

  const rawToken = INVITE_PREFIX + randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const id = `il-${randomBytes(8).toString('hex')}`;
  const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO invite_links
         (id, group_id, user_id, token_hash, callback_url, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.groupId,
      input.userId,
      tokenHash,
      input.callbackUrl,
      expiresAt,
      input.createdBy ?? null,
    );

  return { id, rawToken };
}

export interface ResolvedInviteLink {
  userId: string;
  groupId: string;
  callbackUrl: string;
}

export async function resolveInviteLink(
  db: DbWrapper,
  rawToken: string,
): Promise<ResolvedInviteLink | null> {
  const tokenHash = hashToken(rawToken);
  const row = await db
    .prepare(
      `SELECT l.user_id, l.group_id, l.callback_url, l.expires_at, l.revoked_at, u.statut
       FROM invite_links l
       JOIN users u ON u.id = l.user_id
       WHERE l.token_hash = ?`,
    )
    .get<{
      user_id: string;
      group_id: string;
      callback_url: string;
      expires_at: string;
      revoked_at: string | null;
      statut: string;
    }>(tokenHash);

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.statut !== 'actif') return null;
  if (new Date(row.expires_at) < new Date()) return null;

  return {
    userId: row.user_id,
    groupId: row.group_id,
    callbackUrl: row.callback_url,
  };
}

// Marque le user comme connecté au moins une fois (email_verified). N'écrase
// jamais une valeur existante. Idempotent.
export async function markUserConnected(db: DbWrapper, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET email_verified = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ? AND email_verified IS NULL`,
    )
    .run(userId);
}

export function buildInviteUrl(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/$/, '')}/i/${rawToken}`;
}
```

- [ ] **Step 4 : Lancer le test (passe)**

Run: `cd web && pnpm vitest run src/lib/auth/invite-links.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/auth/invite-links.ts web/src/lib/auth/invite-links.test.ts
git commit -m "feat(invite-links): service génération/résolution de liens d'auto-connexion"
```

---

## Task 3 : Helper de session (`session-mint`)

**Files:**
- Create: `src/lib/auth/session-mint.ts`
- Test: `src/lib/auth/session-mint.test.ts`

Rappel : Auth.js v5 en stratégie `database` lit le cookie de session (`authjs.session-token`, préfixe `__Secure-` en https) et fait `getSessionAndUser(token)` via l'adapter (cf. `adapter.ts` lignes 92-122). Forger une session = insérer une ligne `sessions` + poser ce cookie avec la même valeur de token.

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `src/lib/auth/session-mint.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { createDbSession, buildSessionCookie } from './session-mint';

const SETUP_SQL = `
  CREATE TABLE sessions (
    session_token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('session-mint', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('createDbSession insère une ligne sessions valide dans le futur', async () => {
    const { sessionToken, expires } = await createDbSession(db, 'u1');
    expect(sessionToken).toBeTruthy();
    expect(expires.getTime()).toBeGreaterThan(Date.now());
    const row = await db
      .prepare('SELECT user_id, expires FROM sessions WHERE session_token = ?')
      .get<{ user_id: string; expires: string }>(sessionToken);
    expect(row?.user_id).toBe('u1');
    expect(new Date(row!.expires).getTime()).toBeGreaterThan(Date.now());
  });

  it('createDbSession génère des tokens uniques', async () => {
    const a = await createDbSession(db, 'u1');
    const b = await createDbSession(db, 'u1');
    expect(a.sessionToken).not.toBe(b.sessionToken);
  });

  it('buildSessionCookie : nom non-sécurisé en http', () => {
    const exp = new Date(Date.now() + 1000);
    const c = buildSessionCookie('tok', exp, false);
    expect(c.name).toBe('authjs.session-token');
    expect(c.value).toBe('tok');
    expect(c.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
    });
    expect(c.options.expires).toBe(exp);
  });

  it('buildSessionCookie : préfixe __Secure- en https', () => {
    const exp = new Date(Date.now() + 1000);
    const c = buildSessionCookie('tok', exp, true);
    expect(c.name).toBe('__Secure-authjs.session-token');
    expect(c.options.secure).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run: `cd web && pnpm vitest run src/lib/auth/session-mint.test.ts`
Expected: FAIL — `Cannot find module './session-mint'`.

- [ ] **Step 3 : Écrire l'implémentation**

Créer `src/lib/auth/session-mint.ts` :

```ts
import { randomUUID } from 'crypto';
import type { DbWrapper } from '../db';

// Forge une session Auth.js (stratégie "database") sans passer par le flux
// magic link. Utilisé par la route /i/[token] (lien d'auto-connexion).
//
// Auth.js lit la session via le cookie `authjs.session-token` (préfixe
// `__Secure-` en https) puis `getSessionAndUser(token)` sur l'adapter, qui
// JOIN sessions ⋈ users. Donc : insérer une ligne sessions + poser le cookie
// avec la même valeur de token suffit à connecter l'utilisateur.

// 30 jours = maxAge par défaut des sessions database d'Auth.js.
const SESSION_TTL_DAYS = 30;

export interface MintedSession {
  sessionToken: string;
  expires: Date;
}

export async function createDbSession(db: DbWrapper, userId: string): Promise<MintedSession> {
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db
    .prepare('INSERT INTO sessions (session_token, user_id, expires) VALUES (?, ?, ?)')
    .run(sessionToken, userId, expires.toISOString());
  return { sessionToken, expires };
}

export interface SessionCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    path: '/';
    secure: boolean;
    expires: Date;
  };
}

export function buildSessionCookie(
  token: string,
  expires: Date,
  secure: boolean,
): SessionCookie {
  const name = secure ? '__Secure-authjs.session-token' : 'authjs.session-token';
  return {
    name,
    value: token,
    options: { httpOnly: true, sameSite: 'lax', path: '/', secure, expires },
  };
}
```

- [ ] **Step 4 : Lancer le test (passe)**

Run: `cd web && pnpm vitest run src/lib/auth/session-mint.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/auth/session-mint.ts web/src/lib/auth/session-mint.test.ts
git commit -m "feat(invite-links): helper de minting de session Auth.js (cookie + ligne sessions)"
```

---

## Task 4 : Route publique `GET /i/[token]`

**Files:**
- Create: `src/app/i/[token]/route.ts`

La logique dure (résolution, minting, cookie) est déjà testée en Task 2/3. La route est mince : elle orchestre et gère les redirections. Vérification manuelle en Task 7.

- [ ] **Step 1 : Écrire la route**

Créer `src/app/i/[token]/route.ts` :

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureAuthSchema } from '@/lib/auth/schema';
import { resolveInviteLink, markUserConnected } from '@/lib/auth/invite-links';
import { createDbSession, buildSessionCookie } from '@/lib/auth/session-mint';
import { logError } from '@/lib/log';

// Route publique (hors groupe (app), pas de session requise pour l'atteindre).
// Lien d'auto-connexion : résout le token, forge une session Auth.js et
// redirige vers le formulaire de remboursement.
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const origin = req.nextUrl.origin;

  try {
    await ensureAuthSchema();
    const db = getDb();

    const resolved = await resolveInviteLink(db, token);
    if (!resolved) {
      return NextResponse.redirect(new URL('/login?error=InviteExpired', origin));
    }

    const { sessionToken, expires } = await createDbSession(db, resolved.userId);
    await markUserConnected(db, resolved.userId);

    const secure = req.nextUrl.protocol === 'https:';
    const cookie = buildSessionCookie(sessionToken, expires, secure);

    const res = NextResponse.redirect(new URL(resolved.callbackUrl, origin));
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (err) {
    logError('invite-link', 'Échec ouverture du lien d’auto-connexion', err, { });
    return NextResponse.redirect(new URL('/login?error=InviteError', origin));
  }
}
```

- [ ] **Step 2 : Libellés d'erreur sur la page login**

Dans `src/app/login/page.tsx`, ajouter deux `case` dans `errorLabel` (avant le `default`) :

```ts
    case 'InviteExpired':
      return 'Ce lien d’accès direct a expiré ou n’est plus valide. Demande-en un nouveau au trésorier.';
    case 'InviteError':
      return 'Impossible d’ouvrir ce lien d’accès direct. Réessaie ou demande un nouveau lien au trésorier.';
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `cd web && pnpm tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 4 : Commit**

```bash
git add web/src/app/i web/src/app/login/page.tsx
git commit -m "feat(invite-links): route publique /i/[token] (auto-connexion + redirection)"
```

---

## Task 5 : Génération du lien dans `createInvitation` (service) + email

**Files:**
- Modify: `src/lib/email/invitation.ts`
- Modify: `src/lib/services/invitations.ts`

### 5a — Email : accepter un `inviteUrl`

- [ ] **Step 1 : Ajouter le champ à l'interface**

Dans `src/lib/email/invitation.ts`, étendre `InvitationMailParams` :

```ts
interface InvitationMailParams {
  to: string;
  invitedName: string | null;
  inviterName: string | null;
  groupName: string;
  role: string;
  appUrl: string;
  inviteUrl?: string | null;
}
```

- [ ] **Step 2 : Utiliser `inviteUrl` comme CTA quand présent (version texte)**

Dans `buildText`, remplacer le bloc actuel (de `const loginUrl = ...` jusqu'au tableau de retour) par une logique conditionnelle. Code complet de remplacement de `buildText` :

```ts
function buildText(params: InvitationMailParams): string {
  const { to, invitedName, inviterName, groupName, role, appUrl, inviteUrl } = params;
  const greeting = invitedName ? `Bonjour ${invitedName},` : 'Bonjour,';
  const inviter = inviterName ? `${inviterName} t'a` : 'Tu as été';
  const roleLabel = ROLE_LABELS[role] ?? role;
  const loginUrl = `${appUrl.replace(/\/$/, '')}/login`;
  const aideUrl = `${appUrl.replace(/\/$/, '')}/aide`;

  const actions = actionsFor(role)
    .map((a) => `  • ${a.label} — ${a.description}`)
    .join('\n');

  const accessBlock = inviteUrl
    ? [
        'Pour accéder à ton espace (tu es connecté automatiquement) :',
        inviteUrl,
        '',
        '(Ce lien est valable 7 jours. Garde-le pour toi.)',
      ]
    : [
        'Pour activer ton compte :',
        loginUrl,
        '',
        `(Saisis ton email — ${to} — puis clique sur "Recevoir un lien". Un lien de connexion arrive par mail, tu cliques, et tu es connecté.)`,
      ];

  return [
    greeting,
    '',
    `${inviter} invité à rejoindre Baloo, l'outil de compta du groupe ${groupName}.`,
    '',
    `Ton rôle : ${roleLabel}.`,
    '',
    'Ce que tu pourras faire :',
    actions,
    '',
    ...accessBlock,
    '',
    `Une page d'aide détaillée est dispo : ${aideUrl}`,
    '',
    'À bientôt sur Baloo.',
  ].join('\n');
}
```

- [ ] **Step 3 : Idem version HTML (CTA + texte sous le bouton)**

Dans `buildHtml`, juste après `const loginUrl = ...` et `const aideUrl = ...`, ajouter :

```ts
  const ctaUrl = params.inviteUrl ?? loginUrl;
  const ctaLabel = params.inviteUrl ? 'Accéder à mon espace →' : 'Activer mon compte →';
  const ctaHint = params.inviteUrl
    ? 'Tu seras connecté automatiquement. Ce lien est valable 7 jours.'
    : `Sur la page de connexion, saisis ton email (${escapeHtml(params.to)})<br>puis clique sur « Recevoir un lien ».`;
```

Puis, dans le template HTML retourné, dans le bloc CTA : remplacer `href="${loginUrl}"` par `href="${ctaUrl}"`, le texte du lien `Activer mon compte →` par `${ctaLabel}`, et remplacer le contenu du `<p>` d'aide sous le bouton par `${ctaHint}` (supprimer les deux lignes `Sur la page de connexion, saisis ton email...` au profit de `${ctaHint}`).

- [ ] **Step 4 : Vérifier la compilation**

Run: `cd web && pnpm tsc --noEmit`
Expected: pas d'erreur.

### 5b — Service : générer le lien + idempotence

- [ ] **Step 5 : Étendre le résultat et la logique de `createInvitation`**

Dans `src/lib/services/invitations.ts` :

Ajouter les imports en tête :

```ts
import { generateInviteLink, buildInviteUrl } from '../auth/invite-links';
```

Étendre `CreateInvitationResult` :

```ts
export interface CreateInvitationResult {
  userId: string;
  email: string;
  role: string;
  scope_unite_id: string | null;
  email_sent: boolean;
  invite_url: string;
  reused: boolean;
}
```

Remplacer le bloc anti-doublon (lignes ~67-73, le `if (existing) throw`) et toute la suite (création user + envoi mail + return) par la logique « find-or-create + génération du lien ». Code complet à partir du lookup `existing` jusqu'au `return` :

```ts
  // Anti-doublon : si un user existe déjà avec cet email dans le groupe, on
  // le réutilise (idempotent) au lieu d'échouer — on lui régénère un lien.
  const existing = await db
    .prepare('SELECT id, role, scope_unite_id FROM users WHERE group_id = ? AND email = ? LIMIT 1')
    .get<{ id: string; role: string; scope_unite_id: string | null }>(groupId, email);

  // Validation du scope (l'unité doit exister dans le groupe).
  if (input.scope_unite_id) {
    const unite = await db
      .prepare('SELECT id FROM unites WHERE id = ? AND group_id = ? LIMIT 1')
      .get<{ id: string }>(input.scope_unite_id, groupId);
    if (!unite) throw new Error(`Unité ${input.scope_unite_id} introuvable dans ce groupe.`);
  }

  // Récupération du nom du groupe et de l'inviteur (pour le mail).
  const groupRow = await db
    .prepare('SELECT nom FROM groupes WHERE id = ?')
    .get<{ nom: string }>(groupId);
  const inviterRow = await db
    .prepare('SELECT nom_affichage FROM users WHERE id = ?')
    .get<{ nom_affichage: string | null }>(inviterUserId);

  let userId: string;
  let effectiveRole: string;
  let effectiveScope: string | null;
  let nomAffichage: string;
  const reused = !!existing;

  if (existing) {
    // On garde le rôle/scope actuels du user existant (modifiables via la
    // section « Modifier le rôle »). On ne touche pas à ses données.
    userId = existing.id;
    effectiveRole = existing.role;
    effectiveScope = existing.scope_unite_id;
    const u = await db
      .prepare('SELECT nom_affichage FROM users WHERE id = ?')
      .get<{ nom_affichage: string | null }>(existing.id);
    nomAffichage = u?.nom_affichage ?? email.split('@')[0];
  } else {
    const baseId = slugify(email.split('@')[0] || 'user');
    userId = await uniqueId('users', baseId);
    const now = currentTimestamp();
    nomAffichage = input.nom_affichage?.trim() || email.split('@')[0];
    effectiveRole = input.role;
    effectiveScope = nullIfEmpty(input.scope_unite_id);
    await db.prepare(
      `INSERT INTO users (id, group_id, person_id, email, nom_affichage, role, scope_unite_id, statut, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'actif', ?, ?)`,
    ).run(userId, groupId, email, nomAffichage, input.role, effectiveScope, now, now);
  }

  // Génère le lien d'auto-connexion vers le formulaire de remboursement.
  // (Si le rôle est `parent`, le formulaire le redirigera vers l'accueil :
  // c'est géré côté page /remboursements/nouveau.)
  const { rawToken } = await generateInviteLink(db, {
    userId,
    groupId,
    callbackUrl: '/remboursements/nouveau',
    createdBy: inviterUserId,
  });
  const inviteUrl = buildInviteUrl(input.app_url, rawToken);

  // Envoi du mail. Si ça échoue, on garde quand même le user + le lien — le
  // trésorier peut copier le lien affiché à l'écran.
  let emailSent = false;
  try {
    await sendInvitationEmail({
      to: email,
      invitedName: nomAffichage,
      inviterName: inviterRow?.nom_affichage ?? null,
      groupName: groupRow?.nom ?? 'ton groupe SGDF',
      role: effectiveRole,
      appUrl: input.app_url,
      inviteUrl,
    });
    emailSent = true;
  } catch (err) {
    console.error(`[invitations] Envoi du mail à ${email} a échoué :`, err);
  }

  return {
    userId,
    email,
    role: effectiveRole,
    scope_unite_id: effectiveScope,
    email_sent: emailSent,
    invite_url: inviteUrl,
    reused,
  };
```

Note : la validation `VALID_ROLES` et la cohérence rôle↔scope (lignes 54-65) restent **avant** ce bloc, inchangées (elles valident l'input même si on réutilise un user — on ne s'en sert que pour la création).

- [ ] **Step 6 : Mettre à jour `resendInvitation` pour renvoyer un lien direct**

Dans `resendInvitation` (même fichier), remplacer le corps après le check `if (user.email_verified)` par une génération de lien + passage à l'email :

```ts
  const groupRow = await db
    .prepare('SELECT nom FROM groupes WHERE id = ?')
    .get<{ nom: string }>(groupId);
  const { rawToken } = await generateInviteLink(db, {
    userId,
    groupId,
    callbackUrl: '/remboursements/nouveau',
    createdBy: null,
  });
  await sendInvitationEmail({
    to: user.email,
    invitedName: user.nom_affichage ?? user.email.split('@')[0],
    inviterName: null,
    groupName: groupRow?.nom ?? 'ton groupe SGDF',
    role: user.role as InvitationRole,
    appUrl: app_url,
    inviteUrl: buildInviteUrl(app_url, rawToken),
  });
```

- [ ] **Step 7 : Vérifier la compilation + tests existants**

Run: `cd web && pnpm tsc --noEmit && pnpm vitest run`
Expected: compile OK ; tous les tests passent (aucun ne dépend du `throw` sur doublon).

- [ ] **Step 8 : Commit**

```bash
git add web/src/lib/services/invitations.ts web/src/lib/email/invitation.ts
git commit -m "feat(invite-links): createInvitation génère le lien direct (idempotent) + mail avec lien"
```

---

## Task 6 : UI — action qui renvoie le lien + affichage copiable

**Files:**
- Modify: `src/lib/actions/invitations.ts`
- Modify: `src/app/(app)/admin/invitations/invitation-form.tsx`
- Modify: `src/app/(app)/admin/invitations/page.tsx`

### 6a — Action : renvoyer un State (au lieu de rediriger)

- [ ] **Step 1 : Réécrire l'action `createInvitation`**

Dans `src/lib/actions/invitations.ts`, ajouter un type d'état exporté et remplacer la fonction `createInvitation` par une version compatible `useActionState` (signature `(prevState, formData)`). Garder `revalidatePath` pour rafraîchir la liste « en attente ». **Ne pas** rediriger en succès (sinon le lien serait perdu / passerait dans l'URL).

```ts
export interface CreateInvitationState {
  ok: boolean;
  error?: string;
  email?: string;
  inviteUrl?: string;
  emailSent?: boolean;
  reused?: boolean;
}

export async function createInvitation(
  _prevState: CreateInvitationState,
  formData: FormData,
): Promise<CreateInvitationState> {
  const { groupId, userId } = await requireAdmin();

  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const requestedRole = formData.get('role') as string | null;
  const scopeUniteId = (formData.get('scope_unite_id') as string | null) || null;
  const nomAffichage = (formData.get('nom_affichage') as string | null)?.trim() || null;

  if (!email) {
    return { ok: false, error: 'Email requis.' };
  }
  if (!requestedRole || !VALID_ROLES.includes(requestedRole as InvitationRole)) {
    return { ok: false, error: 'Rôle invalide.' };
  }

  try {
    const result = await createInvitationService(
      { groupId, inviterUserId: userId },
      {
        email,
        role: requestedRole as InvitationRole,
        scope_unite_id: scopeUniteId,
        nom_affichage: nomAffichage,
        app_url: await deriveAppUrl(),
      },
    );
    revalidatePath('/admin/invitations');
    return {
      ok: true,
      email: result.email,
      inviteUrl: result.invite_url,
      emailSent: result.email_sent,
      reused: result.reused,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('invitations', 'Création invitation échouée', err, { email });
    return { ok: false, error: message };
  }
}
```

Note : `requireAdmin()` peut faire un `redirect()` (cas non-admin) — c'est OK, le `redirect` lève et court-circuite. L'import `redirect` reste utilisé par les autres actions. Supprimer l'import `headers`/`redirect` seulement s'ils deviennent inutilisés (vérifier : `deriveAppUrl` utilise `headers`, les autres actions utilisent `redirect` → garder les deux).

- [ ] **Step 2 : Vérifier la compilation (échouera côté form — normal, corrigé en 6b)**

Run: `cd web && pnpm tsc --noEmit`
Expected: erreur uniquement dans `invitation-form.tsx` / `page.tsx` (signature de l'action). Sinon corriger.

### 6b — Formulaire : `useActionState` + affichage du lien

- [ ] **Step 3 : Réécrire `invitation-form.tsx`**

Remplacer intégralement `src/app/(app)/admin/invitations/invitation-form.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import { PendingButton } from '@/components/shared/pending-button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/shared/field';
import { Alert } from '@/components/ui/alert';
import type { CreateInvitationState } from '@/lib/actions/invitations';

interface UniteOption {
  id: string;
  code: string;
  name: string;
}

interface RoleOption {
  value: string;
  label: string;
}

interface Props {
  action: (
    prevState: CreateInvitationState,
    formData: FormData,
  ) => Promise<CreateInvitationState>;
  unites: UniteOption[];
  roles: RoleOption[];
}

const INITIAL: CreateInvitationState = { ok: false };

export function InvitationForm({ action, unites, roles }: Props) {
  const [role, setRole] = useState(roles[0]?.value ?? 'equipier');
  const [state, formAction] = useActionState(action, INITIAL);
  const [copied, setCopied] = useState(false);
  const needsUnit = role === 'chef';

  async function copyLink() {
    if (!state.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(state.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponible : le lien reste sélectionnable manuellement */
    }
  }

  return (
    <div className="space-y-4">
      {state.error && <Alert variant="error">{state.error}</Alert>}

      {state.ok && state.inviteUrl && (
        <Alert variant="success">
          <div className="space-y-2">
            <div>
              {state.reused ? 'Compte déjà existant' : 'Compte créé'} pour{' '}
              <b>{state.email}</b>
              {state.emailSent
                ? ' — mail envoyé avec le lien.'
                : " — mail non envoyé (cf. logs), copie le lien ci-dessous."}
            </div>
            <div className="text-[12px] font-medium text-fg-muted">
              Lien d&apos;accès direct (valable 7 jours) — à coller dans WhatsApp :
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={state.inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="text-[12px]"
              />
              <PendingButton
                type="button"
                variant="secondary"
                size="sm"
                pendingLabel=""
                onClick={copyLink}
              >
                {copied ? (
                  <Check size={14} strokeWidth={2} className="mr-1.5" />
                ) : (
                  <Copy size={14} strokeWidth={2} className="mr-1.5" />
                )}
                {copied ? 'Copié' : 'Copier'}
              </PendingButton>
            </div>
          </div>
        </Alert>
      )}

      <form action={formAction} className="space-y-4">
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="prenom.nom@example.fr"
          />
        </Field>
        <Field label="Nom affiché" htmlFor="nom_affichage" hint="optionnel">
          <Input id="nom_affichage" name="nom_affichage" placeholder="Prénom Nom" />
        </Field>
        <Field label="Rôle" htmlFor="role" required>
          <NativeSelect
            id="role"
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {needsUnit && (
          <Field
            label="Unité"
            htmlFor="scope_unite_id"
            required
            hint="le chef d'unité ne voit que son unité"
          >
            <NativeSelect id="scope_unite_id" name="scope_unite_id" required defaultValue="">
              <option value="" disabled>
                — Choisir une unité —
              </option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <div className="flex justify-end pt-1">
          <PendingButton pendingLabel="Création…">
            <Send size={14} strokeWidth={2} className="mr-1.5" />
            Créer et générer le lien
          </PendingButton>
        </div>
      </form>
    </div>
  );
}
```

Note : vérifier que `Alert` accepte des enfants riches (c'est le cas, cf. usage dans `page.tsx`). Si `PendingButton` ne supporte pas `onClick`/`type="button"`, utiliser le `Button` de `@/components/ui/button` à la place pour le bouton Copier (l'import `Button` existe déjà dans le projet).

- [ ] **Step 4 : Nettoyer `page.tsx`**

Dans `src/app/(app)/admin/invitations/page.tsx` :

1. L'alerte `params.success` (lignes ~93-100) ne sert plus pour la création (le retour passe par le formulaire). La **laisser** (inoffensive) ou la retirer. Pour éviter du code mort, retirer le bloc `{params.success && (...)}` et l'entrée `success`/`status` de l'interface `SearchParams`.
2. Mettre à jour le sous-titre de la section :

```tsx
        <Section title="Nouvelle invitation" subtitle="Crée le compte et génère un lien d'accès direct (mail + à copier).">
          <InvitationForm action={createInvitation} unites={unites} roles={ROLE_OPTIONS} />
        </Section>
```

- [ ] **Step 5 : Vérifier compilation + lint + tests**

Run: `cd web && pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
Expected: tout passe.

- [ ] **Step 6 : Commit**

```bash
git add web/src/lib/actions/invitations.ts "web/src/app/(app)/admin/invitations/invitation-form.tsx" "web/src/app/(app)/admin/invitations/page.tsx"
git commit -m "feat(invite-links): UI invitation — lien copiable (WhatsApp) via useActionState"
```

---

## Task 7 : Vérification manuelle end-to-end

**Files:** aucun (vérification).

- [ ] **Step 1 : Lancer l'app en dev**

Run: `cd web && pnpm dev`
Ouvrir `http://localhost:3000`, se connecter en trésorier (le magic link s'affiche en console serveur, cf. `auth.ts`).

- [ ] **Step 2 : Créer une invitation**

Aller sur `/admin/invitations`. Saisir un email de test + rôle `equipier`. Soumettre.
Attendu : encart succès avec le lien `http://localhost:3000/i/inv_...` + bouton **Copier** fonctionnel. En console serveur, le mail (mode console) contient le même lien comme CTA « Accéder à mon espace ».

- [ ] **Step 3 : Tester le lien dans une session anonyme**

Copier le lien, l'ouvrir dans une fenêtre de navigation privée (pas de session existante).
Attendu : redirection vers `/remboursements/nouveau`, **connecté** en tant que l'invité (prénom/email préremplis depuis la session).

- [ ] **Step 4 : Réutilisation (résiste à l'aperçu WhatsApp)**

Rouvrir le même lien une 2e fois (autre onglet privé).
Attendu : fonctionne encore (lien réutilisable 7 j).

- [ ] **Step 5 : Lien invalide**

Ouvrir `http://localhost:3000/i/inv_nimportequoi`.
Attendu : redirection vers `/login?error=InviteExpired` avec le message d'erreur.

- [ ] **Step 6 : Idempotence**

Recréer une invitation avec le **même email** que l'étape 2.
Attendu : encart « Compte déjà existant pour … » + un **nouveau** lien (l'ancien est révoqué — le retester confirme qu'il renvoie désormais vers `/login?error=InviteExpired`).

- [ ] **Step 7 : Suite de tests complète**

Run: `cd web && pnpm vitest run`
Expected: PASS (incluant les nouveaux tests invite-links + session-mint).

- [ ] **Step 8 : Commit éventuel des correctifs**

Si la vérification a nécessité des ajustements, commit ciblé. Sinon rien.

---

## Notes de sécurité (rappel pour l'implémenteur)

- Le lien `/i/<token>` est un **identifiant porteur** : il connecte au compte de l'invité. On ne stocke que le hash ; le token brut n'apparaît **jamais** dans une URL d'admin ni dans les logs (il transite par le retour de server action → `useActionState`, côté client uniquement).
- Régénérer un lien (recréer une invitation pour le même email, ou « renvoyer le mail ») **révoque** le précédent (`generateInviteLink` met `revoked_at` sur les liens actifs du user). Un seul lien valide à la fois par user.
- Rôle `parent` : ne peut pas accéder à `/remboursements/nouveau` (garde-fou existant sur la page). Le lien fonctionnera (session créée) mais la page le renverra à l'accueil. Le rôle par défaut attendu pour « se faire rembourser » est `equipier`.
- Aucun `DELETE` : révocation uniquement.
