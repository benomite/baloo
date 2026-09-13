# Comptaweb : deux exercices en parallèle

**Date** : 2026-09-13
**Statut** : design validé — prêt pour le plan d'implémentation
**ADR** : ADR-039
**Contexte** : investigation du 2026-09-11 sur le fonctionnement des exercices CW (constats en live, tutos SGDF). Premier correctif déjà livré : `b21d152` (suppressions bornées à l'exercice).

## Problème

L'exercice comptable SGDF va du 01/09 au 31/08. Dans Comptaweb, il n'est **pas** un filtre d'URL : c'est le **contexte de la session** (menu « Changement de contexte → Exercice »). Une session ne voit qu'un exercice à la fois.

Baloo n'ouvre qu'une session, et un login frais tombe sur l'exercice non clôturé (observé le 2026-09-11 : « Sept 2025 - Août 2026 »). Conséquences constatées :

1. **Les lignes bancaires de septembre sont invisibles** : le rapprochement en contexte 25/26 s'arrête au 31/08 (22 lignes du 01/09 au 10/09 n'apparaissent qu'en 26/27). Aucun brouillon bancaire n'est créé depuis le 01/09.
2. **Les écritures de septembre sont refusées en silence** : CW répond par une redirection hors fiche quand la date est hors de l'exercice du contexte (5 remboursements le 2026-09-11, fix `d06a9a6`).
3. **De septembre à la clôture, les deux exercices sont nécessaires** : les dépenses de camp d'août se saisissent encore sur 25/26 (clôture groupe le 30/09, validation nationale jusqu'à début décembre), pendant que la rentrée alimente 26/27.

## Faits établis sur Comptaweb (constatés le 2026-09-11)

- Changement d'exercice : `GET /exercice?m=1` → form `POST /exercice/upd?id=<exercice courant>`, champs `exercice_change[identifiants_exercices]` (select : id CW → libellé « Sept 2025 - Août 2026 »), `exercice_change[_token]` (CSRF), `exercice_change[submit]`. L'attribut `action` porte l'id de l'exercice **courant** : il sert à lire le contexte.
- Le contexte est **par session** : le navigateur basculé sur 26/27 n'a pas changé la session serveur de Baloo, restée sur 25/26.
- `/recettedepense?m=1` ≡ `/recettedepense` : **tout l'exercice** du contexte (363 écritures du 01/09/2025 au 30/08/2026). `m=1` n'est qu'un marqueur de menu.
- Le rapprochement est découpé par date d'opération : 25/26 → jusqu'au 31/08 ; 26/27 → à partir du 01/09. Les écritures comptables non rapprochées d'un exercice antérieur restent visibles dans le nouveau.
- Les ids d'écriture CW forment **une seule séquence**, tous exercices confondus : ils s'entrelacent pendant la période de clôture.
- Nouveau domaine : `comptaweb.sgdf.fr` (Baloo pointe encore `sgdf.production.sirom.net`, qui répond toujours).

## Design

### 1. Exercices actifs

- Pas de table d'exercices en dur : Baloo lit la liste sur `/exercice?m=1` (id CW + libellé) et en déduit les bornes `01/09/N → 31/08/N+1`.
- **Exercices actifs** = l'exercice contenant la date du jour, plus le précédent **tant qu'il n'est pas déclaré clos**.
- Nouveau réglage groupe `dernier_exercice_clos` (TEXT, ex. `2025-2026`, nullable) : colonne `groupes`, éditable dans `/admin/parametres` (« Déclarer 2025-2026 clos », réversible) et via MCP `update_groupe` — dont le schéma zod doit accueillir le champ (parité MCP ↔ app, ADR-038).
- Si CW ne propose pas encore le nouvel exercice, Baloo reste sur l'ancien et le signale (`logError`).

### 2. Une connexion CW par exercice

- Cache de session **par exercice** : `comptaweb-session-<idExerciceCw>.json` (dans `/tmp` sur Vercel), TTL 8 h inchangé.
- **Ouverture d'une connexion** : login automatisé (inchangé) → `GET /exercice?m=1` → si le contexte ≠ exercice voulu, `POST /exercice/upd` → relecture de confirmation. Confirmation impossible = erreur explicite, **aucune** opération dans le mauvais exercice.
- Le contrôle a lieu **à l'ouverture seulement** : le cookie n'est utilisé que par Baloo, donc le contexte ne peut pas bouger sous ses pieds. Une session expirée repasse par l'ouverture, donc par le contrôle.
- API : `withComptaweb(exercice, fn)`. `withAutoReLogin(fn)` subsiste et vise l'exercice du jour (référentiels, cartes, caisse).
- Multi-groupes : clé par exercice seulement pour l'instant ; la clé deviendra (groupe, exercice) quand la spec `2026-07-06-comptaweb-multi-groupes-design.md` sera implémentée.

