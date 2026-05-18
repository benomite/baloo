# Spec — Pivot Baloo : miroir strict de Comptaweb + MCP-first

**Date** : 2026-05-18
**Statut** : design validé, prêt à plan d'impl
**Sous-projet** : pivot stratégique avant V1. Recentrage de Baloo : ne plus dupliquer Comptaweb, devenir son **companion**.

---

## Contexte

L'ouverture aux workflows internes ([p2-workflows-internes.md](../p2-workflows-internes.md)) et la livraison récente du MCP HTTP avec OAuth ([2026-05-12-mcp-http-oauth-design.md](2026-05-12-mcp-http-oauth-design.md)) ont mis en évidence que Baloo dérivait vers la duplication de Comptaweb : page `/ecritures` interactive, batch edit (branche `feat/cartes-batch-edit` dormante), saisie d'écriture front, import CSV à répétition.

Comptaweb reste la source de vérité comptable officielle SGDF. Baloo doit s'aligner sur ce constat : son rôle n'est pas de remplacer Comptaweb (effort énorme, valeur ajoutée faible, double saisie risquée), mais d'**en faciliter l'usage** en apportant ce que Comptaweb ne sait pas faire :

- Gestion de **fichiers et justificatifs**
- **Workflows multi-personnes** : récup justifs auprès des chefs/parents, remboursements, abandons de frais
- **Pilotage par MCP** depuis Claude.ai : le MCP fait à la place du trésorier (y compris écrire dans Comptaweb)

Le front Baloo devient un **compagnon visuel** : il montre ce qui va, ce qui ne va pas, déclenche les actions simples, et *assiste* les saisies Comptaweb sans s'y substituer.

## Objectifs

1. **Aligner Baloo sur Comptaweb** : la BDD Baloo est un **miroir strict** de Comptaweb pour tout ce qui est écriture comptable. Pas de divergence possible.
2. **Faire du MCP le produit principal** : V1 cible des trésoriers qui pilotent leur compta depuis Claude.ai. Le front est un compagnon, pas l'interface primaire.
3. **Préserver les capacités Baloo-only** : justifs/fichiers, workflows multi-personnes, mémoire structurée (groupe + SGDF générique), budgets, synthèse.
4. **Ouvrir aux membres du groupe** (chefs, parents) pour qu'ils déposent justifs et demandent remboursements eux-mêmes, soulageant le trésorier.

## Non-objectifs (V1)

- **Aucun batch edit** sur les écritures depuis le front. Reviendra post-V1 avec angle "qu'est-ce qu'on peut modifier après saisie Comptaweb".
- **Aucun write Comptaweb pour la caisse**. Tant que CW n'expose pas d'API/scraping write fiable pour la caisse, Baloo guide en "Tout copier" — le trésorier saisit lui-même côté CW.
- **`scrapeListeEcritures(exercice)`** : facultatif en V1. Si pas construit, l'import CSV reste le moyen de récupérer un historique complet.
- **Refresh tokens MCP** : reste hors scope (couvert par la spec OAuth, à faire post-V1).

## Position assumée — MCP obligatoire

V1 cible explicitement les trésoriers qui acceptent d'utiliser Claude.ai comme interface principale. Un trésorier qui refuse le MCP peut continuer à utiliser Comptaweb directement à la main — Baloo perd alors la majorité de sa valeur. Cette position est assumée : on optimise pour l'expérience MCP-first plutôt que de chercher l'autonomie complète du front.

---

## Principe central : miroir strict

**Règle d'or** : une écriture dans la table `ecritures` Baloo existe en tant qu'écriture si et seulement si elle existe dans Comptaweb. Pas avant.

### Flow CRUD écriture

```
[Front ou MCP]
   → POST /api/ecritures {payload}
     ├─ INSERT en BDD Baloo avec status='pending_cw'
     ├─ Appel scraper CW.createEcriture(payload)
     ├─ Succès : UPDATE status='pending_sync', store cw_numero_piece
     └─ Échec  : UPDATE status='draft', expose erreur au caller (utilisable plus tard pour copier-coller manuel)

[Sync background, déclenché peu après]
   → Scrap rapprochement + (si dispo) liste écritures CW
   → Match nouvelle écriture CW ↔ ecriture pending_sync (par numero_piece)
   → UPDATE status='mirror', écriture promue, visible dans /ecritures
```

