# Remboursements — auto-ventilation d'un virement groupé selon ses demandes liées

- **Date** : 2026-07-24
- **Statut** : validé (brainstorming), à implémenter
- **Scope** : trésorier / RG, liaison demande de remboursement ↔ écriture comptable
- **Suite de** : `2026-07-21-remboursement-lien-ecriture-virement-groupe-design.md` (qui a levé les verrous du lien N→1 mais a explicitement laissé la découpe de l'écriture hors scope)

## Problème

Un même virement bancaire couvre plusieurs demandes de la même personne (cas réel : 1 virement de 470,32 € pour 5 demandes de Florence Mersch). Depuis la spec du 2026-07-21 on peut **lier** les 5 demandes à l'unique écriture du virement, mais l'écriture reste **mono-ligne** : `setRembsEcritureLink` ne fait que recopier le **premier** `unite_id` en `COALESCE` (ici *Louveteaux-Jeannettes*). Résultat : l'intégralité des 470,32 € est imputée à une seule unité, alors que les demandes couvrent des choses différentes (« We de groupe », « Camp Orange »…) → **imputation budgétaire fausse**.

L'attente légitime : que lier N demandes découpe l'écriture en N sous-lignes, une par demande, chacune sur son unité — le **grain canonique d'une écriture Baloo = la ventilation** (cf. AGENTS.md).

## Contrainte technique de départ

`ventilateDraft` (`ecritures-ventilate.ts`), le moteur de découpe existant, exige aujourd'hui que **chaque ligne ait catégorie + unité + activité non nulles** (garde-fou `incomplete`, lignes 70-73) et que **Σ lignes = montant de la tête** (`sum_mismatch`). Or une demande de remboursement ne porte que `unite_id` en imputation structurée (pas de `category_id` ni `activite_id` — juste un champ `nature` texte libre). On ne peut donc pas fabriquer de ventilations valides à partir des seules données des demandes sans assouplir `ventilateDraft`.

## Décisions de cadrage (validées)

1. **Somme demandes ≠ virement** → ajouter une ligne **« reste à imputer »** pour l'écart (uniquement en sous-couverture ; cf. dépassement ci-dessous).
2. **Délien** → **re-ventiler automatiquement** : l'écriture reflète toujours l'ensemble des demandes liées.
3. **Contrainte `incomplete`** → **assouplir globalement** : autoriser catégorie/activité (et unité) nulles sur les lignes de ventilation d'un draft. Sans danger pour le panneau manuel car sa validation de complétude est **côté client** (`canSaveVentilation`, `ventilate-editor-model.ts` — bouton « Enregistrer » désactivé tant qu'une ligne est incomplète). L'assouplissement du service ne profite qu'au chemin programmatique.

## Bloc 1 — Assouplir `ventilateDraft` (`web/src/lib/services/ecritures-ventilate.ts`)

Le garde-fou `incomplete` ne vérifie plus que le montant :

```ts
// Avant
const incomplete = ventilations.some(
  (v) => v.amount_cents === 0 || !v.category_id || !v.unite_id || !v.activite_id,
);
// Après
const incomplete = ventilations.some((v) => v.amount_cents === 0);
```

- Le check `sum_mismatch` (Σ = total) est **conservé** inchangé.
- Le reste de `ventilateDraft` (tête préservée, enfants recréés, transaction, garde-fou `child_has_attachments`) inchangé.
- La route `PUT /api/ecritures/[id]/ventilations` et son message `incomplete` restent en place (le service peut toujours renvoyer `incomplete` sur amount 0). Le panneau manuel garde son gating client strict → aucune régression UX manuelle.

## Bloc 2 — Helper `syncEcritureVentilationFromRembs` (`web/src/lib/services/remboursement-ecriture-link.ts`)

Nouvelle fonction appelée par `setRembsEcritureLink` **après** la mise à jour du FK `remboursements.ecriture_id`, aussi bien au lien (`ecritureId` non nul) qu'au délien (sur `previous`). Best-effort : toute erreur est loguée sans faire échouer la liaison.

```ts
export async function syncEcritureVentilationFromRembs(
  groupId: string,
  ecritureId: string,
): Promise<void>;
```

### Étapes

