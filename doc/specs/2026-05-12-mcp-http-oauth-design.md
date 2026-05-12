# Spec — MCP HTTP hébergé avec OAuth 2.0 (distribution multi-trésoriers)

**Date** : 2026-05-12
**Statut** : design validé, prêt à plan d'impl
**Sous-projet** : 2/N du chantier « MCP trésorier 90% autonome ». Pivot stratégique : on quitte le MCP stdio local (réservé au dev) pour un MCP HTTP hébergé sur Vercel, distribuable à n'importe quel trésorier sans dépendance machine.

---

## Contexte

Le précédent sous-projet ([2026-05-12-mcp-tresorier-inbox-cleanup](2026-05-12-mcp-tresorier-inbox-cleanup-design.md)) a livré 9 routes API et 9 tools MCP. Mais ces tools tournent dans un serveur **stdio local** (`compta/src/index.ts` lancé via `tsx`), ce qui exige :
- Node.js + le code source en local
- Un fichier `.env` avec un token API
- Une édition manuelle de `claude_desktop_config.json`

C'est inutilisable pour un trésorier non-dev. La doctrine produit (cf. roadmap : ouverture aux co-trésoriers, parents organisateurs, chefs d'unité) impose qu'**ajouter Baloo dans Claude Desktop** soit aussi simple que coller une URL et cliquer sur un bouton de login.

Le SDK `@modelcontextprotocol/sdk@1.29.0` (déjà installé) supporte le **Streamable HTTP transport** + un protocole d'auth OAuth 2.0 standardisé pour clients MCP publics. C'est ce que cible cette spec.

## Objectifs

1. Permettre à n'importe quel utilisateur authentifié sur baloo.benomite.com d'**ajouter Baloo à Claude Desktop** en 3 clics : coller URL, login, confirmer.
2. Exposer les tools MCP existants via HTTP, sans dupliquer la logique métier.
3. **Supprimer le MCP stdio** (`compta/`) après transition complète. Toi-même (dev) tu utiliseras le HTTP en pointant `http://localhost:3000/api/mcp`.
4. Conserver les garde-fous existants : auth solide, filtrage `group_id`, scoping `role` / `scopeUniteId`.

## Non-objectifs (V1)

- **Refresh tokens** : on émet des access tokens long-lived (30 jours). L'user re-authentifie ensuite. Refresh token = V2.
- **Scopes granulaires** : un seul scope `treso` en V1 (= tout ce que le user peut faire selon son rôle BDD). Granularité (`treso:read`, `treso:write`, `treso:admin`) = V2.
- **Multi-clients identifiés** : on accepte Dynamic Client Registration (DCR) pour n'importe quel client OAuth, on ne pré-enregistre pas spécifiquement Claude Desktop.
- **Upload de fichier local** : le tool `upload_justificatif_orphan` disparaît du MCP (impossible en HTTP server-side). Le trésorier upload via la webapp `/inbox` en drag-drop.
- **Admin panel global des connexions OAuth** : V1 = chaque user gère ses propres connexions sur `/moi/connexions`. Un admin global pourra venir plus tard si nécessaire.

## Doctrine

- **Codebase unique** : MCP server + OAuth server + webapp = un seul repo `web/`. Compta/ disparaît.
- **Services métier inchangés** : les tools MCP appellent directement les services (`@/lib/services/...`), pas l'API HTTP. Économie de latence + cohérence des erreurs.
- **Auth réutilisée** : NextAuth pour la session user (cookie), Bearer token OAuth pour les requêtes MCP. Le système `api_tokens` existant peut être conservé pour les besoins purement back-end (cron, scripts), mais n'est plus la voie d'auth pour Claude Desktop.

## Architecture

### Composants

```
Claude Desktop  ──┐
                  ▼
        ┌────────────────────────────────────────────────┐
        │  baloo.benomite.com                            │
        │                                                │
        │  /.well-known/oauth-authorization-server  ◄─┐  │
        │  /.well-known/oauth-protected-resource    ◄─┤  │
        │  /oauth/register   (DCR)                  ◄─┤  │
        │  /oauth/authorize  (UI, session NextAuth) ◄─┤  │
        │  /oauth/token      (échange code → token) ◄─┘  │
        │  /oauth/revoke     (révocation manuelle)       │
        │                                                │
        │  /api/mcp          (Streamable HTTP transport) │
        │       │                                        │
        │       ▼                                        │
        │  registerAllTools(server, ctx)                 │
        │       │                                        │
        │       ▼                                        │
        │  services/* (déjà existants)                   │
        └────────────────────────────────────────────────┘
```

### Tables BDD nouvelles

