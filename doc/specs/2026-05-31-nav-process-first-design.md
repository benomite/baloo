# Refonte navigation v2 — façade « process » + administration repliée

**Date** : 2026-05-31
**Statut** : Design validé (brainstorming)
**Suite de** : [ADR-033](../decisions.md) / [`2026-05-20-refonte-navigation-design.md`](2026-05-20-refonte-navigation-design.md)

## Contexte

L'ADR-033 (2026-05-20) a rangé la nav desktop par *intention* (Piloter /
Saisir / Demandes & dépôts / Gérer). À l'usage, ce découpage ne correspond
pas à la façon dont l'outil est réellement utilisé. La vraie ligne de
fracture est entre :

1. **Les process** — ce que (presque) tout le monde vient faire, chacun avec
   sa contrepartie de suivi côté admin :
   - déposer un justificatif (+ liste des dépôts côté admin) ;
   - faire une demande de remboursement (+ liste à traiter) ;
   - faire une demande d'abandon de frais (+ vue admin).
2. **La gestion courante** — le travail compta du trésorier :
   - écritures + rapprochement (avec les suggestions automatiques) ;
   - caisse.

Le « tableau de bord » (Accueil, Inbox, Synthèse, Budget) n'apporte pas la
valeur attendue en façade et encombre. On le dégraisse.

## Décision

Inverser la hiérarchie : **les process en façade, la gestion courante
repliée derrière un bloc « Administration »**. Une seule source de vérité
reste `web/src/components/layout/nav-config.ts`, consommée par la sidebar
desktop et la bottom-nav mobile (principe ADR-033 conservé : le viewport
décide l'expérience, le rôle décide le contenu).

### 1. Sidebar desktop à deux étages

```
PROCESS                              (filtré par rôle)
  📎 Déposer        membre → /depot        | admin → /depots (suivi)
  💸 Remboursements membre → mes demandes  | admin → liste à traiter  (/remboursements)
  🎁 Abandons       membre → ma demande    | admin → liste à traiter  (/abandons)

ADMINISTRATION ▾                     (admin only, repliée par défaut)
  📖 Écritures   (+ rapprochement, suggestions inbox intégrées, lien Budget dans le header)
  🪙 Caisse
  ───────────
  🤖 Connexion Claude
  ✉️ Membres
  🛡️ Journal d'erreurs
```

- **Process** = entrées *role-switched* : le membre arrive sur son
  formulaire / sa liste perso, l'admin sur la liste de suivi à traiter. La
  contrepartie admin de chaque process vit DANS la façade, pas dans
  Administration.
- **Administration** = uniquement la gestion courante (Écritures, Caisse) +
  le système (Connexion Claude, Membres, Journal d'erreurs). Bloc
  **repliable, replié par défaut**, visible admin uniquement (groupe masqué
  si vide selon le rôle, comme ADR-033).
- L'admin atterrissant au login sur `/ecritures` (cf. §3), son driver
  quotidien reste à portée immédiate même replié.

### 2. Matrice de rôles

| Entrée            | tresorier / RG | chef / equipier | parent            |
|-------------------|----------------|-----------------|-------------------|
| Déposer           | ✅ (suivi /depots) | ✅ (/depot)   | ❌                |
| Remboursements    | ✅ (à traiter) | ✅ (mes demandes) | ✅ (« Mes reçus ») |
| Abandons          | ✅ (à traiter) | ✅ (ma demande) | ❌                |
| **Administration**| ✅             | ❌              | ❌                |

(Aligné sur ADR-033 : formulaires de demande unifiés, parent exclu de la
saisie pour autrui ; abandon ouvert aux membres non-parent.)

### 3. Routing & nettoyage

- **`/` (Accueil)** : page dashboard **supprimée**. La route `/` devient une
  **redirection par rôle** : admin (tresorier/RG) → `/ecritures` ; les autres
  → `/depot` (ou `/remboursements` pour un parent, qui n'a pas `/depot`).
- **`/inbox`** : page **supprimée** (route + composant). Sa fonction de
  suggestions de rapprochement est **intégrée dans `/ecritures`**. Le matching
  justif↔écriture reste assuré par les outils MCP (`inbox_auto_match`,
  `inbox_suggest_matches`) — seul le *front* `/inbox` disparaît.
- **`/synthese`** : **supprimée pour de bon** (route + composant).
- **`/budgets`** : route **conservée**, **hors nav**. Accès via un **lien dans
  le header de `/ecritures`**. Le chantier budgets par unité (PR #9-11) n'est
  pas touché ; on y reviendra plus tard.
- `/import` et `/cloture` : inchangés (déjà hors nav, accès par lien direct).

### 4. Bottom-nav mobile

Accueil retiré. Onglets (role-filtered) :

```
[ 📎 Déposer ] [ 💸 Remb ] [ 🎁 Abandons ] [ ⋯ Plus ]
```

- **tresorier / RG** : Déposer · Remb · Abandons · **Plus** (tiroir = section
  Administration : Écritures, Caisse, système).
- **chef / equipier** : Déposer · Remb · Abandons (pas de Plus).
- **parent** : **Mes reçus** (= /remboursements) à la place de Déposer, pas
  d'Abandons, pas de Plus.

L'ordre du tableau `MOBILE_TABS` = ordre d'affichage (contrainte ADR-033
conservée).

## Conséquences

- **Pas de migration BDD** : refonte front + routes pures, comme ADR-033.
  Risque cold-start nul.
- **Suppressions de code** : pages `/inbox` et `/synthese` retirées. Vérifier
  qu'aucun lien interne ne pointe vers elles (sinon rediriger / retirer).
  L'ancienne home dashboard est remplacée par une redirection.
- **`nav-config.ts` retravaillé** : le type `Intent` (`piloter | saisir |
  demandes | gerer`) est remplacé par la dualité `process | administration`.
  `NavGroup` gagne un flag `collapsible` (+ `defaultCollapsed`) pour le bloc
  Administration. Les entrées Process portent une cible/label *role-aware*
  (membre vs admin) plutôt qu'un simple filtre `roles`.
- **Redirection `/`** : nouvelle logique serveur (rôle → route). Attention au
  piège Next 16 `force-dynamic` (auth/cookies) déjà documenté dans
  `web/AGENTS.md`.
- **Intégration inbox→écritures** : les suggestions de rapprochement
  remontent dans la page `/ecritures`. Le périmètre exact (bandeau, panneau
  latéral, section) est à préciser au plan d'implémentation.

## Hors scope

- Vue budget par unité (chantier séparé, juste un lien depuis `/ecritures`).
- Refonte des formulaires de demande (déjà unifiés en ADR-033).
- Toute migration BDD.

## Fichiers impactés (pressentis)

- `web/src/components/layout/nav-config.ts` — refonte du modèle (groupes
  Process / Administration, role-switch, collapsible).
- `web/src/components/layout/sidebar.tsx` — rendu du bloc repliable.
- `web/src/components/layout/bottom-nav.tsx` / `mobile-shell.tsx` /
  `mobile-nav.tsx` — onglets process + tiroir Plus = Administration.
- `web/src/app/(app)/page.tsx` — Accueil → redirection par rôle.
- `web/src/app/(app)/inbox/` — suppression ; logique de suggestions déplacée.
- `web/src/app/(app)/ecritures/` — accueil des suggestions de rapprochement
  + lien Budget dans le header.
- `web/src/app/(app)/synthese/` — suppression.
