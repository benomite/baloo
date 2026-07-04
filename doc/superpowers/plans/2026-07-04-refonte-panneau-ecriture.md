# Refonte panneau écriture — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development pour exécuter ce plan tâche par tâche. Steps en cases à cocher.

**Goal:** Rendre le panneau de détail d'une écriture compact, adapté à l'état, justif-first ; supprimer la page détail `/ecritures/[id]` (redirection) sans perte de fonction.

**Architecture:** La ligne repliée reste le poste de travail (imputation inline déjà excellente). Le panneau devient l'exception centrée sur le justif, adaptatif selon l'état (draft-banque / draft-manuel / mirror). Un seul composant panneau, rendu inline sous la ligne OU épinglé en haut (fetch autonome) via `?open=<id>`. `/ecritures/[id]` redirige vers la liste.

**Tech Stack:** Next 16 (App Router, server actions), React client components, Tailwind, vitest + @testing-library/react (jsdom).

**Réf design:** `doc/superpowers/specs/2026-07-04-refonte-panneau-ecriture-design.md`.

## Global Constraints

- Aucune action serveur supprimée : `updateEcriture`, `updateEcritureField`, `updateEcritureStatus`, `syncDraft`, `resync`, `deleteDraft`, `sendRelance`, `CwAssist`, attach/share dépôt — toutes réutilisées.
- Verrouillage inchangé : champs sync en lecture seule si `status ∈ {mirror, divergent}`.
- Parité obligatoire avant de toucher `/ecritures/[id]` : Copier-pour-CW, relance justif, lien remboursement, info mirror doivent exister dans le panneau.
- Réutiliser `InlineSelect` / `InlineText` (mêmes chips que la ligne) pour toute édition dans le panneau — pas de nouveau style de `<select>`.
- Pas d'autosave. Pas de refonte du wizard `/ecritures/nouveau`. Pas de refonte sync CW.
- Exécuter les tests via `./node_modules/.bin/vitest` depuis `web/` (pnpm cassé). `tsc --noEmit` + `eslint` propres à chaque tâche.
- Ne jamais pousser sans accord (Vercel auto-deploy).

---

### Task 1: Modèle de vue du panneau (pur, testable)

**Files:**
- Create: `web/src/components/ecritures/panel-view-model.ts`
- Test: `web/src/components/ecritures/__tests__/panel-view-model.test.ts`

**Interfaces:**
- Produces: `panelViewModel(ecriture: Pick<Ecriture,'status'|'ligne_bancaire_id'|'comptaweb_ecriture_id'|'type'|'justif_attendu'>): { mode: 'edit-bank' | 'edit-manual' | 'readonly'; editable: boolean; primary: 'valider' | 'sync' | 'marquer-miroir' | 'copier-cw' | 'none'; showIdentityInline: boolean }`

**Règles:**
- `mode='readonly'` si `status ∈ {mirror, divergent}` (editable=false).
- sinon `mode='edit-bank'` si `ligne_bancaire_id != null`, `mode='edit-manual'` sinon (editable=true).
- `showIdentityInline` = `mode==='edit-manual'` (identité prioritaire pour une saisie manuelle ; démotée pour la banque).
- `primary` : draft→`valider` ; pending_sync sans cw id→`marquer-miroir`/`sync` (choix : `sync`) ; readonly→`copier-cw` ; sinon `none`. (Détail exact des transitions : voir `updateEcritureStatus` existant.)

- [ ] Step 1 — écrire les tests (une assertion par branche : mirror→readonly ; draft+ligne_bancaire→edit-bank ; draft sans ligne→edit-manual ; primary par état).
- [ ] Step 2 — run, voir échouer (module absent).
- [ ] Step 3 — implémenter `panelViewModel`.
- [ ] Step 4 — run, vert.
- [ ] Step 5 — tsc + eslint + commit.

---

### Task 2: Header compact du panneau

**Files:**
- Create: `web/src/components/ecritures/panel-header.tsx`

**Contenu:** titre (réutilise `InlineText` si editable, nudge `titre_a_renommer` ; sinon texte) · montant (`Amount`, tone signé) · date courte · puce d'état (`● Brouillon` / `🔒 Synchro CW` / `⚠ À compléter` — dérivée de `panelViewModel` + `computeReadiness`) · origine banque `#id` condensée (remplace le gros `Alert`) · bouton `⋯` (slot) · bouton `×` (`onCollapse`).

**Acceptance:** rendu compact 1–2 lignes ; pas de gros bandeau ; titre éditable seulement si editable ; clic titre ne ferme pas le panneau.

- [ ] Step 1 — composant + props (`ecriture`, `readiness`, `onCollapse`, `menuSlot`).
- [ ] Step 2 — tsc + eslint + commit.

---