Toutes sans CHECK SQL (cf. doctrine ADR-019), créées via `business-schema.ts` avec `CREATE TABLE IF NOT EXISTS`. Pas de migration `ALTER` (tables neuves).

```sql
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,                  -- format cli_xxx
  client_id TEXT NOT NULL UNIQUE,       -- public identifier renvoyé à Claude
  client_name TEXT NOT NULL,            -- 'Claude Desktop', 'Custom MCP Client', etc.
  redirect_uris TEXT NOT NULL,          -- JSON array, validés au flow
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,           -- SHA-256 du code émis
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,         -- PKCE
  code_challenge_method TEXT NOT NULL,  -- 'S256'
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,             -- 2 minutes après création
  used_at TEXT,                         -- single-use : si non NULL → code déjà échangé
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,          -- SHA-256 du access_token
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at TEXT NOT NULL,             -- 30 jours
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id);
```

**Pourquoi hasher les codes/tokens** : pas de fuite si la BDD est compromise (cf. doctrine `api_tokens` existante qui stocke aussi des hashes).

### Endpoints OAuth

**`GET /.well-known/oauth-authorization-server`** — metadata standard RFC 8414 :

```json
{
  "issuer": "https://baloo.benomite.com",
  "authorization_endpoint": "https://baloo.benomite.com/oauth/authorize",
  "token_endpoint": "https://baloo.benomite.com/oauth/token",
  "revocation_endpoint": "https://baloo.benomite.com/oauth/revoke",
  "registration_endpoint": "https://baloo.benomite.com/oauth/register",
  "scopes_supported": ["treso"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"]
}
```

**`GET /.well-known/oauth-protected-resource`** — RFC 9728 (resource metadata) :

```json
{
  "resource": "https://baloo.benomite.com/api/mcp",
  "authorization_servers": ["https://baloo.benomite.com"],
  "scopes_supported": ["treso"],
  "bearer_methods_supported": ["header"]
}
```

**`POST /oauth/register`** — Dynamic Client Registration (RFC 7591), public client :

Request :
```json
{
  "client_name": "Claude Desktop",
  "redirect_uris": ["http://localhost:33418/callback", "claude://..."],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code"],
  "response_types": ["code"]
}
```

Response (201) :
```json
{
  "client_id": "cli_xyz...",
  "client_name": "Claude Desktop",
  "redirect_uris": ["..."],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code"]
}
```

Aucun `client_secret` (public client PKCE).

**`GET /oauth/authorize`** — page web qui :

