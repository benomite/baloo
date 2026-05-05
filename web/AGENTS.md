<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Pièges techniques rencontrés en prod

Mémo des bugs subtils qui ont planté la prod et la façon de les éviter. À jour : 2026-05-04.

## Next 16

### `'use server'` ≠ helpers serveur
Tout export d'un fichier marqué `'use server'` est traité comme une **server action serializable** exposée au client. Les helpers de lecture côté serveur (genre `isWelcomeBannerDismissed()`) ne doivent **pas** vivre dans un fichier `'use server'`, sinon Next plante au runtime prod (le dev / build local sont plus permissifs).

- ✅ `lib/actions/foo.ts` (`'use server'`) → server actions appelées depuis `<form action={...}>`.
- ✅ `lib/foo-helpers.ts` (sans `'use server'`) → helpers de lecture, importés par les server components.
- ❌ Mélanger les deux dans le même fichier.

Vu le bug : commit `80aeae4` (fix `isWelcomeBannerDismissed` qui plantait la home).

### `force-dynamic` quand la page utilise cookies / headers / auth
Par défaut, Next 16 tente de **prérendre statiquement** les pages. Si la page utilise `cookies()`, `headers()`, ou `auth()` (NextAuth), ça plante au build avec `Dynamic server usage: Route X couldn't be rendered statically because it used 'headers'`. La trace pète **silencieusement** au build et la prod retourne un 500.

Pour les pages dynamiques par nature (auth, lecture cookie), ajouter au top du fichier :

```ts
export const dynamic = 'force-dynamic';
```

Vu le bug : commit `58c448a` (home).

## Vercel

### Filesystem read-only sauf `/tmp`
`/var/task` (le code déployé) est **lecture seule** sur Vercel. Toute écriture côté serveur doit aller dans `/tmp` — qui est **éphémère** par invocation lambda (perdu au cold start, mais conservé tant que la lambda reste chaude).

Conséquence : pas de cache filesystem persistant côté serveur. Pour persister inter-cold-start, passer par la BDD ou un blob store.

Vu le bug : commit `ee67804` (cache session Comptaweb dans `/tmp`).

### Détection
Variable `process.env.VERCEL` est définie automatiquement sur Vercel (valeur `'1'`). Utile pour switcher des paths.

```ts
const DATA_DIR = process.env.VERCEL ? '/tmp' : resolve(__dirname, '../../data');
```

### Logs CLI quasi inutilisable
`vercel logs <url>` ne retourne que les **nouveaux** logs en streaming, jamais l'historique. Pour debugger un crash passé, le mieux est d'avoir un journal d'erreurs interne (cf. `/admin/errors` + `logError()` dans `lib/log.ts`).

## libsql / Turso

### `ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT` parfois refusé
Selon la version de libsql remote, `ALTER TABLE foo ADD COLUMN status TEXT NOT NULL DEFAULT 'a_traiter'` peut planter. **Convention** : ajouter la colonne nullable + backfill explicite, garder le `NOT NULL` au `CREATE TABLE` initial pour les BDDs vierges.

```sql
-- ✅ idempotent
ALTER TABLE foo ADD COLUMN status TEXT DEFAULT 'a_traiter';
UPDATE foo SET status = 'a_traiter' WHERE status IS NULL;
```

Vu le bug : commit `408d6b9` (workflow abandons).

### `CREATE INDEX` doit venir APRÈS l'`ALTER TABLE` qui crée la colonne
Dans `business-schema.ts`, le `CREATE TABLE IF NOT EXISTS` est un **no-op** sur les BDDs existantes. Donc une nouvelle colonne ajoutée au schéma déclaratif ne sera pas créée par cette voie. Si un `CREATE INDEX` qui suit immédiatement référence cette nouvelle colonne, il plante avec `no such column: X`.

Convention :
- Définition complète au `CREATE TABLE` dans `business-schema.ts`.
- Migration `ALTER TABLE ADD COLUMN` dans `auth/schema.ts` (qui tourne après).
- `CREATE INDEX` sur la nouvelle colonne **dans `auth/schema.ts` après l'ALTER**, **pas** dans `business-schema.ts`.