### Task 3: Résumé lecture seule (mirror/divergent)

**Files:**
- Create: `web/src/components/ecritures/panel-readonly-summary.tsx`

**Contenu:** liste dense `Unité · Catégorie · Activité · Carte`, `n° pièce`, lien remboursement si `remboursement_id`. Aucun `<form>`, aucun champ `disabled`. Champs Baloo-only encore éditables (notes, `justif_attendu`) exposés via `⋯` (Task 6), pas ici.

- [ ] Step 1 — composant (props = ecriture + libellés joints déjà sur `Ecriture`).
- [ ] Step 2 — tsc + eslint + commit.

---

### Task 4: Bloc imputation en chips partagés

**Files:**
- Create: `web/src/components/ecritures/panel-imputation.tsx`

**Contenu:** 2 colonnes responsive de chips `InlineSelect` (mêmes que la ligne) : unité, catégorie, activité (rappel — édités via `updateEcritureField` + `refreshRow`), **mode de paiement**, **carte** (absents de la ligne). Case « justif attendu » compacte (aide en `title`, pas 3 lignes). Ligne `⚠ manque : …` si incomplet (issue de `computeReadiness`, pas une boîte). Désactivé si `!editable`.

**Interfaces:** Consumes `updateEcritureField(id, field, value)` (existant, renvoie `{ok}`), `refreshRow`.

- [ ] Step 1 — composant, réutilise `InlineSelect` avec les options mode/carte.
- [ ] Step 2 — tsc + eslint + commit.

---

### Task 5: Bloc justif compacté + relance intégrée

**Files:**
- Modify: `web/src/components/ecritures/justificatifs-card.tsx`
- Create: `web/src/components/ecritures/panel-relance.tsx` (extrait de `RelanceCard` de `[id]/page.tsx`)

**Contenu:** compacter `JustificatifsCard` (retirer sous-titres verbeux, resserrer). Ajouter un bloc **relance** repliable (admin only) réutilisant `sendRelance` (déplacé depuis la page détail). Prop `defaultOpenRelance?` pour l'open-to-section.

**Acceptance:** upload, réutiliser-justif (partage), rattacher-dépôt, voir/télécharger, relance — tous présents et plus compacts.

- [ ] Step 1 — extraire `RelanceCard` → `panel-relance.tsx` (composant + garde admin).
- [ ] Step 2 — compacter `JustificatifsCard`, y insérer la relance.
- [ ] Step 3 — tsc + eslint + commit.

---

### Task 6: Menu `⋯` + barre d'action collante

**Files:**
- Create: `web/src/components/ecritures/panel-actions-menu.tsx`
- Create: `web/src/components/ecritures/panel-sticky-actions.tsx`

**Menu `⋯`:** éditer identité (date/type/montant/n° pièce — draft) · Notes · **Copier pour CW** (réutilise `CwAssistActions`) · Repasser brouillon · Marquer miroir CW · Supprimer le brouillon (draft, garde-fous) · Ouvrir la ligne bancaire.
**Barre collante:** action primaire selon `panelViewModel.primary` (`sticky bottom-0`), + bouton Enregistrer si un champ du form identité a changé (dirty).

**Acceptance:** popover fermable (clic dehors + Échap), pas de dialog bloquant (cf. contraintes browser). Toutes les actions rares du cycle de vie s'y trouvent.

- [ ] Step 1 — menu (popover maison, pattern `SyncErrorPopover`).
- [ ] Step 2 — sticky actions.
- [ ] Step 3 — tsc + eslint + commit.

---

### Task 7: Orchestration du panneau (assemblage adaptatif, justif-first)

**Files:**
- Modify: `web/src/components/ecritures/ecriture-inline-panel.tsx`

**Contenu:** remplacer le corps actuel par l'assemblage : `PanelHeader` → si `mode==='readonly'` `PanelReadonlySummary` sinon [ `JustificatifsCard`+relance (**en premier**) → `PanelImputation` (rappel) → identité repliée si `edit-manual` visible ] → `PanelStickyActions`. Menu `⋯` branché au header. Nouvelle prop `focusSection?: 'justif'`.

**Acceptance:** un mirror n'affiche AUCUN form ; un draft-banque s'ouvre sur le justif ; l'action primaire est correcte ; parité (copier-CW, relance, lien remb) présente.

- [ ] Step 1 — réécrire le rendu en composant adaptatif (utilise `panelViewModel`).
- [ ] Step 2 — tsc + eslint ; test de rendu (jsdom) : mirror→pas de `<form>` d'édition, draft-banque→justif avant imputation, primary correct.
- [ ] Step 3 — commit.

---

### Task 8: Panneau autonome (mode épinglé) + `?open`