1. **Garde-fou draft** : lire l'écriture. Si absente, `status !== 'draft'`, ou `comptaweb_ecriture_id` non nul → **ne rien faire** (on ne touche jamais à une écriture matérialisée dans CW).
2. **Total du virement** : `montantVirement = |amount de la tête|`. Comme la tête peut déjà être ventilée (amount = une part), le total de référence est **Σ des montants du groupe** (`ventilation_group_id`) si groupe existant, sinon l'amount propre — invariant : Σ groupe = virement.
3. **Lignes demandes** : lire les remboursements liés à l'écriture (`WHERE ecriture_id = ?`), triés de façon **déterministe** (par `created_at`, puis `id`). Chaque demande → `{ amount_cents: |COALESCE(total_cents, amount_cents)|, unite_id, category_id: null, activite_id: null }`.
4. **Reste** : `reste = montantVirement − Σ montants demandes`.
   - `reste > 0` (sous-couverture) → append `{ amount_cents: reste, unite_id: null, category_id: null, activite_id: null }`.
   - `reste === 0` → pas de ligne reste.
   - `reste < 0` (dépassement) → **abandon** : on ne ventile pas, on laisse l'écriture en l'état (l'avertissement de dépassement existant côté UI reste la seule signalisation). Retour anticipé.
5. **Application** selon le nombre de lignes cibles :
   - **≥ 2 lignes** → `ventilateDraft({ groupId }, ecritureId, lignes)` (ventile ou re-ventile : les enfants sont supprimés puis recréés).
   - **1 ligne, écriture déjà ventilée** (`ventilation_group_id` non nul) → `ventilateDraft({ groupId }, ecritureId, [ligne])` → replie (supprime les enfants, tête = la ligne, `vg = null`).
   - **1 ligne, jamais ventilée** (demande unique, pas de vg) → **comportement historique conservé** : enrichissement `unite_id` en `COALESCE` (non destructif) sur la tête `draft`. Pas d'appel à `ventilateDraft` (qui, lui, **écraserait** l'unité).
   - **0 demande restante** → si l'écriture a un vg, replier en **mono-ligne pleine** : `ventilateDraft({ groupId }, ecritureId, [{ amount_cents: montantVirement, unite_id: null, category_id: null, activite_id: null }])` (supprime les enfants, remet la tête au montant plein, imputation nulle). Sinon rien.

Le contexte passé à `ventilateDraft` est `{ groupId }` **sans `scopeUniteIds`** : la server action de liaison est déjà réservée aux admins (`tresorier`/`RG`), pas de restriction d'unité.

### Invariant d'ancrage

Les remboursements restent **épinglés à la tête** (jamais réaffectés aux enfants). `ventilateDraft` préserve l'id de tête d'une re-ventilation à l'autre → l'ancre est stable. Les lignes-enfants n'ont **aucun** remboursement (ni justif direct, ni dépôt) → `deleteDraftEcriture` les supprime sans buter sur ses garde-fous (`has_attachments`). C'est ce qui rend la re-ventilation possible sans casser le lien N→1.

### Intégration dans `setRembsEcritureLink`

