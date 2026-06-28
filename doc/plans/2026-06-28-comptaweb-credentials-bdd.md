# Credentials Comptaweb en BDD (chiffrés, UI settings) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stocker les identifiants Comptaweb par groupe en BDD (mot de passe chiffré AES-256-GCM), les rendre éditables depuis `/admin/parametres`, et faire lire `loadConfig` la BDD en priorité (repli sur les variables d'env).

**Architecture:** Un module crypto pur (`secret-box`) chiffre/déchiffre le mot de passe. Un service `comptaweb-credentials` porte la table dédiée + get/save/status + une résolution `resolveComptawebCredentials` (BDD → env). `loadConfig` consomme cette résolution. Une server action « Enregistrer et tester » et une section UI complètent le tout.

**Tech Stack:** Next.js 16 (server components + server actions), libsql/Turso, Node `crypto`, vitest. Spec : `doc/specs/2026-06-28-comptaweb-credentials-bdd-design.md`.

## Global Constraints

- **Chiffrement** : AES-256-GCM, clé `process.env.CREDENTIALS_KEY` (base64, 32 octets). Mot de passe **jamais** en clair en base, en git, ni loggé.
- **Write-only** : le mot de passe n'est jamais renvoyé au client ; champ vide = inchangé.
- **Résolution `loadConfig`** : session `/tmp` (inchangée) → credentials BDD → variables d'env → erreur.
- **Garde-fou multi-groupe** : `getComptawebCredentials` throw si > 1 ligne (« threading groupId requis »). Pas de threading `groupId` en V1.
- **Accès** : saisie/modification réservées aux admins (`requireAdmin`, rôles `tresorier`/`RG`).
- **Jamais de DELETE** sur la table credentials ; `save` fait un UPSERT.
- **Piège Next** : ne jamais appeler `redirect()` à l'intérieur d'un `try` dont le `catch` avale l'exception (`redirect` lève `NEXT_REDIRECT`). Redirect APRÈS le try/catch.
- Commandes depuis `web/` ; si `pnpm` échoue (« packages field missing »), utiliser `./node_modules/.bin/{vitest,tsc,eslint}`.

---

## File Structure

- **Create** `web/src/lib/crypto/secret-box.ts` — `encryptSecret` / `decryptSecret` (AES-256-GCM).
- **Create** `web/src/lib/crypto/__tests__/secret-box.test.ts`.
- **Create** `web/src/lib/services/comptaweb-credentials.ts` — table + `getComptawebCredentials` / `saveComptawebCredentials` / `getComptawebCredentialsStatus` / `resolveComptawebCredentials`.
- **Create** `web/src/lib/services/__tests__/comptaweb-credentials.test.ts`.
- **Modify** `web/src/lib/comptaweb/auth.ts` — `loadConfig` consomme `resolveComptawebCredentials`.
- **Create** `web/src/lib/actions/comptaweb-credentials.ts` — server action « Enregistrer et tester ».
- **Modify** `web/src/app/(app)/admin/parametres/page.tsx` — section « Connexion Comptaweb ».

---

## Task 1 : Module crypto `secret-box`

**Files:**
- Create: `web/src/lib/crypto/secret-box.ts`
- Test: `web/src/lib/crypto/__tests__/secret-box.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plaintext: string): string` (format `iv.authTag.ciphertext`, base64) ; `decryptSecret(stored: string): string`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/crypto/__tests__/secret-box.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret } from '../secret-box';