1. Lit les query params : `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `scope=treso`, `state`.
2. Valide que le `client_id` existe en BDD et que `redirect_uri` est dans ses `redirect_uris` enregistrés.
3. Récupère la session NextAuth. Si pas loguée → redirect `/login?callbackUrl=/oauth/authorize?...`.
4. Affiche une page de consentement : « **Claude Desktop** veut accéder à ton compte Baloo (Val de Saône). Permissions demandées : trésorerie complète. [Autoriser] [Refuser] ».
5. Sur **Autoriser** : génère un `code` aléatoire 32 bytes, hashe SHA-256, insère dans `oauth_authorization_codes` avec `expires_at = now + 2 min`. Redirect vers `redirect_uri?code=<code>&state=<state>`.
6. Sur **Refuser** : redirect `redirect_uri?error=access_denied&state=<state>`.

**`POST /oauth/token`** — échange code contre token :

Request (form-encoded) :
```
grant_type=authorization_code
code=<code>
redirect_uri=<must match>
client_id=<must match>
code_verifier=<plain string, PKCE>
```

Logique :
1. Hash le `code` (SHA-256), lookup dans `oauth_authorization_codes`.
2. Vérifie `expires_at > now`, `used_at IS NULL`, `client_id` match, `redirect_uri` match.
3. Vérifie PKCE : `SHA256(code_verifier) == code_challenge` (en base64url).
4. Marque `used_at = now` (single-use).
5. Génère un `access_token` aléatoire 32 bytes (préfixe `boa_` = baloo oauth access), hashe et stocke en BDD avec `expires_at = now + 30j`.
6. Renvoie :

```json
{
  "access_token": "boa_xxx...",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "treso"
}
```

Erreurs : 400 `invalid_grant` si code expiré/utilisé/invalide.

**`POST /oauth/revoke`** — RFC 7009. Body `token=<access_token>`. Set `revoked_at = now`. 200 même si token déjà inexistant (pas de fuite d'info).

### Endpoint MCP

**`POST /api/mcp`** et **`GET /api/mcp`** (selon transport streamable HTTP).

Auth :
- Header `Authorization: Bearer <access_token>`
- Hash le token, lookup `oauth_access_tokens`, vérifie `expires_at > now`, `revoked_at IS NULL`.
- Met à jour `last_used_at`.
- Récupère le user en BDD via `user_id`, hydrate le contexte `{ userId, groupId, role, scopeUniteId }`.

Si auth échoue : 401 avec `WWW-Authenticate: Bearer resource_metadata="https://baloo.benomite.com/.well-known/oauth-protected-resource"` (RFC 9728, permet à Claude Desktop de redéclencher le flow OAuth).

Sinon : instancie un `McpServer`, enregistre tous les tools via `registerAllTools(server, ctx)`, et délègue au `StreamableHTTPServerTransport`. Le SDK gère le reste (negotiation, batching, streaming).

### Tools migrés

Sous `web/src/lib/mcp/tools/` (nouveau dossier), un fichier par domaine. Chaque tool a la signature :

```ts
export function registerXxxTools(server: McpServer, ctx: McpContext) {
  server.tool('tool_name', 'description', schema, async (params) => {
    const result = await someService(ctx, params);  // appel direct au service
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });
}
```

Domaines à migrer (depuis `compta/src/tools/`) :

| Fichier source compta/ | Tools | Devient web/src/lib/mcp/tools/ |
|---|---|---|
| `reference.ts` | list_categories, list_unites, list_modes_paiement, list_activites | `reference.ts` |
| `overview.ts` | vue_ensemble | `overview.ts` |
| `ecritures.ts` | list_ecritures, create_ecriture, update_ecriture | `ecritures.ts` |
| `remboursements.ts` | list/create/update_remboursement | `remboursements.ts` |
| `abandons.ts` | list/create/update_abandon | `abandons.ts` |
| `caisse.ts` | list/create mouvements + sync caisse | `caisse.ts` |
| `cheques.ts` | list/create depots cheques | `cheques.ts` |
| `depots-especes.ts` | list/create/rapprocher depots especes | `depots-especes.ts` |
| `justificatifs.ts` | attach_justificatif, list_justificatifs | `justificatifs.ts` |
| `comptaweb.ts` | import csv, scan/sync drafts, cw_create_*, cw_referentiels_*, cw_cleanup_* | `comptaweb.ts` |
| `comptaweb-client.ts` | cw_list_rapprochement_bancaire | `comptaweb-client.ts` |
| `recherche.ts` | recherche | `recherche.ts` |
| `todos.ts` | list/create/update/complete todos | `todos.ts` |
| `personnes.ts` | list/create/update personnes | `personnes.ts` |
| `notes.ts` | list/create/update/delete notes | `notes.ts` |
| `comptes.ts` | list/create/update comptes bancaires | `comptes.ts` |
| `cartes.ts` | list/create/update cartes | `cartes.ts` |
| `budgets.ts` | list/create budgets + lignes | `budgets.ts` |
| `groupes.ts` | get_groupe, update_groupe | `groupes.ts` |
| `inbox.ts` (NEW) | inbox_list_orphan_*, inbox_suggest_matches, inbox_link, inbox_auto_match | `inbox.ts` |
| `upload-orphan.ts` (NEW) | **SUPPRIMÉ** | (n/a) |

Soit ~24 fichiers à porter, ~60 tools au total.

**Refactor pattern** : `await fetch('/api/x')` devient `await someService(ctx, params)`. Plus rapide, plus simple à tester. Les tools de scraping Comptaweb (qui utilisent le client `lib/comptaweb/`) marchent déjà côté web/ — pas de changement.

Note `attach_justificatif` : il acceptait un `source_path` local. En HTTP, on le **modifie** pour accepter soit (a) un base64 court (< 1 Mo, pour de petites factures), soit (b) on le supprime aussi (l'attach se fait via drag-drop webapp). Décision V1 : on supprime aussi `attach_justificatif`. Le tréso passe par la webapp pour les uploads. C'est cohérent avec la suppression d'`upload_justificatif_orphan`.

### UI gestion des connexions

**Page `/moi/connexions`** (nouvelle) :

- Liste des access tokens actifs de l'user (client_name, created_at, last_used_at, expires_at)
- Bouton « Révoquer » sur chaque ligne → POST `/oauth/revoke` interne + redirect
- En haut, un encart « Connecter une nouvelle app » avec :
  - URL à copier : `https://baloo.benomite.com/api/mcp`
  - Instructions courtes : « Dans Claude Desktop > Settings > Connectors > Add custom connector, colle l'URL. Tu seras renvoyé sur baloo pour confirmer. »
  - Schéma : 3 étapes en pictos

Pas de bouton « Générer un token manuel » en V1 — seul OAuth fait foi (KISS).

### Suppression du MCP stdio