### 3. Sync par exercice

- `runSyncCycle` boucle sur les exercices actifs, **du plus récent au plus ancien**. Par exercice, avec sa connexion : scan des brouillons bancaires → lecture de la liste → `reconcile` → exécution du plan → transferts hors résultat. Les étapes ne changent pas ; seule la boucle est nouvelle.
- **Budget de lectures détail global**, non doublé (`maxDuration` 60 s). L'exercice du jour est servi en premier ; le reste est drainé par le `remaining` existant.
- **Isolation des erreurs** : un exercice en échec n'empêche pas l'autre ; message dans `sync_runs.error_message` + `/admin/errors`.
- `sync_runs` gagne `exercices` (TEXT, ex. `2025-2026,2026-2027`), colonne nullable ajoutée par `ALTER TABLE` (cf. AGENTS.md).
- **Le scope `recent` / `exercice` disparaît** : CW renvoie toujours l'exercice complet. Le paramètre reste accepté mais ignoré (compat URL/MCP) ; le bouton « Tout resynchroniser » devient « Resynchroniser ».
- Throttle 15 min et verrou 60 s inchangés, par groupe : un run couvre tous les exercices actifs.
- `reconcile` est déjà borné à l'exercice du snapshot (`b21d152`) : rien à y refaire.

### 4. Création d'écriture routée par la date

- Les deux chemins (`drafts.ts::syncDraftToComptaweb`, `ecritures-create-cw-adapter.ts`) prennent la connexion de l'exercice de `date_ecriture`.
- Exercice clos ou absent de CW → **refus avant tout appel réseau**, message actionnable : « le 24/08/2026 appartient à l'exercice 2025-2026, déclaré clos — corrige la date ou rouvre l'exercice dans les paramètres ».
- Le garde-fou `d06a9a6` (seule une redirection vers `/recettedepense/<id>/afficher` vaut succès) reste en place.

### 5. Domaine

Bascule de `sgdf.production.sirom.net` vers `comptaweb.sgdf.fr` (constante `DEFAULT_BASE_URL` + `comptaweb-url.ts`), en **commit séparé** de ce chantier.

## Points ouverts

- **Détail d'une écriture depuis une autre session** : non testable au 2026-09-13 (26/27 est vide). Le design l'évite — un détail est toujours lu avec la connexion qui a listé l'écriture.
- **Caisse, cartes, référentiels** : découpage par exercice non confirmé (`/caisse/gestion` n'affiche rien sans caisse sélectionnée). Ils restent sur l'exercice du jour ; à reprendre si un écart apparaît.

## Hors périmètre

- Multi-groupes (spec dédiée du 2026-07-06).
- Assistance à la clôture elle-même (ajustements, valorisation du bénévolat, validation des soldes).
- Toute écriture automatique dans CW en dehors des chemins existants.

## Tests (TDD)

Modules purs ou injection, sans réseau :

1. **Exercices actifs** : au 31/08 et au 01/09 ; précédent déclaré clos → un seul actif ; nouvel exercice absent de CW → l'ancien seul + signalement.
2. **Routage par date** : 24/08 → connexion 25/26, 05/09 → connexion 26/27 ; exercice clos → refus sans appel réseau (le faux client n'est jamais appelé).
3. **Ouverture de connexion** : contexte déjà bon → pas de POST ; contexte différent → POST puis relecture ; confirmation qui échoue → throw, opération abandonnée.
4. **Cycle de sync** : deux exercices lus en un run (les deux listes consommées), échec isolé sur l'un (l'autre aboutit, message posé), budget de détails partagé et non doublé.
5. **Non-régression** : un seul exercice actif → un cycle identique à aujourd'hui.

## Fichiers touchés

- Nouveau : `lib/comptaweb/exercices.ts` (lecture de la liste, bascule, contrôle), `lib/services/exercices-actifs.ts` (module pur).
- Cœur : `comptaweb/session-store.ts`, `comptaweb/auth.ts`, `services/sync-cycle.ts`, `services/drafts.ts`, `services/ecritures-create-cw-adapter.ts`.
- Réglage : `db/business-schema.ts` + `auth/schema.ts` (migrations), `services/groupes.ts`, `actions/parametres.ts`, `app/(app)/admin/parametres/page.tsx`, `lib/mcp/tools/groupes.ts`.
- Sync : `app/api/sync/run/route.ts`, `components/ecritures/full-resync-button.tsx`, `lib/mcp/tools/sync.ts`.
- Doc : `web/AGENTS.md` (déjà fait pour les constats CW), `doc/decisions.md` (ADR-039).