L'utilisateur peut sortir de l'app après "Créer" : la sync finit le boulot, et les justifs déjà attachés au draft suivent la promotion.

### Drafts et écritures en attente

Baloo a besoin de tracer ce qui n'est pas encore dans Comptaweb mais qui devra y être :

- **Ligne bancaire détectée** par scraping rapprochement, sans écriture CW associée
- **Justif uploadé orphelin** en attente d'être lié à une future écriture
- **Demande de remboursement** en cours qui produira une écriture quand validée
- **Saisie commencée** par l'utilisateur mais pas encore confirmée vers CW (échec scraping, abandon, etc.)

Ces drafts portent des **enrichissements Baloo** (justifs liés, notes, personnes, contexte) qui suivent la promotion en écriture quand le sync retrouve le match.

### Distinction UI claire

| Zone | Contenu |
|---|---|
| `/ecritures` | Miroir CW (status=`mirror`), read-only enrichi (justifs/notes/liens) |
| `/inbox` | Drafts : lignes bancaires non rapprochées, justifs orphelins, demandes en cours, saisies en préparation |

L'utilisateur ne se demande jamais "est-ce que c'est dans CW ou pas ?".

### Statut `ecritures.status` (enum)

| Status | Sens |
|---|---|
| `draft` | Préparation locale, jamais envoyé à CW (saisie en cours, ligne bancaire détectée, etc.) |
| `pending_cw` | En cours d'envoi vers CW (scraping en cours) |
| `pending_sync` | Envoyé à CW avec succès, en attente que la sync incrémentale ramène la confirmation |
| `mirror` | Synced, miroir CW propre |
| `divergent` | Sync a détecté un écart (ex: montant Baloo ≠ montant CW). Nécessite arbitrage humain. |

---

## Scope V1

### KEEP — ce qui constitue Baloo

- **Justifs & fichiers** : upload, attach, dépôts, inbox orphelins, auto-match, suggestions
- **Workflows multi-personnes** : remboursements, abandons de frais, dépôts chèques (banque + ANCV)
- **Mémoire structurée** :
  - Groupe (personnes, comptes, budgets, notes, todos)
  - **Couche SGDF générique** à finaliser (`sgdf-core/` : glossaire, process standards)
  - **Couche groupe à enrichir** (vues, alertes paramétrables)
- **Budgets & synthèse par unité** (Comptaweb ne fait pas)
- **OAuth + MCP** : cœur du produit
- **Drafts / rapprochement bancaire** conservés **comme signal** dans le dashboard

### TRANSFORMER — pages réorientées

Le pattern "**interface Comptaweb assistée**" : les pages qui produisaient une saisie locale deviennent des interfaces de saisie pour Comptaweb. Chacune offre selon ce qui est techniquement faisable :

- **"Faire dans Comptaweb pour moi"** (quand scraping write existe) — MCP/scraping pilote CW
- **"Ouvrir Comptaweb pré-rempli"** (si deep-link disponible) — nouvel onglet
- **"Tout copier"** (toujours dispo, fallback universel) — clipboard, l'utilisateur colle dans CW

Pages concernées :
- `/ecritures/nouveau` et page d'édition → interface assistée
- Mouvements caisse → interface assistée (pas de write CW dispo → "Tout copier")
- `/ecritures` liste → dégradée en vue read-only basique (lecture du miroir)
- Import CSV → déplacé dans page admin cachée (onboarding tardif + correction de drift)

### BUILD — à construire en V1

- **Sync incrémental on-connect** : stale-while-revalidate + throttle 15 min, trigger sur load home / pages sensibles / call MCP
- **Bouton "Forcer la sync"** dans le header (override du throttle)
- **Table `sync_runs`** : trace de chaque sync (date, count, durée, anomalies) pour debug + admin
- **Dashboard `/`** : cartes "ce qui va / pas" (la home V1)
- **Tools MCP manquants** identifiés en dogfood
- **Couche mémoire SGDF générique** : finalisation glossaire et process standards
- **Couche mémoire groupe** : alertes paramétrables, vues sauvegardées, échéances structurantes
- **UI membre** : section `/equipier/*` simplifiée (dépôt justif, demande remb, historique)
- **Flux d'invitation membre** : magic link mail → atterrissage sur espace simplifié
- **Notifications trésorier** (Resend) : justif déposé / demande créée par membre
- **Onboarding multi-trésorier** : install connecteur MCP sur Claude.ai
- **Onboarding nouveau groupe** : provisioning + rattachement Comptaweb + premier sync

