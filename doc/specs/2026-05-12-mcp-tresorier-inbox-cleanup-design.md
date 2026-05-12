# Spec — MCP trésorier autonome (lot A+B : inbox justifs + cleanup Comptaweb)

**Date** : 2026-05-12
**Statut** : design validé, prêt à plan d'impl
**Phase** : sous-projet 1/6 du chantier « MCP trésorier 90% autonome » (cf. roadmap)

---

## Contexte

Le MCP `compta/` expose déjà l'essentiel des CRUD (écritures, remboursements, abandons, caisse, chèques, dépôts, budgets, personnes, comptes, todos, notes, comptaweb client) et permet à un trésorier de faire ~75% de son quotidien depuis Claude Desktop. Audit du 2026-05-12 a identifié 6 gaps qui empêchent vraiment d'abandonner la webapp. Le user a tranché :

- **Cible** : couvrir 90% du quotidien via MCP, laisser à la webapp les opérations rares ou très visuelles (clôture, admin lourd, dashboards graphiques).
- **Premier lot** : sous-projets A (Inbox & justifs) + B (Cleanup Comptaweb), groupés car ils touchent au même flux post-import / réception de pièces.

Sont hors scope explicitement (autres lots) : admin / invitations / rôles (C), update/delete lignes de budget (D), drill-down synthèse par unité (E), clôture exercice (F).

## Objectifs

1. **Inbox** : permettre au trésorier de traiter ses justificatifs (lister orphelins, matcher auto strict, lier manuellement, uploader un PDF) **sans ouvrir la webapp**.
2. **Cleanup Comptaweb** : permettre les 3 nettoyages post-import (dedup écritures, transferts internes, ventilations orphelines) via tools MCP, avec un pattern `preview` puis `apply` qui colle à la doctrine « JAMAIS de DELETE non contrôlé ».
3. **Conserver les garde-fous métier existants** : pas de suppression d'écriture avec liens externes (justif/dépôt/remb), pas d'auto-link avec ambiguïté.

## Non-objectifs

- OCR / extraction auto montant+date depuis un PDF (feature future, autre lot).
- Récupération auto depuis Gmail / Drive (autre sous-projet).
- Upload de fichiers > 10 Mo (limite Vercel Blob actuelle ; à voir au cas par cas, pas adressé ici).
- Auto-link en mode lenient (±2 %, ±3 j) : suggestions disponibles, mais le linking reste manuel ou strict.

## Vocabulaire

**Écriture orpheline** : `ecritures` du groupe, `type='depense'`, `justif_attendu=1`, sans ligne `justificatifs` liée. La page `/inbox` étend optionnellement aux recettes via `?recettes=1`.

**Justif orphelin** : `depots_justificatifs` du groupe, `status='a_traiter'`, `ecriture_id IS NULL`.

**Auto-match strict** : montant absolu strictement égal, date ±1 j, unicité symétrique (1 écriture ↔ 1 seul justif candidat, et inversement). Cf. `inbox-auto.ts:applyAutoLinks()`.

**Match lenient** (suggestions uniquement, pas auto) : montant ±2 % ou ±1 €, date ±3 j, meilleur match retourné. Cf. `queries/inbox.ts`.

**Cleanup dedup** : suppression d'écritures Comptaweb dupliquées par ré-import. Clé d'identité : `(date_ecriture, amount_cents, type, numero_piece, description, category_id)`. Cf. `dedup-ecritures.ts:findCsvDuplicates()`.

**Cleanup transferts** : suppression d'écritures reconnues comme dépôts caisse → banque mal importés (préfixe pièce `DEP-`, ou pattern `dépôt monnaie/billets/chèques/espèces`, ou zombie pré-fix encoding cassé). Cf. `cleanup-transferts.ts:isTransfert()`. Le terme « transfert interne » est réservé à ce contexte (ne pas confondre avec les répartitions entre unités, cf. spec 2026-05-11).

