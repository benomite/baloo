# Refonte de la fiche remboursement — Design

**Date :** 2026-07-27
**Statut :** validé (design), spec à relire avant plan
**Portée :** page détail `/remboursements/[id]`, formulaire d'édition, gardes de
transition, action de conversion, action de liaison écriture, rendu PDF feuille.

## Objectif

Rendre la fiche remboursement plus logique et plus lisible, à partir de 9 retours
terrain. Trois natures de changement : (A) logique/permissions, (B) bug feuille
PDF, (C) refonte visuelle.

## Contexte actuel (fichiers concernés)

- `web/src/app/(app)/remboursements/[id]/page.tsx` — page détail (server
  component) : timeline, sections Demandeur / Détail / Coordonnées bancaires /
  Modifier notes-RIB / Actions ; sidebar : EcritureLinkCard / Feuille /
  Signatures / Justificatifs (avec rattachement justif→lignes en `<details>`).
- `web/src/components/rembs/detail-depenses-table.tsx` — tableau des lignes
  (lecture), affiche déjà `justifsParLigne` en pastilles.
- `web/src/components/rembs/remboursement-form.tsx` — formulaire création/édition
  des lignes. Grille desktop `sm:grid-cols-[110px_100px_1fr_140px_auto]`
  (Type / **Date 100px** / Nature 1fr / Montant 140px / supprimer).
- `web/src/components/rembs/ecriture-link-card.tsx` — carte liaison écriture
  (sidebar).
- `web/src/lib/services/remboursements-transitions.ts` — garde pure des
  transitions (from + allowedRoles).
- `web/src/lib/actions/remboursements/convert.ts` — action convertir en dépôt
  (aujourd'hui : `ADMIN_ROLES`, pas de contrôle de statut).
- `web/src/lib/actions/remboursements/link.ts` — actions lier / délier écriture.
- `web/src/lib/services/remboursement-signing.ts` +
  `web/src/lib/pdf/feuille-remboursement.ts` — génération feuille PDF (pdfkit).
- `web/src/lib/actions/remboursements/create.ts` — appelle
  `signAndRefreshRemboursementPdf` en **best-effort** (try/catch → `logError`).

Workflow des statuts : `a_traiter → valide_tresorier → valide_rg →
virement_effectue → termine` (+ `refuse`, `converti`).

## A. Logique & permissions

### A1 — Refuser : uniquement avant validation RG
Refus autorisé depuis `a_traiter` et `valide_tresorier` seulement.

- `remboursements-transitions.ts` : `refuse.from = ['a_traiter',
  'valide_tresorier']` (retirer `valide_rg`, `virement_effectue`).
- Page : `canRefuse = isAdmin && ['a_traiter','valide_tresorier'].includes(status)`.
- Source de vérité = la garde ; l'UI ne fait que refléter.

### A2 — Convertir en dépôt : trésorier seul, avant toute validation
- Action `convertRembToDepot` : exiger `ctx.role === 'tresorier'` (plus
  `ADMIN_ROLES`) **et** statut `a_traiter` (charger le rembs pour vérifier ;
  sinon redirect erreur). La garde vit côté action, pas seulement dans l'UI.
- Page : `canConvert = isTresorier && status === 'a_traiter'`.

### A3 — Lier à une écriture : seulement à partir du virement
- `EcritureLinkCard` reçoit `status`. Sélecteur d'écriture affiché uniquement si
  `status ∈ {virement_effectue, termine}`. Vue « liée + délier » si déjà lié.
- Avant `virement_effectue` : message informatif « L'écriture comptable n'existe
  qu'une fois le virement effectué — reviens ici à ce moment-là. » (pas de
  sélecteur).
- Garde serveur : `linkRemboursementToEcriture` refuse si statut <
  `virement_effectue` (redirect erreur).

### A4 — Lier → passage en « terminé » automatique
- Après un lien réussi (donc depuis `virement_effectue`),
  `linkRemboursementToEcriture` déclenche la transition vers `termine` via le
  même chemin que les autres transitions (`remboursement-transition.ts` /
  `signAndRefreshRemboursementPdf`, pour garder signature + feuille à jour).
  Best-effort : si la transition échoue, le lien reste posé et on logue (le lien
  ne doit pas être perdu).
- `unlinkRemboursementFromEcriture` : si le statut est `termine`, repli vers
  `virement_effectue` (le passage en terminé venait du lien ; le délier l'annule).
- Le bouton « Marquer terminé » reste disponible en `virement_effectue` pour les
  demandes sans écriture à lier (ex. espèces).

## B. Bug feuille de remboursement (PDF jamais généré)

### Symptôme
« La feuille de remboursement n'existe jamais. » Or elle EST câblée à la création
(`create.ts` → `signAndRefreshRemboursementPdf` → `renderFeuilleRemboursementPdf`
→ `attachJustificatif('remboursement_feuille')`), mais l'appel est best-effort
(try/catch → `logError('remboursements', 'Signature + génération PDF feuille
échouée', err)`).

### Cause probable
pdfkit lit ses métriques de police AFM (`Helvetica.afm`, …) via `fs` au runtime.
Sur Vercel, ces fichiers ne sont pas embarqués par le file-tracing → le rendu
`throw` → feuille silencieusement jamais attachée.

### Étapes
1. **Confirmer** dans `/admin/errors` (module `remboursements`) que l'erreur est
   bien un échec de lecture de police / rendu pdfkit. Reproduire au besoin le
   chemin de bundling (test qui rend un PDF sans accès au dossier de polices de
   pdfkit).
2. **Fix** : enregistrer une police **TTF bundlée dans le repo** via
   `doc.registerFont('body', <chemin .ttf>)` + `doc.font('body')`, pour ne plus
   dépendre des AFM lues par `fs`. La police est un `.ttf` libre ajouté sous
   `web/src/lib/pdf/fonts/` (ou `web/public/fonts/`), lue par chemin absolu
   résolu depuis le module. Vérifier que le tracing Vercel l'embarque (au besoin
   `outputFileTracingIncludes` dans `next.config`).