**Files:**
- Modify: `web/src/components/ecritures/ecriture-inline-panel.tsx` (accepter un mode « standalone » : si pas d'`ecriture` fournie via ligne, utiliser l'écriture chargée par `fetchEcritureDetail`)
- Modify: `web/src/components/ecritures/ecritures-table.tsx` et/ou `ecritures-infinite-list.tsx`
- Modify: `web/src/lib/actions/ecritures.ts` (`fetchEcritureDetail` renvoie déjà `ecriture` — OK)

**Contenu:** la liste lit `?open=<id>` (via `useSearchParams` ou prop) → `openId`. Si `openId` correspond à une ligne chargée → rendu inline (existant). Sinon → **panneau épinglé** en haut de la liste, alimenté par `fetchEcritureDetail(openId)` (le panneau utilise l'écriture fraîche du fetch au lieu de la ligne). Un seul panneau ouvert à la fois. Fermeture retire `?open`.

**Acceptance:** `/ecritures?open=<id>` ouvre le bon panneau même si l'écriture n'est pas dans la page ; clic ligne fonctionne comme avant.

- [ ] Step 1 — panneau : rendre `ecriture` optionnelle, fallback sur le detail fetché.
- [ ] Step 2 — liste : état `openId` initialisé depuis `?open`, rendu épinglé si hors-page.
- [ ] Step 3 — tsc + eslint ; test : `?open` id hors-page → panneau épinglé fetch.
- [ ] Step 4 — commit.

---

### Task 9: Open-to-section depuis la ligne

**Files:**
- Modify: `web/src/components/ecritures/ecritures-table.tsx`

**Contenu:** la puce « sans justif » de la ligne devient cliquable (stopPropagation) → ouvre le panneau avec `focusSection='justif'` (scroll/focus sur le bloc justif). Le reste de la ligne : clic = ouvre panneau normal.

- [ ] Step 1 — brancher le clic « sans justif » → `setOpenId(id)` + `focusSection`.
- [ ] Step 2 — tsc + eslint + commit.

---

### Task 10: Redirection de la page détail

**Files:**
- Modify: `web/src/app/(app)/ecritures/[id]/page.tsx` → `redirect('/ecritures?open=' + id)` (garder `generateMetadata`/params).
- Modify: `web/src/components/ecritures/ecritures-table.tsx` (cmd-clic `window.open('/ecritures/[id]')` → inchangé, la route redirige ; OU pointer directement `/ecritures?open=`).
- Modify: `web/src/components/ecritures/ecriture-inline-panel.tsx` (retirer le lien « Page complète » devenu inutile).

**Vérif liens entrants** (doivent aboutir après redirection) : `remboursements/page.tsx`, `camps/[id]/page.tsx`, `rembs/ecriture-link-card.tsx`, `nouvelle-ecriture-wizard.tsx` (`router.push`), redirections serveur `attachDepotFromEcriture`/`shareDepotFromEcriture` (`redirect('/ecritures/[id]')` → atterrissent sur la redirection → OK, ou les pointer sur `/ecritures?open=`).

- [ ] Step 1 — remplacer le corps de `[id]/page.tsx` par la redirection.
- [ ] Step 2 — ajuster les redirections serveur dépôt pour viser `/ecritures?open=<id>` (évite un double hop).
- [ ] Step 3 — retirer « Page complète » du panneau.
- [ ] Step 4 — tsc + eslint ; smoke test manuel des liens ; commit.

---

### Task 11: Nettoyage + parité finale

**Files:**
- Modify: `web/src/components/ecritures/ecriture-form.tsx` (si des sous-parties ont été extraites, retirer le mort ; sinon laisser — le wizard `/nouveau` l'utilise encore).

**Contenu:** vérifier qu'aucun code mort ne subsiste, que le wizard `/nouveau` (qui utilise `EcritureFormFields`) n'est pas cassé, que la parité est complète. Revue finale whole-branch.

- [ ] Step 1 — grep des imports morts, `EcritureForm`/`EcritureFormFields` encore utilisés par `/nouveau` (ne pas casser).
- [ ] Step 2 — suite complète verte, tsc + eslint propres.
- [ ] Step 3 — revue whole-branch, commit.

---

## Self-review
- Couverture spec : header/état ✓ (T2), readonly ✓ (T3), imputation chips ✓ (T4), justif-first + relance ✓ (T5,T7), menu+sticky ✓ (T6), autonome+?open ✓ (T8), open-to-section ✓ (T9), redirection page détail ✓ (T10), parité (copier-CW/relance/lien remb) ✓ (T5,T6,T3).
- Risque principal : `EcritureFormFields` est partagé avec `/ecritures/nouveau` — ne pas le démanteler (T11 garde-fou).
- Risque pagination `?open` traité en T8 (panneau épinglé autonome).
