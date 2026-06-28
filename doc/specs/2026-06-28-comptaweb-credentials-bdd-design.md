# Connexion Comptaweb éditable : credentials en BDD (par groupe, chiffrés) — design

> Demandé le 2026-06-28. Rend les identifiants Comptaweb modifiables par le trésorier depuis l'app, au lieu d'être figés dans les variables d'environnement Vercel. Amorce concrète de la phase 6a de la roadmap (rattachement Comptaweb au groupe).

## Contexte

Aujourd'hui, les identifiants Comptaweb sont des **variables d'environnement** (`COMPTAWEB_USERNAME` / `COMPTAWEB_PASSWORD` / `COMPTAWEB_BASE_URL`), lues par `loadConfig()` (`web/src/lib/comptaweb/auth.ts`). Conséquences : non modifiables sans toucher la config Vercel, et globales à l'instance (un seul Comptaweb). Le cookie de session après login est mis en cache dans `/tmp` (éphémère, TTL 8h) — **ce mécanisme de cache ne change pas** ; on ne modifie que la **source** des credentials.

## Objectif

Stocker les identifiants Comptaweb **par groupe, en BDD, chiffrés**, et permettre aux admins (trésorier/RG) de les saisir / modifier / tester depuis `/admin/parametres`. `loadConfig` lit la BDD en priorité, avec repli sur les variables d'env (transition douce).

## Non-objectifs (V1)

- **Pas de threading `groupId`** à travers les 16 fichiers appelant `loadConfig`/`withAutoReLogin`. On reste mono-groupe : `loadConfig` résout l'unique jeu de credentials. Le threading viendra avec l'ouverture multi-groupe (phase 6).
- Pas de credentials par utilisateur (décision : rattachés **au groupe**).
- `base_url` reste optionnel (défaut national) — pas d'UI dédiée pour le changer en V1 (colonne présente, non exposée).

## Architecture

### 1. Stockage — table `comptaweb_credentials`

Table dédiée (isole le secret de la table `groupes`) :

| Colonne | Type | Note |
|---|---|---|
| `group_id` | TEXT PK, FK `groupes(id)` | un jeu par groupe |
| `username` | TEXT NOT NULL | identifiant (clair — ce n'est pas un secret) |
| `password_encrypted` | TEXT NOT NULL | chiffré AES-256-GCM |
| `base_url` | TEXT | nullable → défaut `https://sgdf.production.sirom.net` |
| `updated_at` | TEXT | |
| `updated_by_user_id` | TEXT | traçabilité |

Lazy-init via le service (pattern `ensureXSchema`, cf. `web/AGENTS.md`), ou ajout au schéma déclaratif — à aligner sur la convention du fichier touché.

### 2. Chiffrement — `lib/crypto/secret-box.ts`

Module pur, sans dépendance BDD :
- `encryptSecret(plaintext: string): string` — AES-256-GCM, IV aléatoire 12 octets, clé depuis `process.env.CREDENTIALS_KEY` (base64, 32 octets). Retourne `iv.authTag.ciphertext` (chaque segment en base64).
- `decryptSecret(stored: string): string` — inverse ; toute altération du ciphertext/tag → l'auth GCM échoue (throw).
- Si `CREDENTIALS_KEY` est absente ou mal dimensionnée → erreur explicite.
- Le mot de passe n'est **jamais** stocké/loggé en clair, ni commité.

### 3. Service — `lib/services/comptaweb-credentials.ts`

- `getComptawebCredentials(): Promise<{ username: string; password: string; base_url: string | null } | null>` — lit la table, déchiffre le password. Garde-fou : si **plusieurs** lignes existent (futur multi-groupe), throw « threading groupId requis » (jamais atteint en mono-groupe).
- `saveComptawebCredentials(groupId, userId, { username, password? }): Promise<void>` — chiffre le password (s'il est fourni) et **upsert** ; si `password` est vide/omis, ne touche pas au password existant (write-only). Jamais de DELETE.
- `getComptawebCredentialsStatus(): Promise<{ configured: boolean; username: string | null; updated_at: string | null }>` — pour l'UI, **sans** le password.

### 4. Résolution — `loadConfig` (`auth.ts`)

Ordre : session `/tmp` valide (inchangé) → sinon `getComptawebCredentials()` (BDD) → sinon variables d'env (`COMPTAWEB_USERNAME/PASSWORD`, comportement actuel) → sinon erreur. `base_url` : ligne BDD sinon `COMPTAWEB_BASE_URL` sinon défaut. Le login automatisé (`performAutomatedLogin`) est inchangé.

### 5. UI — Section « Connexion Comptaweb » dans `/admin/parametres`

- Affiche l'état via `getComptawebCredentialsStatus` : « Configuré — identifiant `xxx` (modifié le …) » ou « Non configuré — utilise les variables d'environnement ».
- Formulaire : identifiant (prérempli avec l'existant) + mot de passe (**write-only** : placeholder « laisser vide pour ne pas changer », jamais réaffiché).
- Bouton unique **« Enregistrer et tester »** : une server action (admin only) qui (1) chiffre + upsert les credentials, puis (2) rejoue `performAutomatedLogin` avec les credentials enregistrés et renvoie succès/échec (toast). Les credentials sont **enregistrés même si le test échoue** (le test est informatif) ; le message distingue « enregistré et connexion OK » de « enregistré mais connexion échouée : <raison> ».
- Accès réservé `tresorier` / `RG`.

## Error handling

- `CREDENTIALS_KEY` absente → erreur claire au chiffrement/déchiffrement (pas de crash silencieux).
- Test de connexion en échec → message d'erreur lisible (identifiants invalides vs Comptaweb injoignable), sans exposer le password.
- Déchiffrement impossible (clé changée) → les credentials sont considérés invalides → repli env / invitation à ressaisir.

## Sécurité / RGPD

- Password chiffré en BDD (AES-256-GCM), clé en variable d'env Vercel (jamais en BDD ni git).
- Password **write-only** côté UI, jamais renvoyé au client, jamais loggé.
- Accès et modification réservés aux admins.
- `username` (souvent un email) stocké en clair : identifiant, pas un secret — acceptable.

## Tests

- `secret-box` : roundtrip `decrypt(encrypt(x)) === x` ; altération du ciphertext → throw ; clé absente → erreur. (vitest pur, clé de test injectée via env.)
- `getComptawebCredentials` : BDD prioritaire, garde-fou multi-lignes — test in-memory.
- `loadConfig` : résolution BDD → fallback env (mock du service + env). 
- UI : vérification manuelle (saisie, test connexion, write-only).

## Déploiement

- **Nouvelle variable d'env Vercel `CREDENTIALS_KEY`** à ajouter avant déploiement (génération : `openssl rand -base64 32`). Sans elle, le chiffrement échoue — mais le repli env garde le comportement actuel tant qu'aucun credential BDD n'est saisi.
- Pas de migration de données : Benoît saisit ses identifiants via l'UI après déploiement ; tant qu'il ne l'a pas fait, le repli env assure la continuité.

## Hors V1 (reporté)

Threading `groupId` à `loadConfig`/`withAutoReLogin` (multi-groupe, phase 6), credentials par utilisateur, UI de changement de `base_url`.