3. **Garde-fou** : test unitaire `renderFeuilleRemboursementPdf` → buffer PDF non
   vide (commence par `%PDF`), sans dépendre des AFM par défaut.

> Note : si `/admin/errors` révèle une autre cause que les polices, on ajuste le
> fix en conséquence (systematic-debugging : confirmer avant de corriger). Le
> design ci-dessus est l'hypothèse la plus probable.

## C. Refonte visuelle

### C1 — Fusionner Coordonnées bancaires + RIB en un bloc compact
Aujourd'hui deux sections (`rib_texte` en gros bloc mono + fichiers RIB) prennent
autant de place que le détail. Ce sont deux formats de la **même info**,
purement informative pour le trésorier.

- Un seul bloc compact « Coordonnées bancaires » **dans la sidebar** :
  - `rib_texte` sur 1-2 lignes en mono, taille réduite (tronqué visuellement si
    long, lisible en entier au survol/expand léger si besoin).
  - lien(s) fichier RIB inline (icône + nom), même ligne visuelle que le reste.
  - si rien : une ligne discrète « Aucune coordonnée fournie ».
- Nettement moins de hauteur que les deux sections actuelles.

### C2 — Justifs par ligne (approche « depuis la dépense »)
Remplacer l'UX actuelle (déplier chaque justif dans la sidebar → cocher les
lignes) par une liaison **ligne → justif(s)** dans le détail des dépenses.

- Dans « Détail des dépenses » (colonne principale, donc haut de page), sous
  chaque ligne :
  - si justif(s) rattaché(s) : `📎 nom-du-fichier` (lien ouvre le justif) +
    action `changer`/`retirer`.
  - sinon / pour ajouter : `+ rattacher un justif ▾` → liste des justifs de la
    demande (cases à cocher, multi-justif possible par ligne).
- Modèle de données inchangé (relation M:N justif↔ligne, table d'assignation
  existante). On ajoute une action orientée ligne : `assignLigneJustifs(rbtId,
  ligneId, justifIds[])` (ou réutilisation inversée de l'existant). Réservé aux
  admins, comme aujourd'hui.
- L'upload de fichiers reste **au niveau demande** (une zone d'ajout unique), les
  fichiers uploadés deviennent disponibles au rattachement par ligne.
- La couverture (`computeCouverture`) continue d'alimenter le sous-titre « N
  détails avec justif rattaché ».

### C3 — Justifs plus visibles / plus haut
- Grâce à C2, les justifs apparaissent inline dans le détail (haut de page) →
  résout l'essentiel du retour.
- La **zone d'ajout de fichier** passe juste sous le détail des dépenses (colonne
  principale), plus en bas de sidebar.
- Réordonner la sidebar : EcritureLink → Coordonnées bancaires (compact) →
  Feuille → Signatures.
- Garder une petite liste « Justificatifs de la demande (N) » (fichiers +
  feuille/RIB exclus) accessible, mais elle n'est plus le lieu du rattachement.

### C4 — Date de ligne lisible en édition
Le champ est déjà `type="date"` mais sa colonne desktop fait `100px` → date +
icône calendrier illisibles / difficiles à cliquer.

- Élargir la colonne Date dans la grille desktop : passer
  `sm:grid-cols-[110px_100px_1fr_140px_auto]` à une Date d'au moins `150px`
  (ex. `sm:grid-cols-[100px_150px_1fr_130px_auto]`, ajuster Type/Montant pour
  tenir). Vérifier mobile (pleine largeur, déjà OK).

## Tests

- **A1/A2/A3/A4 (purs)** : `remboursements-transitions.test.ts` — refuse
  autorisé depuis a_traiter/valide_tresorier, refusé ailleurs ; termine depuis
  virement_effectue. Tests des gardes d'action (rôle + statut) pour convert et
  link.
- **A4** : test d'intégration lien → statut `termine` ; délien depuis termine →
  `virement_effectue`.
- **B** : `renderFeuilleRemboursementPdf` produit un buffer `%PDF…` non vide avec
  la police bundlée.
- **C1/C2/C4** : composants isolés (bloc RIB compact ; ligne + rattachement
  justif ; grille édition avec date élargie) — rendu + interaction de base.

## Hors périmètre (YAGNI)

- Pas d'upload de justif directement par ligne (upload reste au niveau demande).
- Pas de refonte du modèle de signatures ni de la timeline.
- Pas de matrice justifs × lignes (approche par ligne retenue).

## Décisions tranchées

- Refuser : `a_traiter` + `valide_tresorier` uniquement.
- Convertir : trésorier seul, `a_traiter` uniquement.
- Lier : seulement à partir de `virement_effectue` ; lier ⇒ `termine` auto ;
  délier depuis `termine` ⇒ retour `virement_effectue`.
- Justif↔ligne : liaison depuis la ligne (pas de matrice, pas d'abandon du
  rattachement par ligne).
- Feuille : bug PDF à corriger (police TTF bundlée), pas une nouvelle feature.
