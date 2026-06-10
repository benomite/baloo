# Gestion des camps — Design

- **Date** : 2026-06-10
- **Statut** : design validé en brainstorming, en attente de relecture
- **Contexte** : camps d'été par unité imminents. Paiements des parents à encaisser, dépenses pendant le camp (carte procurement/CB + avances de trésorerie), justifs à collecter auprès des chefs, budget à suivre avant/pendant/après. Le groupe n'a qu'un seul compte bancaire : tout doit rester intégré à la compta globale.

## Décisions validées avec l'utilisateur

| Question | Choix |
|---|---|
| Paiements parents | **Total encaissé seulement en V1** (somme des écritures recettes imputées au camp). Suivi nominatif par famille = V2. |
| Moyens de paiement des chefs | **Carte procurement/CB du groupe** (lignes bancaires, flux existant) + **avances de trésorerie** (somme confiée au chef, justifs, reliquat rendu). Pas de flux remboursement spécifique camp. |
| Granularité budget chef | **Par poste de dépense** (intendance, transport, activités…) — s'appuie sur `budget_lignes` par catégorie. |
| Source du suivi « pendant » | **Les dépôts de justifs des chefs** (photo ticket → montant + poste → budget bouge immédiatement). Le rapprochement bancaire confirme ensuite (dédup naturelle). |
| Architecture | **Approche A** : entité `camps` légère qui orchestre l'existant (activités, budget_lignes, écritures, dépôts). |
| Filtre du réel | **`activite_id` seule** (pas activité+unité) — robuste si une écriture a l'activité mais pas l'unité. L'unité du camp sert au scope chef et à l'affichage. |

## Principe directeur

**Un camp est une vue filtrée de la compta du compte unique, pas une compta parallèle.** Le budget = `budget_lignes` existantes (saison, par activité+catégorie). Le réel = écritures imputées à l'activité du camp + dépôts en attente. Les écritures du camp suivent le flux normal (draft → Comptaweb). Comptaweb reste la source de vérité comptable.

**Pré-requis par camp** : une activité Comptaweb dédiée (ex. « Camp été 2026 SG »), sélectionnée à la création du camp. Si elle n'existe pas : la créer côté Comptaweb puis `cw_sync_referentiels`.

## Modèle de données

### Table `camps` (nouvelle)