### KILL — disparait

- **`feat/cartes-batch-edit`** : branche abandonnée (4 commits / ~930 lignes). Incompatible avec le miroir strict. Reviendra post-V1.
- **`compta/`** : MCP standalone déprécié (déjà annoncé dans la spec OAuth 2026-05-12). Tous les tools portés vers `/api/mcp`.

### POST-V1

- **`scrapeListeEcritures(exercice)`** complet pour remplacer définitivement le CSV
- **Scraper write caisse** si Comptaweb le permet
- **Batch edit** repensé : deux catégories (champs CW pilotant CW vs champs Baloo-only locaux)
- **Refresh tokens MCP**, scopes granulaires

---

## Architecture

```
                       ┌──────────────────────┐
                       │  Claude.ai (tréso)   │
                       └──────────┬───────────┘
                                  │ MCP (OAuth)
                       ┌──────────▼───────────┐
                       │  /api/mcp (webapp)   │
                       │  Streamable HTTP     │
                       └──────────┬───────────┘
                                  │ (mêmes endpoints internes)
   ┌──────────────────┐  ┌────────▼─────────┐
   │  Browser user    ├──►   Webapp Baloo   │
   │  (front Next.js) │  │   (web/)         │
   └──────────────────┘  └────────┬─────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
        ┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────────┐
        │  BDD Turso   │  │  Scraper CW  │  │  Vercel Blob     │
        │  (mirror +   │  │  (web/lib/   │  │  (fichiers       │
        │   drafts +   │  │   comptaweb) │  │   justifs)       │
        │   data Baloo)│  └───────┬──────┘  └──────────────────┘
        └──────────────┘          │
                                  │ HTTPS scraping
                          ┌───────▼──────┐
                          │  Comptaweb   │
                          │  (SGDF, src  │
                          │  de vérité)  │
                          └──────────────┘
```

### Décisions architecturales

1. **Single-path métier** : MCP et front passent par les **mêmes endpoints** `/api/*`. Le MCP est un client comme le front. Pas de logique dupliquée.
2. **Scraper CW isolé** : `web/src/lib/comptaweb/` testable seul, ne touche pas la BDD. Les routes API orchestrent.
3. **UPSERT toujours** : règle "JAMAIS de DELETE" du CLAUDE.md reste impérative, surtout avec sync incrémental fréquent. `COALESCE` sur les champs Baloo-enrichis.
4. **Sync on-connect, pas de cron** : déclencheur cohérent avec l'intention utilisateur, pas de quota brûlé inutilement.
5. **Stale-while-revalidate** : sync ne bloque jamais une requête utilisateur ou MCP. Le call en cours utilise les data actuelles, sync se déclenche en background, prochain render à jour (revalidate Next.js).

### Flux clés

**1. Création d'écriture** : décrit en section "Principe central".

**2. Sync incrémental on-connect** :
```
Trigger : load /  OU  load page sensible (/ecritures, /inbox)  OU  call MCP

IF (now - last_sync) > 15min :
  → spawn sync background (non-bloquant)
  → la requête en cours utilise les données actuelles (potentiellement stale)
  → revalidatePath() après sync → prochain render à jour
ELSE :
  → skip
```

Premier sync (onboarding ou long silence) : visible avec progress ("Synchronisation Comptaweb… 142 écritures importées").

**3. Dashboard** : route `/` qui agrège en server-side (queries parallélisées BDD Baloo + cache court CW si pertinent). Cartes : justifs manquants, drafts, rembs en attente, abandons sans reçu, dépôts pas faits, lignes bancaires non rapprochées, sync CW, trésorerie globale, alertes mémoire, échéances structurantes, **demandes/dépôts membres à traiter**.

**4. Workflows multi-personnes** (rembs/abandons/dépôts) : conception inchangée. Étape "passer en compta" déclenche le flux 1.

