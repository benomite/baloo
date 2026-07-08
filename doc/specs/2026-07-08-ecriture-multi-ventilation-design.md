# Spec — Écriture multi-ventilation (S0, socle du chantier « N catégories → 1 pièce »)

**Date** : 2026-07-08
**Statut** : design validé (modèle + frontière S0), prêt à plan d'impl
**Sous-projet** : **S0** — socle technique du chantier multi-ventilation. Débloque les sous-projets A (dépôt), B (remboursement), #20 (split bancaire), C (répartition parent).

---

## Contexte

Trois besoins terrain convergent vers une même mécanique : **un montant unique doit se répartir sur plusieurs imputations comptables (catégories), sans perdre l'information, tout en restant une seule pièce côté Comptaweb.**

1. **Camp orange (dépôt multi-catégories)** — les chefs font de grosses courses quasi intégralement « intendance », plus quelques euros de « petit matériel » et « pharmacie ». Aujourd'hui un dépôt de justificatif n'a **qu'une** catégorie → l'info des postes secondaires est perdue au rattachement.
2. **Chefs rouges (remboursement multi-lignes catégorisées)** — 8 à 10 tickets payés de leur poche, à rembourser en **un seul** virement, mais ventilés sur des catégories différentes.
3. **Rentrée / paiements parents (répartition institutionnelle)** — chaque paiement d'inscription se répartit entre part **groupe**, part **territoire**, part **national** SGDF. Répétitif, gros volume en septembre.

L'[issue #20](https://github.com/benomite/baloo/issues/20) (split manuel d'une ligne bancaire) est la 4ᵉ facette du même besoin.

### Découverte structurante

La couche basse Comptaweb **supporte déjà nativement les N ventilations** : `buildPostBody` (`web/src/lib/comptaweb/ecritures-write.ts:91-98`) itère `input.ventilations[]` et poste `ecriturecomptable[ecriturecomptabledetails][i][montant|nature|activite|brancheprojet]`. `validateInput` (`:110-115`) valide même déjà que **somme des ventilations = montant total** (tolérance 0,005). Le seul verrou est un **bridage volontaire** de l'adapter Baloo (`ecritures-create-cw-adapter.ts:26-29,148-155` : « une seule ventilation »). **On ne touche pas au scraper — on débride la couche au-dessus.**

## Le concept unifié et sa décomposition

« 1 seule écriture au final » = le modèle Comptaweb : **1 pièce portant N lignes de ventilation**. Côté Baloo, le **grain canonique reste la ventilation** (ADR-035) : une pièce à N ventilations = **N lignes `ecritures`**, chacune mono-catégorie, reliées entre elles. On ne casse pas ce grain (il fait marcher les budgets par catégorie/unité) — on le *branche* sur les dépôts et remboursements.

| # | Sous-projet | Path d'écriture | Dépend de |
|---|---|---|---|
| **S0** | Socle : écriture multi-ventilation + UI création | create-and-push | — |
| **A** | Dépôt multi-catégories (camp orange) | split d'existant | S0 |
| **B** | Remboursement multi-catégories (chefs rouges) | create-and-push | S0 |
| **#20** | Split manuel d'une ligne bancaire | split d'existant | S0 |
| **C** | Répartition parent groupe/territoire/national | create-and-push (recette) + template | S0 |

Chaque sous-projet aura son propre spec. **Ce document ne détaille que S0.**

## Modèle validé (décision structurante)

Une pièce à N ventilations = **N lignes `ecritures`** partageant une clé de regroupement. Aujourd'hui ce regroupement se fait à l'affichage par `comptaweb_ecriture_id` — mais celui-ci **n'existe pas tant que CW n'a pas répondu**. Un brouillon multi-ventilation créé dans Baloo n'a donc **aucune clé** pour relier ses N lignes.

→ **On ajoute `ecritures.ventilation_group_id TEXT`** : id local, généré à la création, partagé par les N lignes d'un même groupe. Il coexiste avec `comptaweb_ecriture_id` une fois la pièce dans CW. C'est le pivot de S0.

> **Terminologie** : on dit **« ventilation »** (cohérent avec CW et le grain ADR-035). Le mot « répartition » est **déjà pris** (`repartitions_unites` = mouvement de montant unité↔unité, sans catégorie — ne rien confondre).

---

## Périmètre S0