- Au lien : après l'UPDATE du FK, appeler `syncEcritureVentilationFromRembs(groupId, ecritureId)`. Le bloc `COALESCE unite_id` actuel (lignes 109-121) est **absorbé** par le cas « 1 ligne jamais ventilée » du helper → le retirer de `setRembsEcritureLink` pour éviter le double traitement.
- Au délien : après avoir mis `ecriture_id = null`, appeler `syncEcritureVentilationFromRembs(groupId, previous)` (l'écriture précédemment liée) pour re-ventiler / replier.

## Bloc 3 — Couverture au niveau du groupe de ventilation

Après ventilation, `tête.amount_cents` n'est plus le virement mais une part. Les indicateurs de couverture doivent lire le **total du groupe**.

- `getEcritureRembsCoverage(groupId, ecritureId)` : le dénominateur (`montantVirementCents`) devient **Σ `amount_cents` du `ventilation_group_id`** si l'écriture appartient à un groupe, sinon son propre `amount_cents`. Le numérateur (Σ totaux des demandes liées) est inchangé — les rembs pointent tous vers la tête, donc `WHERE ecriture_id = tête` suffit.
- Bundle côté écriture (`justificatifs.ts` → `EcritureJustifsBundle` + `justificatifs-card.tsx`) : la couverture affichée (`computeRembsCoverage`) doit utiliser le **total du groupe** comme montant du virement, pas l'amount de la seule tête. Le plus simple : exposer `ventilationGroupTotalCents` dans le bundle (ou faire calculer la couverture par `getEcritureRembsCoverage` déjà group-aware) et le passer à `JustificatifsCard` à la place de `ecritureAmountCents` pour ce calcul.

## Bloc 4 — Garde-fou candidats (`findEcritureCandidatesForRembs`)

Exclure les **lignes-enfants** de ventilation des candidates, pour qu'une demande ne puisse être liée qu'à la **tête** d'un virement (jamais à une sous-ligne interne, ce qui casserait l'invariant d'ancrage) :

```sql
AND (e.ventilation_group_id IS NULL
     OR EXISTS (SELECT 1 FROM remboursements r WHERE r.ecriture_id = e.id))
```

(Une écriture non ventilée reste candidate ; une tête de virement déjà ventilée reste candidate car elle porte des rembs ; les enfants sont masqués.)

## Limite assumée (v1)

La re-ventilation **reconstruit les lignes** à chaque changement de l'ensemble lié. Toute imputation manuelle (catégorie/activité) posée sur les sous-lignes — y compris la ligne « reste » — est **perdue** si on relie/délie ensuite une demande. Idem l'imputation manuelle de la tête (écrasée par la 1ʳᵉ ligne). Recommandation d'usage : **lier toutes les demandes, puis compléter l'imputation**. Mitigation par appariement demande↔ligne (préservation de l'imputation à la re-ventilation) = évolution ultérieure, YAGNI pour v1.

## Hors scope

- Réaffectation des remboursements par sous-ligne (les rembs restent épinglés à la tête).
- Appariement demande↔ligne pour préserver l'imputation manuelle à la re-ventilation.
- Outil MCP dédié.
- Contrainte SQL ajoutée (aucune nécessaire).

## Tests (TDD)

**`ventilateDraft` (assouplissement)** — `web/src/lib/services/__tests__/ecritures-ventilate.test.ts` :
- Accepte désormais des lignes à catégorie/activité/unité nulles (montant ≠ 0) → `ok: true`, pas de `incomplete`.
- Refuse toujours une ligne à `amount_cents === 0` (`incomplete`).
- Refuse toujours `sum_mismatch` (inchangé).

**`syncEcritureVentilationFromRembs`** (in-memory DB) :
- 2 demandes couvrant exactement → 2 lignes, unités des demandes, tête préservée.
- Sous-couverture → N lignes demandes + 1 ligne « reste » (montant = écart, imputation nulle), Σ = virement.
- Dépassement (Σ demandes > virement) → aucune ventilation, écriture inchangée.
- Délien 2→1 → repli en mono-ligne (enfants supprimés, `vg = null`).
- Délien →0 (dernière demande retirée) → mono-ligne pleine, montant = virement, imputation nulle.
- Demande unique jamais ventilée → pas de ventilation, `unite_id` en COALESCE (non destructif, ne remplace pas une unité déjà posée).
- Écriture non-`draft` ou dans CW → no-op.

**Couverture group-aware** :
- `getEcritureRembsCoverage` : après ventilation, dénominateur = Σ du groupe (= virement), pas l'amount de la tête ; `reste`/`depasse` corrects.

**Candidats** :
- `findEcritureCandidatesForRembs` : une sous-ligne-enfant de ventilation n'apparaît pas ; une tête de virement déjà ventilée (porteuse de rembs) apparaît toujours.

## Fichiers touchés (prévisionnel)

- `web/src/lib/services/ecritures-ventilate.ts` — assouplir `incomplete`.
- `web/src/lib/services/remboursement-ecriture-link.ts` — `syncEcritureVentilationFromRembs`, couverture group-aware (`getEcritureRembsCoverage`), filtre candidats, retrait du bloc COALESCE de `setRembsEcritureLink` (absorbé).
- `web/src/lib/actions/remboursements/link.ts` — inchangé (déjà via `setRembsEcritureLink`) sauf éventuel message « ventilé » ; à confirmer au plan.
- `web/src/lib/services/justificatifs.ts` — total du groupe pour la couverture du bundle.
- `web/src/components/ecritures/justificatifs-card.tsx` — couverture sur total du groupe.
- Tests des services concernés.
