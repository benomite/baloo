# Roadmap

Le projet est pensé en **4 phases** progressives. Chaque phase est validée avant d'investir dans la suivante. Le principe directeur : **ne pas construire pour un besoin non validé**.

---

## Phase 1 — MVP perso (maintenant → ~3 mois)

**Objectif** : l'auteur utilise Baloo tous les jours pour tenir la compta et l'orga du groupe.

**Livrables** :
- `CLAUDE.md` décrivant l'asso, le rôle de l'assistant, les conventions.
- Mémoire `mon-groupe/` remplie avec les infos essentielles (personnes, comptes, process).
- **Vue compta opérationnelle** dans `mon-groupe/finances.md` : budget voté, état Compta-Web (via export CSV manuel), suivi par unité, écarts, points d'attention. Mise à jour à chaque nouvel export.
- `sgdf-core/` commencé (glossaire, process compta génériques).
- MCPs Notion + Gmail configurés et fonctionnels.
- 2-3 premiers skills (`remboursement`, `adhesion`, au choix).
- **Format structuré** pour stocker remboursements / dépenses opérationnelles dans `mon-groupe/` — première brique du remplacement Airtable + Sheet (cf. ADR-007). Convention de format à fixer dans un ADR dédié quand on attaquera.
- Dossier versionné en git (repo privé).

**Stack** : Claude Code + markdown + MCPs. Rien d'autre.

**Coût** : 0€ marginal (abo Max existant).

**Critère de succès** : au bout de 3 mois, l'auteur ouvre Claude Code dans `baloo/` au moins 3 fois par semaine pour des tâches réelles, pas pour tester.

**Risques principaux** :
- Formaliser la mémoire prend plus de temps que prévu → OK, c'est l'investissement principal du projet.
- Les MCPs ne couvrent pas certains outils clés → on documente les manques, on ajoute des tools custom uniquement si bloquant.

---

## Phase 2 — Validation élargie (mois 3 → 6)

**Objectif** : confirmer que le besoin existe au-delà de l'auteur.

**Livrables** :
- 2 à 3 trésoriers d'autres groupes SGDF testent Baloo en local (installation accompagnée en personne).
- Retours formalisés : qu'est-ce qui bloque ? qu'est-ce qu'ils utilisent vraiment ?
- `sgdf-core/` enrichi des besoins génériques observés.
- **Première expérimentation de saisie assistée Compta-Web** : checklists, données pré-formatées prêtes à recopier, voire automation navigateur (Claude in Chrome) sur quelques opérations simples. Pas de saisie autonome, juste assistance. Cf. ADR-007.
- **Client API Comptaweb (reverse engineering)** — lecture des écritures (y compris **lignes bancaires non rapprochées avec sous-lignes DSP2 enrichies**, cf. [ADR-012](decisions.md)) + création de dépenses/recettes, via un client TypeScript intégré au MCP `baloo-compta`. Scope fermé (pas de suppression, pas d'admin, pas de rapprochement bancaire automatique). Safety : dry-run par défaut, confirmation explicite requise. Cf. [ADR-011](decisions.md), [ADR-012](decisions.md) et [`comptaweb-api.md`](comptaweb-api.md).
- **Auth Comptaweb user-friendly** (phase 2 tardive ou 3) — le MVP s'appuie sur un cookie de session copié manuellement depuis le navigateur (durée de vie limitée, à recopier à expiration). À remplacer par une authentification automatisée : soit scriptage du form login Keycloak (fragile vs changements côté SGDF), soit flow OIDC Authorization Code + PKCE officiel si Keycloak SGDF accepte un `redirect_uri` local (à demander au support). Inacceptable de laisser le recopiage manuel en production.
- Décision go/no-go pour la phase 3.

**Stack** : identique à la phase 1.

**Coût** : 0€.

**Critère de succès** : au moins 1 utilisateur externe utilise Baloo spontanément (sans être relancé) après 1 mois.

**Décision clé de fin de phase** : est-ce que ça vaut le coup d'investir dans un produit ? Si non, on reste en solo, c'est déjà une victoire personnelle.

---

## Phase 3 — Produit hébergé (mois 6 → 12, si phase 2 concluante)

**Objectif** : transformer Baloo en service utilisable sans terminal, sans installation.

**Livrables** :
- Backend (Agent SDK, Python ou TypeScript).
- Base de données Postgres (données structurées + recherche sémantique via pgvector).
- Webapp responsive (Next.js probablement) **ou** bot Telegram/WhatsApp Business comme interface principale.
- Auth multi-user, multi-tenant.
- Migration des skills markdown existants en process exécutables côté backend.
- Hébergement VPS (Hetzner ~5€/mois) ou Fly.io.

**Stack probable** : Python/TS + Agent SDK + Postgres + Next.js + VPS.

**Coût** : 20-50€/mois d'infra + coût API Claude proportionnel aux users (prompt caching obligatoire pour maîtriser ça).

**Critère de succès** : 5+ groupes actifs, feedback positif, auteur pas seul à maintenir.

**Piège à éviter** : construire la webapp avant d'avoir les process validés en phase 1/2. Les skills et la mémoire doivent être stables **avant** qu'on les mette derrière une UI.

---

## Phase 4 — SaaS (optionnel, si phase 3 décolle)

**Objectif** : soutenabilité financière et juridique.

**Livrables** :
- Modèle de facturation (5-15€/groupe/mois, couvre largement les coûts API).
- CGU, politique de confidentialité.
- Contrat de sous-traitance RGPD (on traite les données d'autres assos).
- DPO identifié (peut rester externe/mutualisé).
- Processus de support minimal.

**Coût** : temps principalement. Si le projet vit en asso loi 1901 dédiée, montage juridique à prévoir.

**Critère de succès** : autofinancé (revenus ≥ coûts), sans sacrifier la qualité pour l'auteur initial.

---

## Règles transverses

- **Chaque phase doit être "arrêtable".** Si on s'arrête après la phase 1, l'auteur a quand même un outil utile. Si on s'arrête après la phase 2, d'autres trésoriers ont un outil utile. Etc.
- **Aucune décision d'archi n'est prise "au cas où".** On décide au plus tard possible.
- **Les données et les process survivent au code.** Tout ce qui est écrit en markdown en phase 1 est réutilisable en phase 3, peu importe le langage final.