Vu le bug : commit `408d6b9` (CREATE INDEX `idx_abandons_status` qui plantait `ensureBusinessSchema` → cassait l'auth en boucle).

### Tables lazy-init via service
Certaines tables (`depots_justificatifs`) ne sont **pas** dans `business-schema.ts` mais créées par leur service en lazy-init :

```ts
// lib/services/depots.ts
let schemaEnsured = false;
export async function ensureDepotsSchema(): Promise<void> {
  if (schemaEnsured) return;
  // CREATE TABLE IF NOT EXISTS depots_justificatifs ...
  schemaEnsured = true;
}
```

Si tu fais une query directe sur la table sans passer par le service (par ex. depuis une page qui ne fait que `getAdminCounts`), il faut **appeler `ensureXSchema()` toi-même** sinon la table peut ne pas exister. Toujours exporter ces helpers.

Vu le bug : commit `58c448a` (home `getAdminCounts` qui tapait `depots_justificatifs` sans ensure).

### CHECK SQL `users.statut`
La table `users` a une CHECK existante :

```sql
statut TEXT NOT NULL DEFAULT 'actif' CHECK(statut IN ('actif', 'suspendu', 'invite', 'ancien'))
```

Pas de valeur `'inactif'` autorisée — utiliser `'ancien'` pour désactiver un membre qui a quitté le groupe. Convention validée car `personnes` utilise déjà cette valeur.

Vu le bug : commit `6953b31` (gestion membres qui tentait `'inactif'`).

### CHECK SQL en général : à éviter pour les workflows
Pour les nouvelles tables avec des champs `status` / workflow, **ne PAS** mettre de CHECK SQL. La validation des valeurs et des transitions vit côté code (cf. ADR-019, ADR-022). Sinon ajouter un nouveau status nécessite une migration de table (DROP CHECK n'existe pas en SQLite, recréation complète obligatoire).

### Backticks dans commentaires SQL d'un template literal TS
Le bloc SQL de `business-schema.ts` est un template literal :

```ts
await db.exec(`
  -- abandons_frais : avec submitted_by_user_id intégré, status...
  CREATE TABLE IF NOT EXISTS abandons_frais (...)
`);
```

Si un commentaire SQL contient un backtick (par exemple en mettant un nom de colonne entre `` ` ``), le template literal TS se ferme prématurément et le code ne compile plus. Utiliser apostrophes ou guillemets simples dans les commentaires SQL.

Vu le bug : commit `1253841` (commentaire avec `` `donateur` `` qui cassait TS).

## Import CSV Comptaweb

Tout le pipeline d'import (`lib/services/comptaweb-import.ts`) a un piège
fondamental : le CSV peut produire **plusieurs ventilations distinctes
au même tuple** `(date, amount, type, piece, description)` qui ne se
différencient que par la **catégorie**. Tout matching qui ignore `cat`
fusionne ces ventilations et perd des données. Tout matching qui
ignore une autre dimension (description, piece) idem.

### Matching cascade UPSERT
L'ordre des lookups dans `upsertEcriture` est critique :

```ts
const existing =
  (await findExact.get(...)) ||              // tout égal y compris cat
  (args.piece ? findByPieceCat(...) : null) || // piece+cat (piece NON null)
  (args.piece ? findByPiece(...) : null);     // piece seul (piece NON null)
```

- `findExact` doit comparer **toutes** les colonnes d'identité :
  `date+amount+type+piece+description+category_id` (avec COALESCE pour
  les nullables).
- `findByPieceCat` et `findByPiece` doivent être **conditionnés à
  `piece` non vide** : sinon `COALESCE(piece, '') = ''` matche n'importe
  quelle écriture sans piece, fusionnant des ventilations distinctes.
- **Pas de `findByCat` sans piece** : confond 2 ventilations à mêmes
  date/amount/type/cat (ex. LeRest 24€ Cotisations Impeesa vs Ruseva
  24€ Cotisations Impeesa, mêmes 20/12/2025).

Vu les bugs : commits `9e3475e`, `eeaf030`, `434e6fe`.

### Mapping nature CSV → category_id : utiliser `comptaweb_nature`

La table `categories` a un champ `comptaweb_nature` qui contient le
**libellé exact** que Comptaweb met dans la colonne `Nature` du CSV
(ex. `"Participation au Fct du Mouvement"`). Le champ `name` est le
libellé "humain" plus long (ex. `"Participation au fonctionnement du
mouvement"`).

Matching à faire dans cet ordre :
1. **Exact sur `comptaweb_nature`** (priorité : 100% fiable)
2. Exact sur `name` (fallback)
3. Fuzzy sur `name` (startsWith/includes — dernier recours)

Le fuzzy seul échoue sur les abréviations ("Fct" ≠ "fonctionnement").
Quand le mapping rate, la ventilation se retrouve avec `category_id =
null` ; au re-import suivant `findExact` ne match plus l'écriture
précédente (qui avait cat correct via une chance fuzzy passée), et un
**doublon** est créé.

Vu le bug : commit `36cf6da`.

### Dédup et cleanup orphelins : critère = identité complète

`dedup-ecritures.ts` groupe par `(date, amount, type, piece, description,
category_id)` — les 6 champs d'identité d'une écriture. Un critère plus
laxiste fusionne des ventilations distinctes (ex. mestre 568€
Participation piece=10 vs chabrol 568€ Cotisations piece=6).

Le cleanup orphelins (`findOrphansWithoutCategory`) cherche pour chaque
écriture cat=null une "twin" cat-définie avec mêmes
`(date, amount, type, piece, description)`. **Garde-fou** : il ne
propose la suppression que si exactement 2 écritures partagent
`(date, piece, description)` toutes catégories confondues. Si > 2,
c'est un regroupement multi-ventilations (ex. ESP-2501 27/09 a 7
ventilations dont Cotisations 20€ ET Dons 20€) — l'orphelin pourrait
être l'une d'elles, suppression dangereuse.

Vu le bug : commit `7989125` (cleanup avait supprimé Dons 20€ ESP-2501
en la prenant pour un doublon de Cotisations 20€ ESP-2501).

### Encoding CSV : Windows-1252

L'export Comptaweb est en **Windows-1252** (Excel français), pas UTF-8.
Lecture obligatoire via :
```ts
const content = new TextDecoder('windows-1252').decode(buffer);
```
Sinon les colonnes "Dépense" / "Dépôt" deviennent illisibles → totaux
à zéro et lignes mal classées comme transferts internes.

Vu le bug : commit `4a19d70`.

### Outils de debug

`web/scripts/audit-csv-totals.ts` : calcule les totaux dépenses/recettes
attendus en parsant le CSV en local (sans toucher la BDD). Sert à
vérifier que `solde Baloo synced ≈ solde compte de résultat Comptaweb`.

`web/scripts/audit-csv-matching.ts` : trace les groupes du CSV pour
diagnostic du parser sans appel BDD.

```bash
pnpm tsx scripts/audit-csv-totals.ts <chemin-csv>
```

## Git / déploiement

### Pas de push sans accord explicite
Vercel auto-deploy sur push to main. Le user veut valider chaque déploiement → **jamais** `git push origin main` sans confirmation explicite ("push", "vasy push", "ok push"). Commit local OK, push à demander.

### Pattern `*.csv` du `.gitignore` ignore les **dossiers**
Si un segment d'URL contient un `.csv` (ex. `/api/ecritures/export.csv/route.ts`), git **ignore le dossier entier** à cause du pattern global `*.csv` et n'y descend pas pour appliquer une exception. Il n'y a pas de moyen propre de désignorer un dossier dont le nom matche le pattern.

Solution : renommer le segment d'URL (`/api/ecritures/export/` au lieu de `/api/ecritures/export.csv/`). Le `Content-Disposition: attachment; filename="..."` au runtime impose le bon nom au download de toute façon.

Vu le cas : commit `28fa2bd`.

### Branches feature, pas de commits direct sur main… sauf hot-fix prod cassée
Workflow standard : feature branch → push → merge ff sur main → push main → cleanup. Pour un hot-fix urgent quand la prod est cassée, commit direct sur main est OK avec accord du user.

## Service Worker PWA

Le SW peut servir un cache pourri pendant qu'un nouveau déploiement est en cours. Un `Cmd+Shift+R` (hard reload) bypasse le SW. À mentionner à l'utilisateur en cas de "ça plante toujours" alors que les curls anonymes répondent OK.

---

# Patterns mis en place

## Journal d'erreurs interne — `/admin/errors`

`logError(mod, message, err, data)` dans `lib/log.ts` :
- Émet en console (visible dans Vercel logs).
- **Persiste en BDD** dans `error_log` en fire-and-forget (table créée par `business-schema.ts`).
- Page `/admin/errors` (admin only) liste les non-résolues + toutes, avec stack et data en details, bouton "Marquer résolue" / "Ré-ouvrir".

Quand on instrumente une page qui plante en prod sans logs accessibles, wrapper les `await` :

```ts
async function trace<T>(mod: string, p: Promise<T>): Promise<T> {
  try { return await p; } catch (err) {
    logError(`home/${mod}`, 'await failed', err);
    throw err;
  }
}
```

Puis aller voir `/admin/errors` après la prochaine erreur. Convention : le `mod` doit pointer la fonction précise. **À retirer** une fois le bug identifié.

## Error boundary `(app)/error.tsx`

Sans `error.tsx` au niveau du group route, Vercel affiche le générique "This page couldn't load. A server error occurred." sans détail. Le boundary client affiche `error.message` (masqué en prod par Next pour pas leaker — seul le `digest` reste exploitable côté logs Vercel) et un bouton retry.

## Modules purs pour les transitions de workflow

Les guards de transition (`isAllowedRembsTransition`, `isAllowedAbandonTransition`) sont extraits en modules **purs** sans dépendance BDD :

- `lib/services/remboursements-transitions.ts`
- `lib/services/abandons.ts` (fonction `isAllowedAbandonTransition`)

Permet :
- Tests vitest unitaires sans setup BDD (cf. les 49 tests ajoutés au commit `e2cb928`).
- Réutilisation depuis plusieurs server actions sans copier-coller.

## Validation des règles métier côté code, pas en BDD

Tous les `status` de workflow (rembs, abandons, etc.) sont **TEXT sans CHECK SQL**. La validation des transitions vit dans des modules dédiés. Voir ADR-019 pour la justification originale (rôles users), étendu à tout workflow depuis.

---

# Conventions UI / UX user-facing

## Pas d'engagements de délai
Le user ne veut pas afficher de délais de réponse / prise en compte (ni "réponse sous 48h", ni "envoi sous 5 minutes", ni "CERFA reçu en quelques semaines"). Ces phrases créent un engagement implicite que personne ne peut tenir. Utiliser des formulations descriptives : "le CERFA arrivera par mail", "tu recevras un mail à chaque étape".

Seules **deadlines réglementaires SGDF** sont OK (ex. "avant le 15 avril N+1" pour les abandons) — c'est une contrainte légale, pas un engagement Baloo.

Vu : commit `49fe17a`.

## Affirmations fiscales / réglementaires : citer la source SGDF
Pas affirmer le "66% de réduction d'impôt" pour un CERFA d'abandon : c'est dépendant de la situation fiscale du donateur (tranche, plafond art. 200 CGI, contributions complémentaires). La doc SGDF officielle (`web/public/docs/fiche_abandon.pdf`) ne le mentionne pas — elle dit juste "réduction d'impôt sur le revenu (art 200 CGI)". Cette formulation est juste, suffisante, et n'engage pas Baloo sur un chiffre qui peut être faux dans certains cas.

Vu : commit `1253841`.