**Cleanup orphelins** : écritures `category_id IS NULL` qui ont une « twin » avec catégorie sur le même `(date, piece, description)`. Suppression seulement si **exactement 2** lignes partagent le tuple (au-delà = regroupement multi-ventilations, suppression dangereuse).

## Architecture

### Doctrine

Pattern existant du projet, à respecter : **logique métier dans `web/src/lib/services/`, route API thin, tool MCP appelle l'API HTTP**. Le MCP reste un client. Toute la validation, le filtrage `group_id`, les garde-fous, restent côté webapp.

### Côté webapp — nouvelles routes API

Toutes les routes nouvelles vivent sous `web/src/app/api/inbox/` (nouveau dossier) et `web/src/app/api/comptaweb/cleanup/` (nouveau dossier). Elles s'authentifient comme les autres routes API (session ou API token, cf. webapp existante).

| Route | Méthode | Body / Query | Réutilise (existant) |
|---|---|---|---|
| `/api/inbox/orphan-ecritures` | GET | `?period=30j\|90j\|6mois\|tout&recettes=0\|1` | `queries/inbox.ts:listOrphanEcritures` |
| `/api/inbox/orphan-justifs` | GET | (rien) | `queries/inbox.ts:listOrphanDepots` |
| `/api/inbox/suggestions` | GET | `?ecriture_id=…` **xor** `?depot_id=…` | `queries/inbox.ts` (lenient) |
| `/api/inbox/link` | POST | `{ ecriture_id, depot_id }` | `services/depots.ts:attachDepotToEcriture` |
| `/api/inbox/auto-match` | POST | (rien) | `services/inbox-auto.ts:applyAutoLinks` |
| `/api/comptaweb/cleanup/dedup` | POST | `{ mode: 'preview'\|'apply', ids?: string[] }` | `services/dedup-ecritures.ts` |
| `/api/comptaweb/cleanup/transferts` | POST | `{ mode, ids? }` | `services/cleanup-transferts.ts` |
| `/api/comptaweb/cleanup/orphelins` | POST | `{ mode, ids? }` | service existant (ex-dedup) |
| `/api/depots/upload` | POST (multipart) | `file` + `title`, `montant_estime`, `date_estimee`, `ecriture_id?` | `services/depots.ts:createDepot` + `attachDepotToEcriture` |

⚠️ La route `/api/depots/upload` **n'existe pas aujourd'hui** : l'upload côté webapp passe par Server Actions Next.js (`actions/depots.ts:createDepot`, `actions/justificatifs.ts:uploadJustificatif`), qui ne sont pas appelables en HTTP externe. On doit donc créer une route API multipart dédiée qui re-utilise le service `depots.ts:createDepot()` (déjà bien isolé, accepte `{ filename, content, mime_type, ... }`). Aucune duplication de logique.

#### Réponses des routes inbox

**`GET /api/inbox/orphan-ecritures`** :
```json
{
  "period": "90j",
  "include_recettes": false,
  "count": 17,
  "truncated": false,
  "ecritures": [
    { "id": "...", "date_ecriture": "2026-04-12", "amount_cents": 4250,
      "type": "depense", "description": "Achat tente Quechua",
      "category": "Camp ete", "unite": "PC", "mode_paiement": "CB" }
  ]
}
```

**`GET /api/inbox/orphan-justifs`** :
```json
{
  "count": 9,
  "depots": [
    { "id": "...", "title": "Facture Decathlon", "montant_estime_cents": 4250,
      "date_estimee": "2026-04-12", "filename": "decathlon-2026-04.pdf",
      "created_at": "2026-04-15T10:23:00Z" }
  ]
}
```

**`GET /api/inbox/suggestions?ecriture_id=…`** :
```json
{
  "ecriture": { "id": "...", "amount_cents": 4250, "date_ecriture": "2026-04-12" },
  "matches": [
    { "depot_id": "...", "score": 0.97, "delta_amount_cents": 0, "delta_date_days": 0 },
    { "depot_id": "...", "score": 0.82, "delta_amount_cents": 50,  "delta_date_days": 2 }
  ]
}
```

