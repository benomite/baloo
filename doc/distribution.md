# Distribution future

Réflexions sur ce que deviendrait Baloo si on visait au-delà d'un usage personnel. **Aucune de ces décisions n'est à prendre au MVP** — ce document existe pour guider les choix actuels afin de **ne pas se fermer de portes**.

## Pourquoi ça mérite d'y penser maintenant

Il y a ~700 groupes SGDF en France. Ils ont tous :
- un·e trésorier·e bénévole, souvent isolé·e ;
- les mêmes outils imposés (Compta-Web, Intranet SGDF) ;
- les mêmes process réglementaires ;
- les mêmes galères.

Un outil qui marche pour un groupe a de fortes chances d'être utile à d'autres. L'investissement en formalisation de process (la mémoire `sgdf-core/`) est un **actif mutualisable**.

## Les trois modèles de distribution possibles

### Modèle A — Open source à installer soi-même
Repo git public, l'utilisateur clone, lance Claude Code, suit la doc.

**Avantages** : zéro coût, zéro responsabilité juridique, pédagogique.
**Inconvénients** : exclut ~95% des trésoriers bénévoles (installer git + Claude Code est hors de portée). Réservé à une niche de trésoriers techniques.

### Modèle B — App mobile/desktop packagée
Une vraie app (Electron, Tauri, ou native) qui embarque l'agent et se connecte à l'API Claude avec la clé de l'utilisateur.

**Avantages** : installation simple, pas d'hébergement central.
**Inconvénients** : l'utilisateur doit quand même créer un compte Anthropic et payer l'API, on doit distribuer et maintenir une app par plateforme, mises à jour de la mémoire = updates d'app.

### Modèle C — SaaS multi-tenant
Webapp (ou bot Telegram/WhatsApp) hébergée, auth par groupe, backend qui tourne des agents pour le compte des users.

**Avantages** : zéro friction côté utilisateur, mises à jour instantanées, le plus accessible.
**Inconvénients** : on paie l'API pour tous les users, on héberge, on est responsable RGPD, on doit facturer pour être soutenable.

**Modèle cible si on va au bout : C.** C'est le seul qui atteint vraiment le public visé.

## Ce que ça implique dès maintenant

Même en phase 1, on a pris des décisions qui préservent l'option SaaS :

1. **Séparation `sgdf-core/` vs données spécifiques au groupe** (cf. [ADR-003](decisions.md), [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)). Le core est le futur "template produit" ; les données privées vivent en BDD (gitignored).
2. **Processus en skills markdown.** Un skill est un morceau portable. Il marche en local (Claude Code) et plus tard côté backend (Agent SDK ou agent serveur webapp) sans modification.
3. **Zéro secret dans les fichiers trackés.** Clés, tokens, exports bruts → `.env`, BDD locale ou keychain ; jamais commités.
4. **Schéma BDD multi-tenant dès le jour 1** (`group_id` partout), même si activé tardivement (cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)).

## Ce qu'on construit, et quand

Le pivot d'archi (cf. [`roadmap.md`](roadmap.md)) précise *quand* chaque brique apparaît :

- **P1 (MVP CLI)** : pas d'auth, pas de webapp en prod, pas de déploiement. SQLite local, MCP, Claude Code.
- **P2 (ouverture intra-groupe)** : webapp `web/` déployée, **auth multi-user activée**, **API HTTP** comme couche métier, BDD côté webapp (probablement Postgres). Le MCP `baloo-compta` devient un client HTTP.
- **P3 (multi-groupes)** : activation effective du multi-tenant, onboarding, mutualisation infra. **Pas** de reconstruction de la webapp/auth (déjà livrées en P2).
- **P4 (SaaS)** : facturation, CGU, sous-traitance RGPD, DPO, assurance.

Discipline qui reste valable : **rien "au cas où"**. On n'introduit pas pgvector, l'Agent SDK ou un agent serveur tant qu'un user concret ne l'attend pas.

## Questions juridiques à anticiper (sans résoudre maintenant)

- **Statut juridique** du projet distribué (asso loi 1901 dédiée ? entreprise ? rester à titre perso ?).
- **Contrat de sous-traitance RGPD** : obligatoire si on traite les données d'autres assos.
- **DPO** : peut être externe / mutualisé, mais doit exister.
- **CGU, politique de confidentialité.**
- **Assurance RC pro** si on devient responsable de données financières.
- **Affiliation SGDF** : est-ce qu'on veut être endorsé par la fédération ? Avec quels pièges (gouvernance, conformité renforcée) ?

Ces sujets sont à instruire **avant la phase 4**, pas avant. La phase 2 ouvre l'outil aux autres rôles **du même groupe** : pas de relation contractuelle avec d'autres assos, pas encore de sous-traitance RGPD à formaliser.

## Signal d'alarme

Si à un moment du projet on se surprend à coder une feature "pour les futurs utilisateurs SaaS" alors qu'on est encore en phase 1, 2 ou 3, **il faut s'arrêter**. C'est le chemin le plus rapide pour construire un produit que personne (pas même l'auteur) n'utilise vraiment. Le test : est-ce qu'un user concret de la phase courante l'attend ? Sinon, on attend.