```sql
CREATE TABLE IF NOT EXISTS camps (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groupes(id),
  name TEXT NOT NULL,
  unite_id TEXT NOT NULL REFERENCES unites(id),
  activite_id TEXT NOT NULL REFERENCES activites(id),
  date_debut TEXT,
  date_fin TEXT,
  statut TEXT NOT NULL DEFAULT 'preparation',  -- preparation | en_cours | cloture (pas de CHECK SQL, validation code)
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

- Le **statut est un acte** (clôturer = justifs reçus + comptes bouclés), pas une dérivée des dates.
- **Jamais de DELETE** (règle projet) : un camp annulé passe en notes / statut, pas supprimé.
- Schéma lazy-init via service (`ensureCampsSchema`), pattern `depots_justificatifs`.

### `depots_justificatifs` : + colonne `activite_id`

```sql
ALTER TABLE depots_justificatifs ADD COLUMN activite_id TEXT REFERENCES activites(id);
```

- Migration dans `ensureDepotsSchema` (pattern PRAGMA table_info déjà utilisé pour la v2 des rejets).
- Choix : rattacher le dépôt à l'**activité** (générique, sert au-delà des camps), pas au camp. Le camp retrouve ses dépôts via son `activite_id`.
- **Propagation** : au rattachement dépôt→écriture (`attachDepotToEcriture`), `activite_id` rejoint la propagation existante (COALESCE champs vides, drafts uniquement — règle « jamais d'écrasement »).

### Table `avances_camp` (phase A2)

```sql
CREATE TABLE IF NOT EXISTS avances_camp (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groupes(id),
  camp_id TEXT NOT NULL REFERENCES camps(id),
  beneficiaire TEXT NOT NULL,                 -- nom du chef (texte libre V1)
  montant_cents INTEGER NOT NULL,
  date_versement TEXT,
  mode TEXT NOT NULL DEFAULT 'virement',      -- virement | especes
  ecriture_id TEXT REFERENCES ecritures(id),  -- l'écriture du virement (traçabilité)
  statut TEXT NOT NULL DEFAULT 'versee',      -- versee | cloturee
  montant_rendu_cents INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

## Calcul budget / réel (module pur, TDD)

Nouveau module pur `camp-budget.ts` (pattern `ecriture-match.ts` : pas de DB, testé vitest) :

- **Budget par poste** : `budget_lignes` de la saison, `activite_id = camp.activite_id`, groupées par `category_id`, séparées dépenses/recettes.
- **Dépensé par poste** = somme par catégorie de :
  - écritures `type='depense'`, `activite_id = camp.activite_id` ;
  - **+ dépôts `statut='a_traiter'`** avec `activite_id = camp.activite_id` (le temps réel pendant le camp).
  - **Dédup naturelle** : un dépôt `rattache` ne compte plus (l'écriture liée prend le relais) — même mécanique que le « Lier ».
- **Recettes encaissées** : écritures `type='recette'` de l'activité vs budget recettes (participations parents, subventions).
- **Exclusions** : catégories de transfert (`CATEGORIES_HORS_RESULTAT`) exclues du réel.
- **Avances ≠ dépenses** : le virement d'une avance à un chef est un **transfert**, pas une dépense du camp — ce sont les **tickets** payés sur l'avance qui comptent (dépôts puis écritures). L'écriture du virement est seulement liée à `avances_camp.ecriture_id` (traçabilité) et **ne doit pas être imputée à l'activité du camp** (sinon double comptage — même piège que les dépôts d'espèces, cf. bandeau financier). La page camp signale une écriture liée à une avance qui serait imputée à l'activité.

## Pages & parcours

### `/camps` — liste
- Cartes par camp : nom, unité (couleur), dates, statut, jauge budget global (dépensé/budget).
- **Admin** (trésorier/RG) : tous les camps + bouton « Nouveau camp ».
- **Chef** : le(s) camp(s) de son unité (mécanisme `scopeUniteId` existant). Pas de création.

### `/camps/[id]` — pilotage
- Header : nom, unité, dates, statut (+ actions admin : changer statut, modifier).
- **Jauges par poste** (dépensé = écritures + dépôts en attente vs budget) — la vue principale du chef.
- **Recettes** : encaissé vs attendu (équilibre du camp). **V1 : le chef voit la même page que le trésorier** (scopée à son unité), sans les actions admin — aucune donnée sensible sur la page, et c'est plus simple.
- **Dépenses récentes** : liste fusionnée écritures + dépôts en attente, badgés (« en banque » / « ticket déposé, en attente de rapprochement »).
- **Justifs manquants** : écritures de l'activité sans justif (réutilise la logique has_justificatif/remboursement_id).
- **Avances** (A2) : liste des avances du camp, statut, reliquat.
- Bouton **« Déposer un justif »** → `/depot?activite=<id>&unite=<id>` pré-rempli. Le parcours chef au camp = photographier le ticket, choisir le poste, envoyer.

### `/depot` — enrichissement
- Nouveau champ **Activité** (NativeSelect, selectable mappées CW, optionnel), pré-rempli via query param.
- `createDepot` accepte `activite_id`.

### Création d'un camp (admin)
- Formulaire : nom, unité, **activité Comptaweb** (sélection parmi les activités mappées ; message si aucune ne convient → la créer dans CW puis `cw_sync_referentiels`), dates, notes.

### Navigation
- Entrée « Camps » (groupe Process), visible admin + chefs (icône tente).

## Intégration compta globale (un seul compte)

- Les paiements parents arrivent sur le compte → écritures recettes imputées à l'activité du camp (manuellement ou via les flux existants) → visibles dans le camp.
- Les dépenses carte proc arrivent en lignes bancaires → drafts → imputés à l'activité → visibles dans le camp ; la **bannière de correspondance** existante rapproche les tickets déposés des écritures.
- Rien de nouveau côté sync Comptaweb : le camp n'introduit aucun nouvel état d'écriture.

## Phasage

- **A1 (urgent, avant les départs)** : table `camps` + service + création/liste/page camp + jauges budget/réel + dépôt enrichi `activite_id` + propagation + vue chef + nav.
- **A2** : avances de trésorerie (table, versement, suivi des justifs, clôture avec reliquat).
- **V2 (plus tard)** : participations nominatives par famille (qui a payé, relances), éventuels exports.

## Sécurité / RGPD

- Aucune donnée de mineur dans `camps` (pas de liste de jeunes en V1 — le nominatif V2 devra repasser par une réflexion RGPD).
- Chef : lecture seule sur son camp, scope unité côté serveur (mécanisme existant `scopeUniteId`).
- Actions d'écriture (création camp, changement de statut, avances) : admin only, re-vérifié côté serveur.

## Tests

- **TDD** sur le module pur `camp-budget.ts` (fusion écritures+dépôts par poste, dédup par statut de dépôt, exclusion transferts, recettes).
- Transitions de statut camp : module pur (pattern `remboursements-transitions.ts`) si plus de 2 transitions, sinon validation simple dans le service.
- Le reste : `tsc` + `eslint` + contrôle visuel (pattern projet).

## Risques

- **Imputation manquante** : si une écriture du camp n'a pas l'`activite_id`, elle échappe au camp. Mitigation : la propagation dépôt→écriture pose l'activité ; la page camp reste une vue — l'écriture se rattrape en l'imputant (édition inline existante).
- **Double comptage avance** : couvert par la règle « l'écriture de virement d'avance n'est pas imputée à l'activité » + signalement sur la page camp.
- **Activité CW manquante à la création** : bloquant volontaire (le miroir strict exige le mapping) — message clair + procédure (`cw_sync_referentiels`).