beforeAll(() => {
  // Clé de test déterministe (32 octets) en base64.
  process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('secret-box', () => {
  it('roundtrip : decrypt(encrypt(x)) === x', () => {
    const secret = 'mon-mot-de-passe-comptaweb-é@#';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('deux chiffrements du même clair donnent des sorties différentes (IV aléatoire)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('toute altération du ciphertext fait échouer le déchiffrement (auth GCM)', () => {
    const enc = encryptSecret('secret');
    const [iv, tag, ct] = enc.split('.');
    const tampered = [iv, tag, Buffer.from('autre-chose').toString('base64')].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('clé absente → erreur explicite', () => {
    const saved = process.env.CREDENTIALS_KEY;
    delete process.env.CREDENTIALS_KEY;
    try {
      expect(() => encryptSecret('x')).toThrow(/CREDENTIALS_KEY/);
    } finally {
      process.env.CREDENTIALS_KEY = saved;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/crypto/__tests__/secret-box.test.ts`
Expected: FAIL — `Cannot find module '../secret-box'`.

- [ ] **Step 3: Implement**

Create `web/src/lib/crypto/secret-box.ts`:

```ts
// Chiffrement symétrique réversible pour secrets applicatifs (ex. mot de passe
// Comptaweb). AES-256-GCM : confidentialité + authentification (toute
// altération est détectée au déchiffrement). Clé depuis CREDENTIALS_KEY
// (base64, 32 octets) — jamais en BDD ni en git.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

function getKey(): Buffer {
  const b64 = process.env.CREDENTIALS_KEY;
  if (!b64) {
    throw new Error('CREDENTIALS_KEY manquante (clé de chiffrement des secrets).');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_KEY invalide : 32 octets attendus (base64).');
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Format de secret chiffré invalide.');
  }
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/crypto/__tests__/secret-box.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/crypto/secret-box.ts web/src/lib/crypto/__tests__/secret-box.test.ts
git commit -m "feat(crypto): module secret-box (AES-256-GCM) pour secrets applicatifs"
```

---

## Task 2 : Service `comptaweb-credentials` + branchement `loadConfig`

**Files:**
- Create: `web/src/lib/services/comptaweb-credentials.ts`
- Test: `web/src/lib/services/__tests__/comptaweb-credentials.test.ts`
- Modify: `web/src/lib/comptaweb/auth.ts`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` (Task 1) ; `getDb` (`web/src/lib/db.ts`).
- Produces:
  - `ensureComptawebCredentialsSchema(): Promise<void>` (lazy-init).
  - `getComptawebCredentials(): Promise<{ username: string; password: string; base_url: string | null } | null>` (déchiffre ; throw si > 1 ligne).
  - `saveComptawebCredentials(groupId: string, userId: string, input: { username: string; password?: string }): Promise<void>` (upsert ; password chiffré si fourni, sinon inchangé).
  - `getComptawebCredentialsStatus(): Promise<{ configured: boolean; username: string | null; updated_at: string | null }>` (sans password).
  - `resolveComptawebCredentials(): Promise<{ username: string; password: string; baseUrl: string | null } | null>` (BDD → env).

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/services/__tests__/comptaweb-credentials.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';

let testDb: ReturnType<typeof wrapClient>;
vi.mock('../../db', () => ({ getDb: () => testDb }));

import {
  ensureComptawebCredentialsSchema,
  getComptawebCredentials,
  saveComptawebCredentials,
  getComptawebCredentialsStatus,
  resolveComptawebCredentials,
} from '../comptaweb-credentials';

beforeAll(() => {
  process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
});

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  testDb = wrapClient(client);
  await ensureComptawebCredentialsSchema();
  delete process.env.COMPTAWEB_USERNAME;
  delete process.env.COMPTAWEB_PASSWORD;
});

describe('comptaweb-credentials', () => {
  it('save puis get : roundtrip du mot de passe (déchiffré)', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'treso@x.fr', password: 'secret123' });
    const got = await getComptawebCredentials();
    expect(got).toEqual({ username: 'treso@x.fr', password: 'secret123', base_url: null });
  });

  it('le password n\'est pas stocké en clair', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'a', password: 'secret123' });
    const row = await testDb.prepare('SELECT password_encrypted FROM comptaweb_credentials').get<{ password_encrypted: string }>();
    expect(row?.password_encrypted).not.toContain('secret123');
  });

  it('save sans password ne touche pas au password existant', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'a', password: 'pw1' });
    await saveComptawebCredentials('g1', 'u1', { username: 'b' }); // pas de password
    const got = await getComptawebCredentials();
    expect(got?.username).toBe('b');
    expect(got?.password).toBe('pw1');
  });

  it('status ne révèle pas le password', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'treso@x.fr', password: 'pw' });
    const st = await getComptawebCredentialsStatus();
    expect(st.configured).toBe(true);
    expect(st.username).toBe('treso@x.fr');
    expect(JSON.stringify(st)).not.toContain('pw');
  });

  it('getComptawebCredentials throw si plusieurs lignes (garde-fou multi-groupe)', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'a', password: 'p' });
    await saveComptawebCredentials('g2', 'u2', { username: 'b', password: 'p' });
    await expect(getComptawebCredentials()).rejects.toThrow();
  });

  it('resolve : BDD prioritaire', async () => {
    process.env.COMPTAWEB_USERNAME = 'env-user';
    process.env.COMPTAWEB_PASSWORD = 'env-pw';
    await saveComptawebCredentials('g1', 'u1', { username: 'bdd-user', password: 'bdd-pw' });
    expect(await resolveComptawebCredentials()).toMatchObject({ username: 'bdd-user', password: 'bdd-pw' });
  });

  it('resolve : repli sur env si pas de credentials BDD', async () => {
    process.env.COMPTAWEB_USERNAME = 'env-user';
    process.env.COMPTAWEB_PASSWORD = 'env-pw';
    expect(await resolveComptawebCredentials()).toMatchObject({ username: 'env-user', password: 'env-pw' });
  });

  it('resolve : null si ni BDD ni env', async () => {
    expect(await resolveComptawebCredentials()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/comptaweb-credentials.test.ts`
Expected: FAIL — `Cannot find module '../comptaweb-credentials'`.

- [ ] **Step 3: Implement the service**

Create `web/src/lib/services/comptaweb-credentials.ts`:

```ts
// Credentials Comptaweb par groupe, stockés en BDD. Le mot de passe est
// chiffré (AES-256-GCM, cf. secret-box). Source de vérité de loadConfig, avec
// repli sur les variables d'env (transition). Pas de threading groupId en V1
// (mono-groupe) — garde-fou si > 1 ligne.
import { getDb } from '../db';
import { encryptSecret, decryptSecret } from '../crypto/secret-box';

let schemaEnsured = false;
export async function ensureComptawebCredentialsSchema(): Promise<void> {
  if (schemaEnsured) return;
  await getDb().exec(`
    CREATE TABLE IF NOT EXISTS comptaweb_credentials (
      group_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      base_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_by_user_id TEXT
    );
  `);
  schemaEnsured = true;
}

interface CredRow {
  group_id: string;
  username: string;
  password_encrypted: string;
  base_url: string | null;
  updated_at: string;
}

export async function getComptawebCredentials(): Promise<{ username: string; password: string; base_url: string | null } | null> {
  await ensureComptawebCredentialsSchema();
  const rows = await getDb().prepare('SELECT * FROM comptaweb_credentials').all<CredRow>();
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error('Plusieurs groupes ont des credentials Comptaweb : threading groupId requis (multi-groupe non supporté en V1).');
  }
  const row = rows[0];
  return { username: row.username, password: decryptSecret(row.password_encrypted), base_url: row.base_url };
}

export async function saveComptawebCredentials(
  groupId: string,
  userId: string,
  input: { username: string; password?: string },
): Promise<void> {
  await ensureComptawebCredentialsSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT password_encrypted FROM comptaweb_credentials WHERE group_id = ?').get<{ password_encrypted: string }>(groupId);

  // password fourni → on (re)chiffre ; sinon on garde l'existant (write-only).
  const passwordEncrypted = input.password
    ? encryptSecret(input.password)
    : existing?.password_encrypted;
  if (!passwordEncrypted) {
    throw new Error('Aucun mot de passe fourni et aucun existant à conserver.');
  }

  await db.prepare(
    `INSERT INTO comptaweb_credentials (group_id, username, password_encrypted, updated_at, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       username = excluded.username,
       password_encrypted = excluded.password_encrypted,
       updated_at = excluded.updated_at,
       updated_by_user_id = excluded.updated_by_user_id`,
  ).run(groupId, input.username, passwordEncrypted, now, userId);
}

export async function getComptawebCredentialsStatus(): Promise<{ configured: boolean; username: string | null; updated_at: string | null }> {
  await ensureComptawebCredentialsSchema();
  const rows = await getDb().prepare('SELECT username, updated_at FROM comptaweb_credentials').all<{ username: string; updated_at: string }>();
  if (rows.length === 0) return { configured: false, username: null, updated_at: null };
  return { configured: true, username: rows[0].username, updated_at: rows[0].updated_at };
}

export async function resolveComptawebCredentials(): Promise<{ username: string; password: string; baseUrl: string | null } | null> {
  const fromDb = await getComptawebCredentials();
  if (fromDb) return { username: fromDb.username, password: fromDb.password, baseUrl: fromDb.base_url };
  const username = process.env.COMPTAWEB_USERNAME;
  const password = process.env.COMPTAWEB_PASSWORD;
  if (username && password) return { username, password, baseUrl: process.env.COMPTAWEB_BASE_URL ?? null };
  return null;
}
```

> Note implémenteur : vérifier que `DbWrapper` expose bien `.exec(sql)` (utilisé par `ensureDepotsSchema` dans `depots.ts` — copier ce pattern). Si l'API diffère, aligne-toi sur `ensureDepotsSchema`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/comptaweb-credentials.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Brancher `loadConfig` sur la résolution**

Dans `web/src/lib/comptaweb/auth.ts`, remplacer le corps de `loadConfig` qui lit `process.env.COMPTAWEB_USERNAME/PASSWORD` directement par un appel à `resolveComptawebCredentials`. Nouveau corps :

```ts
import { performAutomatedLogin } from './auth-automated';
import { clearStoredSession, readStoredSession, writeStoredSession } from './session-store';
import { ComptawebSessionExpiredError } from './http';
import { resolveComptawebCredentials } from '../services/comptaweb-credentials';
import type { ComptawebConfig } from './types';

const DEFAULT_BASE_URL = 'https://sgdf.production.sirom.net';

export async function loadConfig(): Promise<ComptawebConfig> {
  const envBaseUrl = process.env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL;

  const stored = readStoredSession();
  if (stored) return { baseUrl: envBaseUrl, cookie: stored.cookieHeader };

  const creds = await resolveComptawebCredentials();
  if (creds) {
    const baseUrl = creds.baseUrl ?? DEFAULT_BASE_URL;
    const result = await performAutomatedLogin(creds.username, creds.password, { baseUrl });
    writeStoredSession({ cookieHeader: result.cookieHeader, capturedAt: result.capturedAt, username: creds.username });
    return { baseUrl, cookie: result.cookieHeader };
  }

  if (process.env.COMPTAWEB_COOKIE) {
    return { baseUrl: envBaseUrl, cookie: process.env.COMPTAWEB_COOKIE };
  }

  throw new Error(
    'Aucun identifiant Comptaweb. Configure-les dans /admin/parametres (ou COMPTAWEB_USERNAME + COMPTAWEB_PASSWORD).',
  );
}
```

`withAutoReLogin` (en dessous) reste inchangé. Conserver le reste du fichier.

- [ ] **Step 6: Typecheck**

Run: `cd web && ./node_modules/.bin/tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/services/comptaweb-credentials.ts web/src/lib/services/__tests__/comptaweb-credentials.test.ts web/src/lib/comptaweb/auth.ts
git commit -m "feat(comptaweb): credentials en BDD (chiffrés) + résolution loadConfig avec repli env"
```

---

## Task 3 : Server action « Enregistrer et tester » + UI settings

**Files:**
- Create: `web/src/lib/actions/comptaweb-credentials.ts`
- Modify: `web/src/app/(app)/admin/parametres/page.tsx`

**Interfaces:**
- Consumes: `saveComptawebCredentials`, `getComptawebCredentialsStatus` (Task 2) ; `loadConfig`, `clearStoredSession` (`comptaweb/auth.ts`, `comptaweb/session-store.ts`) ; `getCurrentContext`, `requireAdmin`, `logError`.
- Produces: server action `saveAndTestComptawebCredentials(formData: FormData): Promise<void>`.

Tâche avec une logique (action) testable manuellement et une UI. Garde-fous : tsc + lint + vérification manuelle.

- [ ] **Step 1: Implémenter la server action**

Create `web/src/lib/actions/comptaweb-credentials.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { requireAdmin } from '../auth/access';
import { saveComptawebCredentials } from '../services/comptaweb-credentials';
import { loadConfig } from '../comptaweb/auth';
import { clearStoredSession } from '../comptaweb/session-store';
import { logError } from '../log';

// Enregistre les identifiants Comptaweb du groupe puis teste la connexion
// (rejoue un login). Le mot de passe est write-only : champ vide = inchangé.
export async function saveAndTestComptawebCredentials(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const username = ((formData.get('username') as string | null) ?? '').trim();
  const password = (formData.get('password') as string | null) ?? '';
  if (!username) {
    redirect('/admin/parametres?cw_error=' + encodeURIComponent('Identifiant requis.'));
  }

  // 1. Enregistrer (toujours, même si le test échoue ensuite).
  try {
    await saveComptawebCredentials(ctx.groupId, ctx.userId, {
      username,
      password: password || undefined,
    });
  } catch (err) {
    logError('parametres', 'Enregistrement credentials Comptaweb échoué', err);
    redirect('/admin/parametres?cw_error=' + encodeURIComponent('Échec de l’enregistrement.'));
  }

  // 2. Tester : on repart d'une session propre pour forcer un vrai login.
  //    redirect() lève NEXT_REDIRECT → JAMAIS dans le try/catch (sinon avalé).
  clearStoredSession();
  let testOk = false;
  try {
    await loadConfig();
    testOk = true;
  } catch (err) {
    logError('parametres', 'Test connexion Comptaweb échoué', err);
    testOk = false;
  }
  revalidatePath('/admin/parametres');
  redirect('/admin/parametres?cw_saved=' + (testOk ? 'ok' : 'failed'));
}
```

- [ ] **Step 2: Ajouter la section UI dans `/admin/parametres`**

Dans `web/src/app/(app)/admin/parametres/page.tsx` :

(a) Ajouter aux imports :

```ts
import { getComptawebCredentialsStatus } from '@/lib/services/comptaweb-credentials';
import { saveAndTestComptawebCredentials } from '@/lib/actions/comptaweb-credentials';
```

(b) Étendre le type `searchParams` et charger le statut. Remplacer la signature + le chargement :

```ts
export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; cw_saved?: string; cw_error?: string }>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);
  const [groupe, cwStatus] = await Promise.all([
    getGroupe({ groupId: ctx.groupId }),
    getComptawebCredentialsStatus(),
  ]);
  const tauxEuros = ((groupe?.taux_km_millicents ?? 354) / 1000).toFixed(3).replace('.', ',');