**5. MCP** : thin wrappers sur endpoints webapp. Aucune logique métier dans `/api/mcp`. Scope `treso` uniquement (pas d'accès membre via MCP).

---

## Modèle d'accès — multi-rôle

L'infra existe déjà dans `web/src/lib/auth/access.ts` :

- **Rôles** : `tresorier`, `RG`, `chef`, `equipier`
- **Groupes** : `ADMIN_ROLES` (tresorier, RG), `COMPTA_ROLES` (+chef), `SUBMIT_ROLES` (+equipier)
- **Scope unité** : `scope_unite_id` pour limiter un chef à son unité
- **Invitations** : route `/api/invitations` existante

V1 = **finalisation** plus que construction :

### Trésorier (`tresorier`, `RG`)
- Accès complet front + MCP via Claude.ai
- Endpoints `ADMIN_ROLES` accessibles

### Chef d'unité (`chef`)
- V1 : **réutilise le front trésorier existant** avec filtrage `scope_unite_id` appliqué côté queries (déjà en place dans `COMPTA_ROLES`). Pas d'UI dédiée à construire.
- Voit budgets/synthèse de son unité, pas les écritures hors scope.
- Pas de MCP en V1 (scope `treso` strict).

### Membre équipier (`equipier`)
- UI dédiée `/equipier/*` (simplifiée)
- Auth : **magic link mail uniquement**
- Actions :
  - **Dépôt justif** : upload + champs minimaux (date, montant, intitulé, unité concernée, qui a payé) → alimente l'inbox trésorier
  - **Demande remboursement** : montant + intitulé + virement attendu + justif joint
  - **Historique complet** : "mes demandes" avec status (en attente / validé / payé / refusé)
- Pas d'accès MCP, pas de visibilité sur les écritures / budgets / dashboard trésorier

### Sécurité
- Audit des endpoints API : `ADMIN_ROLES` strict sur tout ce qui touche écritures / sync CW / budgets / admin
- MCP `/api/mcp` : refuse les tokens dont le user n'est pas `tresorier`/`RG`
- **Invitation = lien groupe** : le magic link membre est émis depuis une invitation `/api/invitations` rattachée à un `group_id`. Pas d'auto-inscription publique.
- Notifications trésorier (Resend) à chaque dépôt/demande membre

---

## Séquençage V1 — approche MCP-first (5-6 semaines)

### Phase 1 — Fondations MCP + interface assistée (1-1.5 sem)
- Déprécier `compta/` : audit tools `compta/src/tools/` vs `/api/mcp`, porter ce qui manque, supprimer `compta/`
- Statut enum `ecritures` : ALTER + UPDATE mapping anciens status → nouveaux
- Pages "interface Comptaweb assistée" : `/ecritures/nouveau`, édition, mouvements caisse
- Aucune saisie qui écrit en local sans passer par CW

### Phase 2 — Sync on-connect (4-5 j)
- Mécanisme stale-while-revalidate + throttle 15 min
- Détection premier sync → UI loader avec progress
- Bouton "Forcer la sync" dans header
- Table `sync_runs` (audit logs)
- **Optionnel** : `scrapeListeEcritures(exercice)` si on veut remplacer le CSV en V1. Sinon on garde CSV en admin caché.

### Phase 3 — Dogfood 2 semaines (calendrier flottant)
Utilisation **exclusive du MCP via Claude.ai** par le dev pour piloter sa trésorerie. Objectifs :
- Identifier les tools MCP manquants / chiants
- Voir ce qui manque vraiment dans le front (input pour Phase 4)
- Stress-tester le flux "écrire dans CW via MCP → sync → miroir"

Livrable : note de friction.

### Phase 4 — Dashboard + mémoire structurée (1-1.5 sem)
- Dashboard `/` : cartes "ce qui va / pas" basées sur observations dogfood
- Couche mémoire SGDF (`sgdf-core/`) : glossaire, process standards
- Couche mémoire groupe : tools MCP pour alertes paramétrables, vues, échéances
- Ajustements tools MCP (gaps identifiés Phase 3)

### Phase 5 — Kill ancien front + admin caché (3-4 j)
- `/ecritures` dégradée en read-only basique (ou supprimée si dogfood le valide)
- Branche `feat/cartes-batch-edit` : abandon officiel (commit avec note explicative)
- Page `/admin/sync` : CSV import + resync complet manuel + logs syncs

### Phase 6a — Onboarding multi-trésorier (5 j)
- Connecteur MCP sur Claude.ai : doc install + flux OAuth visuel
- Provisioning nouveau groupe + premier user `tresorier`
- Rattachement Comptaweb : saisie credentials + test login auto + premier sync
- Landing `/about` enrichie (démo MCP)

### Phase 6b — Ouverture aux membres (5-7 j)
- UI dédiée `/equipier/*`
- Audit permissions API
- Flux invitation membre (magic link)
- Notifications trésorier (Resend) sur dépôt/demande
- Vue "mes demandes" historique complet

### Dépendances
- Phase 1 avant Phase 3 (dogfood nécessite MCP complet + interface assistée)
- Phase 2 en parallèle fin Phase 1
- Phase 4 dépend strictement de Phase 3
- Phase 5 et 6 peuvent se chevaucher
- Phase 4 dépend partiellement de Phase 6b (les objets "demande membre" doivent exister pour que le dashboard les affiche) → à synchroniser

---

## Error handling

| Risque | Mitigation |
|---|---|
| CW change le HTML (refonte UI) | Parsing isolé dans `lib/comptaweb/*-scrape.ts`, tests sur snapshots HTML, logs explicites en parse fail |
| Session CW expirée | Déjà couvert : `ComptawebSessionExpiredError` + `withAutoReLogin` + `auth-automated.ts` |
| CW indisponible | Sync background ne bloque jamais ; UI affiche "Dernier sync : il y a Xh" + retry ; pas de plantage |
| Scraping write échoue | Statut `pending_cw` → fallback `draft` avec message "à refaire ou copier manuellement" |
| Sync détecte un écart (montant divergent) | Statut `divergent` + notif dashboard ; jamais d'écrasement silencieux |
| Stale `pending_sync` > 1h | Resync complet automatique + alerte dashboard |

## Tests

- **Scraping** : snapshots HTML CW dans `web/src/lib/comptaweb/__tests__/` (partiel existant à compléter)
- **Sync** : scénarios miroir / draft / promotion (clé du flux principal)
- **Permissions** : `equipier` ne peut pas appeler endpoints `ADMIN_ROLES`
- **MCP** : `/api/mcp` rejette tokens sans scope `treso`

## Migration BDD

Via pattern `ensureBusinessSchema` existant :
1. `ecritures.status` : ALTER + UPDATE mapping anciens status → nouvel enum
2. `sync_runs` : CREATE TABLE
3. `compta/` : (a) ajouter tools manquants à `/api/mcp` (b) marquer deprecated dans README/CLAUDE.md (c) supprimer en fin Phase 1

Respect strict de la règle "JAMAIS de DELETE" : tous les enrichissements Baloo (justifs liés, notes, etc.) doivent survivre à la migration.

## Risques produit

| Risque | Impact | Mitigation |
|---|---|---|
| Dogfood Phase 3 révèle MCP insuffisant pour usage quotidien | Élevé | Rallonger Phase 3 avant Phase 4 ; ajuster scope V1 si besoin |
| Trésoriers pilotes refusent l'idée MCP obligatoire | Assumé | Position produit explicite. Si refus, ils continuent CW à la main, Baloo perd sa valeur. Pas de pivot prévu. |
| Membres reçoivent magic link en spam | Moyen | Resend bien configuré (existant), monitorer delivery |
| Stale `pending_sync` longtemps | Moyen | Détection + resync auto + alerte (cf. error handling) |

---

## Décisions structurantes à acter dans `decisions.md`

À l'issue de la Phase 1, créer un ADR référençant cette spec et capturant :
- "Baloo est un miroir strict de Comptaweb pour les écritures comptables"
- "MCP-first : Baloo cible des trésoriers qui pilotent via Claude.ai"
- "Pas de saisie locale Baloo qui ne soit pas transitée par Comptaweb d'abord"
- "Pages `/ecritures/nouveau`, édition, caisse = interfaces assistées Comptaweb, pas saisie locale"
- "`compta/` standalone définitivement supprimé"