Symétrique avec `?depot_id=`.

**`POST /api/inbox/link`** : retourne `{ ok: true, justificatif_id: "..." }` ou `{ ok: false, error: "..." }`.

**`POST /api/inbox/auto-match`** : retourne `{ linked: [...pairs...], rejected_ambiguous: [...pairs...] }`. Aucun écrasement de lien existant.

#### Pattern preview/apply (cleanups)

Toutes les routes `/api/comptaweb/cleanup/*` partagent la même forme :

- **mode='preview'** : retourne la liste exhaustive des candidats à supprimer + raison + indication des garde-fous appliqués. Ne modifie RIEN.
- **mode='apply'** : exécute la suppression. **Le client DOIT envoyer la liste `ids`** des candidats à supprimer (issus d'un preview précédent). Sans `ids` ou avec `ids: []`, la route retourne une erreur (pas de "apply tout" implicite, pour éviter qu'une nouvelle ligne apparue entre preview et apply soit supprimée sans contrôle).

Exemple `POST /api/comptaweb/cleanup/dedup { mode: 'preview' }` :
```json
{
  "mode": "preview",
  "candidates": [
    {
      "loser_id": "ec_aaa", "winner_id": "ec_bbb",
      "date_ecriture": "2026-03-15", "amount_cents": 12000,
      "description": "Inscription Camp",
      "loser_score": 2, "winner_score": 5,
      "reason": "winner has unite+category+notes; loser only category",
      "loser_has_external_links": false
    }
  ],
  "skipped": [
    { "id": "ec_ccc", "reason": "has justif attached, kept" }
  ]
}
```

Exemple `POST /api/comptaweb/cleanup/dedup { mode: 'apply', ids: ['ec_aaa'] }` :
```json
{
  "mode": "apply",
  "requested": 1,
  "deleted": 1,
  "skipped": [],
  "errors": []
}
```

### Côté MCP — nouveaux tools

#### Nouveau fichier `compta/src/tools/inbox.ts`

```ts
// inbox_list_orphan_ecritures
{ period?: '30j' | '90j' | '6mois' | 'tout'; recettes?: boolean }

// inbox_list_orphan_justifs
{} // pas de param

// inbox_suggest_matches
{ ecriture_id?: string; depot_id?: string } // XOR, l'un ou l'autre

// inbox_link
{ ecriture_id: string; depot_id: string }

// inbox_auto_match
{}

// upload_justificatif
{ file_path: string;        // chemin absolu sur le filesystem local (typiquement inbox/...)
  title?: string;
  montant_estime?: string;  // format "42,50" comme les autres tools
  date_estimee?: string;    // ISO 8601
  ecriture_id?: string;     // si fourni : upload + attach direct
  depot_id?: string;        // si fourni : ajoute au dépôt existant
                            // si ni l'un ni l'autre : crée un dépôt orphelin a_traiter
}
```

#### Ajouts dans `compta/src/tools/comptaweb.ts`

```ts
// cw_cleanup_dedup
{ mode: 'preview' | 'apply'; ids?: string[] }
// cw_cleanup_transferts
{ mode: 'preview' | 'apply'; ids?: string[] }
// cw_cleanup_orphelins
{ mode: 'preview' | 'apply'; ids?: string[] }
```

### Upload de justifs — détail technique

Le MCP tourne sur la machine du user (cf. config `compta/.env` locale). Le tool `upload_justificatif` :

1. Lit le fichier au `file_path` indiqué (vérif existence + taille raisonnable, ex. < 10 Mo).
2. Construit un `FormData` multipart avec le fichier + métadonnées (title, montant_estime, date_estimee, ecriture_id?, depot_id?).
3. POST vers `/api/depots/upload` (route **nouvelle**, à créer — multipart, accepte `ecriture_id` optionnel qui déclenche `attachDepotToEcriture` après création).
4. Retourne `{ depot_id, justificatif_id?, attached_ecriture_id? }`.

