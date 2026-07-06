# Comptaweb multi-groupes (credentials + session par groupe)

**Date** : 2026-07-06
**Statut** : design proposé — en attente de relecture
**Contexte** : sous-projet **A** du chantier « onboarding assisté d'un 2ᵉ groupe » (avant B « écran créer un groupe » et C « bascule super-admin »).

## Problème

Le schéma est multi-tenant (`group_id` partout, groupe résolu via l'user connecté), mais l'accès **Comptaweb est verrouillé mono-groupe** :

1. `getComptawebCredentials()` lit `SELECT * FROM comptaweb_credentials` **sans `group_id`** et **`throw` s'il y a > 1 ligne** (`comptaweb-credentials.ts:33-35`). → Ajouter un 2ᵉ groupe **casse même le tien**.
2. `resolveComptawebCredentials()` retombe sur les env vars **globales** `COMPTAWEB_USERNAME/PASSWORD` — un seul compte CW pour toute l'instance.
3. La **session Comptaweb** stockée (`session-store.ts`, fichier unique `comptaweb-session.json`) est **globale à l'instance**. Deux groupes = deux comptes CW = deux sessions → collision (le groupe B réutiliserait la session/cookie du groupe A).

Sans lever ces 3 points, un 2ᵉ groupe ne peut pas se synchroniser avec SON Comptaweb.

## Objectif

Chaque groupe utilise **ses propres credentials Comptaweb et sa propre session**, de bout en bout (UI de config → résolution creds → login → session cache → sync). Aucune régression pour Val de Saône (creds déjà en BDD).

## Design

### 1. Session par groupe (`session-store.ts`)
Le fichier de cache session est **keyé par `groupId`** : `comptaweb-session-<groupId>.json` (au lieu du fichier unique). Les 3 fonctions prennent `groupId` :
- `readStoredSession(groupId)`, `writeStoredSession(groupId, session)`, `clearStoredSession(groupId)`.
Sur Vercel, toujours dans `/tmp` (éphémère), un fichier par groupe. Slug de `groupId` sûr pour un nom de fichier (les group_id sont des slugs).

### 2. Credentials threadés par groupe (`comptaweb-credentials.ts`)
- `getComptawebCredentials(groupId)` → `SELECT * FROM comptaweb_credentials WHERE group_id = ?` → 0 ou 1 ligne. **Retrait du `throw` multi-lignes.**
- `getComptawebCredentialsStatus(groupId)` → idem, filtré.
- `resolveComptawebCredentials(groupId)` :
  1. Creds BDD du groupe → utilisées.
  2. Sinon **fallback env sécurisé** : les env `COMPTAWEB_USERNAME/PASSWORD` ne s'appliquent **que** si `groupId === process.env.COMPTAWEB_ENV_GROUP_ID` (nouvelle var, = le groupe legacy si besoin). Sans cette var, **pas de fallback env** → un nouveau groupe ne peut JAMAIS hériter des creds env d'un autre. (Val de Saône a ses creds en BDD → le fallback ne le concerne pas.)
- `saveComptawebCredentials(groupId, userId, …)` : inchangé (déjà par groupe).

### 3. Auth threadée (`auth.ts`)
- `loadConfig(groupId)` : `readStoredSession(groupId)` → `resolveComptawebCredentials(groupId)` → `performAutomatedLogin` → `writeStoredSession(groupId, …)`. Le fallback `COMPTAWEB_COOKIE` (dev/legacy) est **aussi gaté** par `COMPTAWEB_ENV_GROUP_ID`.
- `withAutoReLogin(groupId, fn)` : `loadConfig(groupId)` ; sur `ComptawebSessionExpiredError` → `clearStoredSession(groupId)` + `loadConfig(groupId)`.

### 4. Propagation du `groupId` aux appelants (ripple)
Tous les appelants de `withAutoReLogin` / `loadConfig` / `resolve|get|statusComptawebCredentials` tournent **déjà dans un contexte groupe** (`sync_run` est par groupe ; MCP `McpContext.groupId` ; actions via `getCurrentContext`). On threade `groupId` à travers :
`sync-cycle.ts`, `drafts.ts`, `caisse-sync.ts`, `ecritures-create.ts`, `caisse-scrape.ts`, `actions/referentiels.ts`, `actions/comptaweb-credentials.ts`, `mcp/tools/{sync-referentiels,comptaweb-client}.ts`, `comptaweb/index.ts` (~10 fichiers, ~31 refs). Le renommage de signature fait remonter chaque site via `tsc` (comme le chantier multi-unités).

### Message d'erreur
« Aucun identifiant Comptaweb » devient spécifique au groupe : « Ce groupe n'a pas d'identifiants Comptaweb — configure-les dans … ».

## Sécurité / invariants
- **Isolation stricte** : un groupe ne peut jamais lire les creds ni la session d'un autre (filtre `group_id` partout, session fichier par groupe, fallback env gaté).
- Mot de passe toujours chiffré (AES-256-GCM, inchangé), jamais loggé.
- Pas de suppression de données ; `comptaweb_credentials` reste keyée par `group_id` (déjà le cas).

## Hors périmètre (sous-projets B et C)
- Écran « créer un groupe » + super-admin (B).
- Bascule de groupe / impersonation (C).
- Migration de Val de Saône : **aucune** — ses creds sont déjà en BDD.

## Tests (TDD)
1. **Isolation creds** : 2 groupes avec des creds distincts → `getComptawebCredentials('gA')` renvoie A, `'gB'` renvoie B ; jamais de fuite. Plus de `throw` avec 2 lignes.
2. **Groupe sans creds** : `resolveComptawebCredentials('gVierge')` → `null` (pas les creds d'un autre), et **pas** le fallback env si `COMPTAWEB_ENV_GROUP_ID` ≠ 'gVierge'.
3. **Fallback env gaté** : env set + `COMPTAWEB_ENV_GROUP_ID='gA'` → `resolve('gA')` sans BDD = env ; `resolve('gB')` = null.
4. **Session par groupe** : `writeStoredSession('gA', …)` n'affecte pas `readStoredSession('gB')` (fichiers distincts).
5. **Status par groupe** : `getComptawebCredentialsStatus(groupId)` reflète le bon groupe.
6. **Non-régression** : un seul groupe avec creds BDD → comportement identique à aujourd'hui.

## Fichiers touchés
- `comptaweb/session-store.ts`, `comptaweb/auth.ts`, `services/comptaweb-credentials.ts` (cœur).
- Appelants (~10, threading `groupId`) : cf. §4.
- `actions/comptaweb-credentials.ts` + page `/import` : `getComptawebCredentialsStatus(ctx.groupId)`.
