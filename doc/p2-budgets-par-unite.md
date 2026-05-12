# Chantier — Budgets par unité (complétion P2)

Plan d'exécution du chantier livré en 3 phases entre le 2026-05-10 et le 2026-05-11, qui complète la P2 ([`roadmap.md`](roadmap.md)) en outillant le **pilotage budgétaire par unité** (Farfadets, Louveteaux/Jeannettes, Scouts/Guides, Pionniers/Caravelles, Compagnons, Groupe).

Le besoin terrain : le trésorier veut savoir à tout moment où va l'argent du groupe **par unité** — combien dépensé, combien prévu, combien d'enveloppe restante. Jusqu'à ce chantier, la synthèse n'affichait qu'un total global ; les budgets prévisionnels et les répartitions de recettes n'étaient pas modélisés.

Ce document est un plan d'exécution, pas un ADR. Les décisions structurelles prises pendant son exécution ont donné lieu à ADR-029 et ADR-030.

---

## État d'avancement (2026-05-11)

**Chantier livré ✅** sur `main` en 3 PR successives (#9, #10, #11) — 43 commits au total.

| Phase | PR | Date merge | Apport | Spec / Plan |
|---|---|---|---|---|
| 1 — Vue par unité | [#9](https://github.com/benomite/baloo/pull/9) | 2026-05-10 | Grille de cartes couleur SGDF cliquables remplace la table « Par unité » sur `/synthese`. Nouvelle page `/synthese/unite/[id]` avec KPIs, table par catégorie, alertes cliquables, 50 dernières écritures. Stat card « Sans unité » d'audit (écritures + remb + caisse) + filtre `?sans_unite=1` sur `/ecritures`. | [spec](specs/2026-05-10-synthese-detail-par-unite-design.md) · [plan](plans/2026-05-10-synthese-detail-par-unite.md) |
| 2 — Budgets prévisionnels | [#10](https://github.com/benomite/baloo/pull/10) | 2026-05-10 | Page `/budgets` (saisie inline, sélecteur saison, statut éditable, lecture seule si clôturé). Migration BDD `budget_lignes.activite_id`. Backend `updateBudgetLigne` / `deleteBudgetLigne` / `updateBudgetStatut` / `getBudgetPrevuParUnite`. Barre de progression « consommé / prévu » sur chaque `UniteCard`. Colonne « Budget » sur la table catégorie + nouveau bloc « Par activité » sur le détail unité. | [spec](specs/2026-05-10-budgets-previsionnels-par-unite-design.md) · [plan](plans/2026-05-10-budgets-previsionnels-par-unite.md) |
| 3 — Répartitions entre unités | [#11](https://github.com/benomite/baloo/pull/11) | 2026-05-11 | Nouvelle table `repartitions_unites`. Drawer « Répartir » sur `/synthese` pour déplacer X€ d'une unité source vers une cible (NULL = Groupe). KPI « Réalloc » + bloc « Répartitions de la saison » avec édition inline sur la page détail unité. Module pur de validation testé (10 tests vitest). | [spec](specs/2026-05-11-repartitions-unites-design.md) · [plan](plans/2026-05-11-repartitions-unites.md) |

**Critère de succès** : le trésorier dispose de la chaîne complète « voir par unité → prévoir par unité → réallouer entre unités » pour piloter le budget du groupe en cours de saison. Adoption à mesurer en septembre 2026 sur les inscriptions Val de Saône.

---

## Architecture finale

```
solde_unite(U, exercice) = recettes(U, exercice)       -- écritures Comptaweb
                         - dépenses(U, exercice)
                         + Σ répartitions cible=U      -- réalloc entrante
                         - Σ répartitions source=U     -- réalloc sortante

budget_consommé(U, saison) = dépenses(U, exercice) vs Σ budget_lignes(U, saison, dépense)
budget_par_activité(U, saison) = matching budget_lignes.activite_id = ecritures.activite_id
```

**Identité saison / exercice SGDF** : 1 saison budget ≈ 1 exercice (sept→août). Le filtre `?exercice=YYYY-YYYY+1` sur `/synthese` se traduit en saison `YYYY-YYYY+1` côté budgets et répartitions.

**Vue « Tous »** : sur la grille `/synthese?exercice=tous`, les écritures et répartitions sont agrégées toutes saisons confondues. Cohérence visible côté `solde_avec_realloc`. Les budgets restent par-saison (un budget = une saison, par construction).

---

## Phase 1 — Vue par unité

### Livré

- `/synthese` : grille de cartes responsive 1/2/3 colonnes, liseré couleur charte SGDF par branche (`unites.couleur`), code + nom, dépenses / recettes / solde, cliquable.
- `/synthese/unite/[id]` : page détail server component avec anti-énumération inter-groupes (404 `not-found.tsx`), breadcrumb retour, sélecteur d'exercice, KPIs, alertes cliquables (« Sans justif » → `/ecritures?unite_id=X&incomplete=1`, « Non sync » → `&status=valide`), table par catégorie, 50 dernières écritures + lien drill-down.
- **Pré-requis budgets** : stat card « Sans unité » sur `/synthese` (compteurs écritures, remb, caisse) + filtre `?sans_unite=1` + tab dédié sur `/ecritures`. Permet d'auditer la couverture `unite_id` avant de piloter par unité.

### Hors scope (différé en phase 2)

- Budget prévisionnel par unité (a fait l'objet de la phase 2)
- Évolution mensuelle (granularité utile = activités d'année + camps, pas mois)

---

## Phase 2 — Budgets prévisionnels

### Livré

- Migration BDD minimale : `ALTER TABLE budget_lignes ADD COLUMN activite_id TEXT REFERENCES activites(id)` (idempotent dans `auth/schema.ts`, après l'ALTER) + index `idx_budget_lignes_activite`.
- Décision structurelle : **pas de dimension `periode` (année / camps)**. La dualité « activités d'année » vs « camps d'été » est dérivée des activités elles-mêmes (`activites.name`) via le lien `budget_lignes.activite_id`. Cf. [ADR-029](decisions.md#adr-029--modèle-budget-prévisionnel--saison--activité-pas-de-période).
- Service `budgets.ts` complété : `updateBudgetLigne`, `deleteBudgetLigne`, `updateBudgetStatut` (avec `vote_le` posé à la date du jour quand statut=`vote`), `getBudgetPrevuParUnite` (agrégation par unité + par couple unité × activité).
- API REST `PATCH/DELETE /api/budgets/[id]/lignes/[ligneId]` (consommation MCP / script externe).
- Server actions (`lib/actions/budgets.ts`) : 5 actions avec admin guard, `nullIfEmpty` sur les FK string vides, `parseAmount` français.
- Page `/budgets` : sélecteur de saison (4 derniers exercices SGDF), saisie inline éditable, formulaire d'ajout en bas, totaux Prévu dépenses / recettes / solde, lecture seule si `cloture` avec banner ambre.
- Item de menu « Budget » dans la sidebar (rôles `tresorier` / `RG`).
- Synthèse enrichie : barre de progression « consommé / prévu » sur chaque `UniteCard` (rouge si > 100%), masquée si pas de budget pour la saison.
- Détail unité enrichi : colonne « Budget » sur la table catégorie + nouveau bloc « Par activité » (prévu vs réel par couple unité × activité, écart signé).

### Hors scope (différé en phase 3)

- Mécanisme de répartition entre unités (a fait l'objet de la phase 3)
- Vote séparé année / camps (1 budget = 1 statut global pour l'instant)
- Templates / duplication d'une saison à l'autre

---

## Phase 3 — Répartitions entre unités

### Livré

- Nouvelle table `repartitions_unites` créée via `CREATE TABLE IF NOT EXISTS` (pas de migration nécessaire) + 3 index (group_saison, source, cible). Pas de CHECK SQL — validation en code, cf. [ADR-030](decisions.md#adr-030--répartitions-baloo-only-entre-unités).
- Module pur `repartitions-validation.ts` avec 10 tests vitest (source ≠ cible, formats date/saison, montant > 0, libellé non vide).
- Service `repartitions.ts` : `list / create / update / delete / getRepartitionsNetByUnite` avec anti-énumération inter-groupes systématique. `update` interdit volontairement la modification de `unite_source_id` / `unite_cible_id` (pour changer la sémantique, supprimer et recréer).
- Server actions (`lib/actions/repartitions.ts`) : `createRepartitionAction` avec `useActionState` React 19 pour remonter les erreurs de validation dans le drawer côté client. `update` / `delete` standards. Admin guard sur les 3.
- `RepartitionDrawer` (client component) : panneau latéral avec date / source / cible (NULL = « Groupe ») / montant / libellé / notes. Erreurs de validation affichées inline.
- Bouton « Répartir » dans le header de la section « Par unité » de `/synthese` via le wrapper client `UnitesSection`.
- `UniteCard` enrichie : ligne « Réalloc » conditionnelle (apparaît si net ≠ 0) + le `Solde` affiché est désormais le solde net (`recettes - dépenses + realloc_net`).
- Détail unité enrichi : 4e stat card « Réalloc » conditionnelle (apparaît si net ≠ 0) + nouveau bloc « Répartitions de la saison » sous « Par activité ». Édition inline (date / libellé / montant) et suppression. Sens « → entrée » ou « ← sortie » selon l'unité courante.
- Vue « Tous » (`?exercice=tous`) : les répartitions sont agrégées toutes saisons confondues, cohérent avec les écritures.

### Hors scope (évolutions futures possibles)

- API REST sur `repartitions_unites` (pas de consommateur externe identifié)
- Multi-ventilation en une seule opération (ex. 3000 € Groupe → {FA: 600, LJ: 1200, SG: 1200} en une saisie)
- Sync Comptaweb des répartitions via `cw_create_recette` (créer des ventilations Comptaweb équivalentes pour aligner le compte de résultat officiel)
- Suggestion automatique depuis les effectifs (« N inscrits LJ × tarif unitaire → quote-part LJ »)

---

## Propriétés vérifiées

- **Solde groupe inchangé après répartition** : chaque répartition contribue `+X` côté cible et `-X` côté source. La somme des `realloc_net_cents` sur toutes les unités de la grille est par construction nulle. Les répartitions Groupe → unité enrichissent une unité sans décrémenter une autre carte (le « Groupe » n'est pas une ligne de la grille).
- **Anti-énumération inter-groupes** : toutes les fonctions service filtrent par `group_id = ?`. Aucune route ne révèle l'existence d'une donnée d'un autre groupe.
- **Permissions** : édition + saisie réservées à `tresorier` / `RG`. Lecture ouverte aux chefs scopés. `parent` redirigé vers `/synthese` s'il atteint `/budgets`.
- **Doctrine « pas de DELETE »** : appliquée aux tables métier protégées (écritures, justifs, remb, abandons, mouvements_caisse). `budget_lignes` et `repartitions_unites` en sont **exclues** — ce sont des tables de prévision et d'allocation, pas du métier comptable. Hard DELETE assumé et documenté.

---

## Liens

- [ADR-029](decisions.md#adr-029--modèle-budget-prévisionnel--saison--activité-pas-de-période) — Budgets : 1 saison + activité, pas de dimension `periode`.
- [ADR-030](decisions.md#adr-030--répartitions-baloo-only-entre-unités) — Répartitions Baloo-only, table dédiée, validation en code.
- [roadmap.md](roadmap.md) — Phase 2.
- [p2-pivot-webapp.md](p2-pivot-webapp.md) — Webapp comme source de vérité.
- [p2-workflows-internes.md](p2-workflows-internes.md) — Chantier qui précède (4 workflows self-service).