### A. Modèle de données
- Migration additive : `ALTER TABLE ecritures ADD COLUMN ventilation_group_id TEXT` (nullable), dans `auth/schema.ts` (convention libsql : `ADD COLUMN` nullable + backfill si besoin ; index **après** l'ALTER). Définition complète aussi au `CREATE TABLE` de `business-schema.ts` (BDD vierges).
- Index : `CREATE INDEX idx_ecritures_ventilation_group ON ecritures(ventilation_group_id)` dans `auth/schema.ts`, après l'ALTER.
- Type `Ecriture` (côté queries/UI) : ajouter `ventilation_group_id: string | null`.

### B. Payload → N ventilations
`EcriturePayload` (`ecritures-create.ts:70-83`) passe de champs scalaires à :
- **En-tête** : `date_ecriture`, `description`, `amount_cents` (**total**), `type`, `mode_paiement_id`, `numero_piece`, `carte_id`, `notes`, `justif_attendu`.
- **`ventilations: VentilationInput[]`** avec `VentilationInput = { amount_cents, category_id, unite_id, activite_id }`.
- **Rétro-compat** : une saisie mono-catégorie = 1 ventilation. Invariant dur validé en amont : **Σ ventilations.amount_cents === amount_cents**.

### C. Adapter CW (débridage)
`buildCwInputFromPayload` (`ecritures-create-cw-adapter.ts:95-157`) : remplacer le `ventilations: [{…}]` mono-ligne par un `.map` sur `payload.ventilations`, avec **résolution des `comptaweb_id` (nature/activité/branche-unité) par ligne**. Message d'erreur précis si un mapping manque **sur une ligne donnée** (indiquer laquelle). Retirer le commentaire de bridage (`:26-29`). Le mode de paiement / carte restent au niveau en-tête.

### D. Service create-and-push (transitions groupées)
`createEcritureAndPushToCw` (`ecritures-create.ts:125-255`) :
1. **Si N ≥ 2** : génère un `ventilation_group_id` (id local). **Si N = 1** (cas nominal) : `ventilation_group_id` reste `null` — comportement strictement inchangé, une seule ligne comme aujourd'hui.
2. **N INSERT `ecritures`** (une par ventilation), toutes `status='pending_cw'`, même `ventilation_group_id`, même en-tête (date/libellé/type/pièce/mode/carte), `amount_cents`/`category_id`/`unite_id`/`activite_id` propres à chaque ventilation.
3. **1 seul POST CW** (via le scraper, 1 pièce N ventilations).
4. Succès → **UPDATE des N lignes** : `status='pending_sync'`, même `cw_numero_piece` + `comptaweb_ecriture_id` (transition atomique sur le groupe).
5. Échec CW → **rollback des N en `draft`** ensemble. **Zéro DELETE** (règle CLAUDE.md). Les erreurs typées (`CwPushFailedError`/`CwLocalUpdateFailedError`) portent le `ventilation_group_id` (ou l'id de la 1ʳᵉ ligne) pour le reroutage.

### E. Route POST `/api/ecritures`
`createSchema` (`route.ts:66-79`) : accepter un tableau `ventilations` (chaque item : `amount_cents` int, `category_id`/`unite_id`/`activite_id` nullish), garder l'en-tête. Validation Zod « Σ ventilations = amount_cents » (refus 400 sinon). Le reste du handler (contexte, gestion d'erreurs 502/500) inchangé.

### F. UI — wizard `/ecritures/nouveau`
Point d'entrée existant (`ecritures/nouveau/page.tsx` → `nouvelle-ecriture-wizard.tsx` → `EcritureFormFields`).
- Le bloc **catégorie / unité / activité / montant** devient un **répéteur de ventilations** : chaque ligne = montant + `InlineSelect` catégorie/unité/activité (réutilise les composants inline existants).
- Bouton **« + Ajouter une ventilation »**.
- Compteur **« reste à ventiler »** = `amount_cents (total) − Σ lignes`, mis à jour en direct.
- Bouton **Valider bloqué** tant que le reste ≠ 0 ou qu'une ligne est incomplète (reflète `validateInput` déjà en place côté scraper).
- `readPayloadFromForm` / `handleSubmitToCw` produisent le tableau `ventilations`.
- Cas nominal mono-catégorie : une seule ligne pré-affichée, UX inchangée pour l'usage courant.

### G. Affichage groupé
`ecritures-table.tsx` (grouping dans un `useMemo`, `:130-188`) : ajouter **`ventilation_group_id` comme 3ᵉ clé** de regroupement.
- `GroupKind = 'bank' | 'cw' | 'ventil'`.
- 3ᵉ `Map` `byVentil`, branche dans `groupFor`, entrée dans `GROUP_STYLE` (rail vertical + teinte de fond).
- Généraliser les ternaires binaires (`groupEntries`, `selectGroup`, `:230-243`).
- Header = total signé + `count` « ventilations » ; sous-lignes = les ventilations. Permet de voir un brouillon multi-ventilation groupé **avant** son passage dans CW.
- Le regroupement `'ventil'` ne s'active que si **≥ 2** lignes partagent un `ventilation_group_id` non nul (cohérent avec le seuil `isCwGrouped ≥ 2`). Une écriture mono-catégorie (`ventilation_group_id` null) s'affiche comme aujourd'hui, sans header.

### H. Sync (point de vigilance)
Au succès, les N lignes locales partagent un seul `cw_numero_piece`/`comptaweb_ecriture_id`. La sync incrémentale devra ré-apparier chacune des N ventilations CW à la bonne ligne locale (par montant + catégorie) — c'est ce que fait déjà `reconcileVentilations` pour les écritures importées. **À vérifier explicitement au smoke test** (pas de doublon, pas de divergent après un cycle de sync).

## Hors périmètre S0 (chaque item → son propre lot)
- **Chemin de push « validation d'un draft bancaire »** (`drafts.ts::syncDraftToComptaweb`, `draft`→`mirror`) : bride aussi à 1 ventilation, mais c'est le cœur de #20/A (split d'un existant). **Non débridé dans S0.**
- **UI de dépôt / remboursement multi-catégories** : sous-projets A et B.
- **Répartition institutionnelle + templates de ventilation** : sous-projet C.
- **Édition inline des ventilations d'une pièce déjà en base** : utile mais pas requis pour la chaîne de création ; à évaluer avec A/#20.

## Tests
Unitaires (vitest, BDD in-memory, pattern existant) :
- `createEcritureAndPushToCw` : N INSERT au même `ventilation_group_id` ; succès → N lignes `pending_sync` avec même `cw_numero_piece` ; échec CW → N lignes `draft` (fake scraper qui throw) ; aucun DELETE.
- `buildCwInputFromPayload` : N ventilations mappées ; Σ ≠ total → erreur ; mapping manquant sur une ligne → message pointant la ligne.
- Route `createSchema` : rejet Σ ≠ amount_cents ; acceptation mono-ligne (rétro-compat).
- Grouping `ecritures-table` : N lignes même `ventilation_group_id` → 1 header + N sous-lignes ; priorité des familles inchangée.

## Smoke test CW (validation end-to-end, manuelle, validée par Benoît)
Créer via `/ecritures/nouveau` **une vraie pièce à 2 ventilations** (ex. 100 € = 70 Intendance + 30 Petit matériel), pousser dans Comptaweb, vérifier : (1) une seule pièce CW avec 2 lignes de ventilation ; (2) les 2 lignes `ecritures` en `pending_sync` groupées ; (3) après un `sync_run`, promotion en `mirror` sans doublon ni divergent (point H). Nettoyage CW si besoin.

## Fichiers touchés (S0)
- `web/src/lib/db/business-schema.ts` — colonne au `CREATE TABLE`.
- `web/src/lib/auth/schema.ts` — `ALTER ADD COLUMN` + index.
- `web/src/lib/services/ecritures-create.ts` — `EcriturePayload` + N INSERT groupés + transitions.
- `web/src/lib/services/ecritures-create-cw-adapter.ts` — débridage `buildCwInputFromPayload`.
- `web/src/app/api/ecritures/route.ts` — `createSchema` multi-ventilations + validation somme.
- `web/src/components/ecritures/nouvelle-ecriture-wizard.tsx` — payload multi-ventilations.
- `web/src/components/ecritures/ecriture-form.tsx` — répéteur + reste à ventiler.
- `web/src/components/ecritures/ecritures-table.tsx` — 3ᵉ clé de regroupement.
- Type `Ecriture` (queries) — champ `ventilation_group_id`.
- Tests associés.

## Décisions prises (sauf objection à la relecture)
1. **Modèle** : N lignes `ecritures` groupées par `ventilation_group_id`, 1 pièce CW à N ventilations. ✅ validé.
2. **Frontière S0** : plomberie + **une** UI de bout en bout (`/ecritures/nouveau`). ✅ validé.
3. **Smoke test** : un vrai push CW à 2 ventilations. ✅ validé.
4. **Débridage création uniquement** (pas `drafts.ts`) — reporté à #20/A.
5. **Réutilisation `reconcileVentilations`** pour la sync — vérifié au smoke test.