Une fois le HTTP en prod et testé E2E :

1. Modifier `.mcp.json` (projet) :
```json
{
  "mcpServers": {
    "compta": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```
Claude Code supporte les MCPs HTTP nativement (déjà utilisé par `airtable` dans ta config). Pour Claude Code, le flow OAuth s'ouvre dans le browser à la première utilisation.

2. Supprimer le dossier `compta/` entier (commit dédié).

3. Mettre à jour `CLAUDE.md` (référence aux outils MCP `compta`).

## Auth et sécurité

- **Hash de tokens en BDD** : SHA-256 du token clair (pas de salt nécessaire pour des tokens 32 bytes aléatoires, l'entropie est suffisante).
- **HTTPS only** en prod : Vercel impose. En dev local (`http://localhost:3000`), c'est OK car le flow OAuth est local-only.
- **CORS** : le endpoint `/api/mcp` accepte Bearer tokens, donc pas de cookies CSRF à protéger. Header `Access-Control-Allow-Origin: *` raisonnable. Les endpoints OAuth `/oauth/*` n'acceptent pas de cross-origin (browser nav direct).
- **Rate limiting** : pas en V1. À ajouter si abus constaté.
- **Audit log** : `last_used_at` mis à jour à chaque appel MCP. Suffisant pour V1.
- **Token leak** : si un token fuite, l'user le révoque depuis `/moi/connexions`. À documenter dans la page d'aide.

## Tests

- **Modules purs** (testés en vitest) :
  - `web/src/lib/oauth/pkce.ts` (calcul du challenge S256 à partir du verifier) — module pur, testable
  - `web/src/lib/oauth/token-encoding.ts` (génération + hash des tokens) — pur
- **Routes OAuth + MCP** : vérification manuelle (curl + Claude Desktop), comme tout le reste du projet.
- **Scénario E2E** :
  1. Tu génères une autorisation depuis Claude Desktop (tu en es le client).
  2. Tu valides toutes les opérations courantes (vue_ensemble, list_remboursements, etc.).
  3. Tu fais tester un cobaye non-dev sur un compte test (compte de l'asso si tu en as un, sinon un user de dev).

## Migration et déploiement

Phasage propre :

**Phase 1** (peut shipper indépendamment) : OAuth Authorization Server + UI `/moi/connexions`. Pas encore de route `/api/mcp`. Permet aux users de générer des tokens OAuth, qu'on peut utiliser depuis n'importe quoi.

**Phase 2** : route `/api/mcp` qui valide les tokens et expose ~5 tools de référence (overview, ecritures, recherche). Permet de valider l'archi MCP HTTP sur un perimètre réduit.

**Phase 3** : port complet de tous les tools (60+).

**Phase 4** : suppression de `compta/`, mise à jour `.mcp.json`.

Chaque phase = un PR potentiel.

Une fois Phase 4 mergée, un dump de la roadmap dans `doc/roadmap.md` pour marquer le tournant.

## Risques et points ouverts

- **Spec MCP OAuth en évolution** : le standard MCP 2025-06-18 a évolué (vs 2024-11-05 plus restrictif). Vérifier la version exacte que Claude Desktop attend au moment de l'impl. Le SDK 1.29.0 devrait couvrir 2025-06-18.
- **Dynamic Client Registration côté Claude Desktop** : à vérifier que Claude Desktop fait bien la DCR automatiquement (sinon il faudra pré-enregistrer un client static). Test en local pendant l'impl.
- **NextAuth + OAuth server custom** : NextAuth assume qu'il est l'OAuth provider unique. Notre AS custom coexiste avec NextAuth (qui sert la session web). Bien isoler les deux (préfixes de routes, pas de collision).
- **Limite Vercel Functions 4MB body** : pour les tools qui retournent beaucoup de données (ex: `list_ecritures` sur 6 mois), penser à paginer. Mais c'est déjà géré par les services existants.
- **Cold start MCP** : chaque requête `/api/mcp` instancie un `McpServer`. Léger en pratique (la registration de 60 tools = ms). À mesurer si ça devient un problème.
- **Compatibilité services qui exigent un cookie session NextAuth** : certains services (notamment ceux qui touchent à `auth/api-tokens.ts`) peuvent exiger un contexte plus large. À auditer au passage.

## Suite

Une fois validation user :

1. Invoquer la skill `writing-plans` pour générer un plan d'impl phasé (Phase 1-2-3-4 ci-dessus).
2. Implémenter Phase 1 d'abord (commit + push + test) avant d'enchaîner Phase 2.
3. Sub-projet suivant après la Phase 4 : revenir au plan original (Admin & invitations, budgets compléments, synthèse drill-down, clôture).