Alternative considérée et rejetée : passer le contenu en **base64 dans le tool call**. Un PDF de 500 ko ≈ 650 k tokens en base64 → explose le contexte. Le file_path est meilleur tant que le MCP tourne en local.

À documenter dans le `SKILL.md` du tool : Claude doit vérifier l'existence du fichier (`ls` ou équivalent) avant d'appeler le tool, pour pouvoir guider le user si le path est faux.

### Schéma de la doctrine UPSERT

Les tools de cleanup font des `DELETE` — c'est conforme à la règle CLAUDE.md : « tables de pur cache audit (`comptaweb_lignes`) ou écritures `status='saisie_comptaweb'` sans lien externe peuvent être DELETE ». Les services existants (`dedup-ecritures.ts`, `cleanup-transferts.ts`) respectent déjà ce contrat (skip si liens externes). On ne fait que les exposer via API + MCP, sans changer leur logique.

## Sécurité et permissions

- Routes API authentifient comme l'existant : session (`auth.js`) ou API token (`Bearer …`). Filtrage `group_id` au niveau service.
- Le token MCP est scopé à un user → ses permissions héritent (rôle trésorier = full access ; rôle lecteur = lecture seule).
- Pattern preview/apply force le user à lire ce qui va être supprimé. Combiné aux garde-fous métier (liens externes), réduit drastiquement le risque de destruction accidentelle.
- Upload : pas de validation MIME forte côté MCP, on délègue à la route `/api/depots/upload` (qui filtre déjà PDF/JPG/PNG).

## Tests

Tests à ajouter (suivre conventions existantes du repo) :

- `web/__tests__/api/inbox/*.test.ts` : chaque route avec auth ok / ko, filtrage group_id, pagination/truncate.
- `web/__tests__/api/comptaweb/cleanup/*.test.ts` : preview vs apply, garde-fous (skip si liens externes), refus apply sans `ids`.
- `compta/__tests__/tools/inbox.test.ts` : tools MCP appellent les bonnes routes, format des réponses, upload (mock filesystem).
- Test end-to-end manuel : depuis Claude Desktop, fermer un inbox de ≥ 3 justifs orphelins.

## Migration / déploiement

Aucune migration BDD (toutes les colonnes/services existent déjà). Déploiement :

1. PR sur `main` avec routes API + tools MCP + tests.
2. Vercel auto-deploy sur push (préviser le user — règle « pas de git push sans accord »).
3. Mise à jour du token MCP côté user si besoin (pas changé, sauf si on ajoute des scopes).
4. Mise à jour de `compta/` côté user : rebuild + redémarrer Claude Desktop.

## Risques et points ouverts

- **Upload > 10 Mo** : non géré. Si bloquant, plan B = redirect direct upload vers Vercel Blob avec presigned URL (autre lot).
- **Conflit lors d'apply concurrent** : si deux sessions Claude lancent `cleanup_dedup apply` en parallèle, l'une peut tenter de supprimer un id déjà supprimé. Acceptable : la 2ᵉ remontera `errors: [{ id, reason: 'not_found' }]`. Pas de lock global.
- **Suggestion lenient sur un dépôt orphelin sans montant ni date** : si le user upload un PDF sans saisir montant_estime/date_estimee, `inbox_suggest_matches?depot_id=` retourne `matches: []`. À documenter.
- **Truncate orphan_ecritures à 100** : limite héritée de la webapp. Si un trésorier a > 100 dépenses orphelines sur 90j, il doit affiner la période. Garder cohérent avec l'UI.

## Suite

Après validation user de ce spec :

1. Invoquer la skill `writing-plans` pour générer un plan d'implémentation détaillé.
2. Implémenter par lots : (a) routes API inbox + tests ; (b) tools MCP inbox + upload ; (c) routes API cleanup + tests ; (d) tools MCP cleanup ; (e) tests E2E.
3. PR groupée ou découpée selon volume.
4. Une fois mergé, planifier le lot suivant (Admin/invitations recommandé).