```

(c) Ajouter, après la `<Section title="Frais kilométriques">` existante (avant la fermeture `</div>`), la nouvelle section + ses alertes. Insérer les alertes Comptaweb près des autres alertes en haut, et la section en bas :

Alertes (à placer avec les alertes existantes `params.saved`/`params.error`) :

```tsx
      {params.cw_saved === 'ok' && <Alert variant="success" className="mb-6">Identifiants Comptaweb enregistrés — connexion réussie.</Alert>}
      {params.cw_saved === 'failed' && <Alert variant="error" className="mb-6">Identifiants enregistrés, mais la connexion a échoué. Vérifie l’identifiant et le mot de passe.</Alert>}
      {params.cw_error && <Alert variant="error" className="mb-6">{params.cw_error}</Alert>}
```

Section (après « Frais kilométriques ») :

```tsx
      <Section
        title="Connexion Comptaweb"
        subtitle={
          cwStatus.configured
            ? `Configuré — identifiant ${cwStatus.username}${cwStatus.updated_at ? ` (modifié le ${cwStatus.updated_at.slice(0, 10)})` : ''}.`
            : 'Non configuré — utilise les variables d’environnement.'
        }
        className="mt-6"
      >
        <form action={saveAndTestComptawebCredentials} className="space-y-3 max-w-md">
          <Field label="Identifiant Comptaweb" htmlFor="cw_username" required>
            <Input id="cw_username" name="username" required defaultValue={cwStatus.username ?? ''} placeholder="prenom.nom@exemple.fr" />
          </Field>
          <Field label="Mot de passe" htmlFor="cw_password" hint="laisser vide pour ne pas changer">
            <Input id="cw_password" name="password" type="password" placeholder="••••••••" autoComplete="off" />
          </Field>
          <PendingButton pendingLabel="Enregistrement et test…">Enregistrer et tester</PendingButton>
        </form>
      </Section>
```

> Note implémenteur : `Section` accepte `className` (cf. son interface). Si ce n'est pas le cas, enrober dans un `<div className="mt-6">`. Les composants `Alert`, `Input`, `Field`, `PendingButton`, `Section` sont déjà importés dans la page.

- [ ] **Step 3: Typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/lib/actions/comptaweb-credentials.ts 'src/app/(app)/admin/parametres/page.tsx'`
Expected: 0 erreur.

- [ ] **Step 4: Vérification manuelle**

Prérequis : `CREDENTIALS_KEY` défini dans `web/.env.local` (`openssl rand -base64 32`).
Run: `cd web && pnpm dev` (ou `./node_modules/.bin/next dev`), se connecter en `tresorier`, aller sur `/admin/parametres` :
- Section « Connexion Comptaweb » visible, état « Non configuré » au départ.
- Saisir identifiant + mot de passe, « Enregistrer et tester » → toast/alerte succès ou échec selon les identifiants.
- Recharger : l'état affiche « Configuré — identifiant … », le champ mot de passe est vide (write-only).
- Ré-enregistrer en laissant le mot de passe vide → l'identifiant change, le mot de passe est conservé (la connexion doit toujours fonctionner).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/actions/comptaweb-credentials.ts 'web/src/app/(app)/admin/parametres/page.tsx'
git commit -m "feat(parametres): section Connexion Comptaweb (enregistrer et tester)"
```

---

## Self-Review (auteur)

**Spec coverage :**
- Table dédiée `comptaweb_credentials` chiffrée ✅ (Task 2).
- Chiffrement AES-256-GCM, clé `CREDENTIALS_KEY` ✅ (Task 1).
- `loadConfig` : session → BDD → env → erreur ✅ (Task 2, step 5).
- Garde-fou > 1 ligne ✅ (Task 2).
- UI section `/admin/parametres`, write-only, bouton « Enregistrer et tester », admin only ✅ (Task 3).
- Password jamais renvoyé au client ✅ (status sans password ; champ write-only).
- Pas de threading groupId ✅ (résolution sans paramètre).
- Tests : crypto, service (roundtrip/clair/write-only/garde-fou/résolution) ✅.

**Placeholders :** aucun TODO/TBD ; code complet à chaque step. Deux notes implémenteur (API `.exec`, `Section className`) pointent du code existant à vérifier, pas des trous.

**Type consistency :** `resolveComptawebCredentials` → `{ username, password, baseUrl }` cohérent entre service (def) et `loadConfig` (conso). `getComptawebCredentials` → `{ username, password, base_url }` (snake) cohérent entre def, test et `resolve`. `saveComptawebCredentials(groupId, userId, { username, password? })` identique entre service, test et action. `getComptawebCredentialsStatus` → `{ configured, username, updated_at }` cohérent entre service, test et UI.
