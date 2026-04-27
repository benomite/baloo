# Mode dev — règles pour faire évoluer Baloo lui-même

Ce document est lu **uniquement** quand l'utilisateur demande explicitement de travailler sur Baloo en tant que projet (ajouter/modifier un skill, mettre à jour la doc, refactorer la structure, créer un ADR, etc.). En usage normal, Baloo est en mode assistant et ne touche pas à sa propre architecture.

## Déclencheurs du mode dev

L'utilisateur dit explicitement quelque chose comme :
- "on passe en mode dev"
- "on va modifier Baloo"
- "ajoute un skill pour X"
- "mets à jour la doc / la roadmap / un ADR"
- "refactor …"

Sans déclencheur explicite, **ne pas modifier** les fichiers de `doc/`, `sgdf-core/skills/`, `skills/`, ni la structure globale du projet.

## Principes généraux

1. **La doc est la source de vérité de la conception.** Avant tout changement structurel, lire les fichiers pertinents de `doc/` (en particulier `architecture.md`, `roadmap.md`, `decisions.md`).
2. **Toute décision structurelle nouvelle = un nouvel ADR** dans `doc/decisions.md`. Format : titre, date, statut, contexte, décision, conséquences. Incrémenter le numéro ADR-00X.
3. **Ne jamais "améliorer" sans raison** : la vision et la roadmap sont volontairement minimalistes. Pas de features spéculatives, pas de refactor cosmétique.
4. **Respecter la séparation générique / spécifique** (ADR-003 puis [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)). En cas de doute sur où placer une info : si elle est partageable avec un autre groupe SGDF → `sgdf-core/` (markdown, en git) ; si elle dépend d'un user ou d'un groupe spécifique → BDD (`data/baloo.db`, gitignored). Aucune donnée nominative ou financière dans le repo.
5. **Git discipline** : commits atomiques, messages en français au présent de l'indicatif. Voir la section "Git" plus bas.

## Ajouter ou modifier un skill

Référence : [`process-skills.md`](process-skills.md).

Règles :
- Un skill = un dossier dans `sgdf-core/skills/<nom>/` si générique, ou `skills/<nom>/` à la racine si spécifique au groupe — contenant au minimum un `SKILL.md`.
- Le `SKILL.md` suit la structure : *Quand l'utiliser*, *Informations nécessaires*, *Étapes*, *Pièges connus*.
- Un skill doit être compréhensible sans lire le reste du projet — autonome.
- Avant de créer un nouveau skill, vérifier qu'il n'en existe pas un similaire à compléter à la place.
- Lors de la modification d'un skill existant, éviter de casser son interface (ce qu'il demande en entrée, ce qu'il produit). Si c'est inévitable, noter le changement dans un ADR.

## Modifier la mémoire (BDD + `sgdf-core/`)

Note : la mémoire est aussi modifiée en **mode assistant** au fil de l'usage (notes, personnes, écritures via le MCP `baloo-compta`). Les règles ci-dessous concernent les modifications **structurelles** (refondre une table, ajouter une convention de notes, modifier le contenu de `sgdf-core/`).

- Suivre les conventions de [`memory-design.md`](memory-design.md) : faits atomiques, dates ISO, pas de résumés, mise à jour plutôt que suppression pour les infos qui deviennent obsolètes.
- Ne pas inventer de contenu. Si une info manque, demander à l'utilisateur plutôt que combler avec des suppositions.
- Avant d'ajouter un fichier, vérifier qu'un fichier existant ne couvre pas déjà le sujet.

## Modifier la doc (`doc/`)

- Garder chaque fichier **focalisé** sur son sujet. Ne pas dupliquer entre fichiers ; préférer les liens croisés.
- Mettre à jour `doc/README.md` si un fichier est ajouté ou renommé.
- Les dates écrites dans les docs doivent être des dates absolues (ISO 8601), pas des formulations relatives ("le mois prochain").
- Quand une décision change, **mettre à jour l'ADR existant** en passant son statut à "remplacé par ADR-00Y" et créer un nouvel ADR. Ne jamais réécrire l'historique d'un ADR accepté.

## Respect de la roadmap

Avant d'introduire une nouvelle dépendance, une nouvelle couche technique ou une nouvelle brique :

1. Vérifier dans [`roadmap.md`](roadmap.md) qu'elle n'est pas **volontairement exclue** de la phase actuelle.
2. Si elle l'est, **demander confirmation** à l'utilisateur avant de procéder. La roadmap est un garde-fou contre la sur-ingénierie ; la contourner doit être un choix conscient.
3. Si c'est accepté, créer un ADR pour documenter la décision.

## Sécurité

- Ne jamais commiter de secrets, tokens, clés d'API, RIBs, mails exportés, pièces justificatives. Le `.gitignore` doit rester strict — si on y touche, c'est toujours pour **ajouter** des exclusions, rarement pour en retirer.
- Les données spécifiques au groupe (BDD : personnes, comptes, montants, etc.) ne doivent jamais être copiées dans `sgdf-core/` ni dans `doc/`, même par erreur. En cas de doute, ne rien déplacer et demander.
- Si on envisage un remote git, **vérifier qu'il est privé** avant tout push.

## Git

- Repo local pour l'instant, pas de remote (à décider plus tard).
- Un commit = un changement cohérent. Pas de "wip" ni de gros commits mélangeant plusieurs sujets.
- Messages en français, présent de l'indicatif, style court : *"ajoute skill remboursement"*, *"corrige convention de date dans memory-design"*, *"ADR-007 : vector store en phase 3"*.
- Branches : pas de workflow branches pour l'instant (solo, petit projet). Si ça évolue, documenter ici.
- Ne jamais utiliser `--no-verify`, `--force`, ni `git reset --hard` sans validation de l'utilisateur.

## Checklist avant de "finir" un changement en mode dev

- [ ] La doc concernée est à jour (README du dossier, fichier thématique, ADR si décision structurelle).
- [ ] Aucun secret ni donnée perso n'a été introduit dans les fichiers trackés.
- [ ] La séparation générique (`sgdf-core/`, en git) vs spécifique (BDD, gitignored) est respectée. Aucune donnée nominative ou financière dans le repo.
- [ ] Si un nouveau pattern est introduit, il est documenté quelque part dans `doc/`.
- [ ] Commit atomique avec un message clair.
- [ ] L'utilisateur a été informé de ce qui a été fait (résumé court en fin de réponse).

## Ce qu'on ne fait PAS en mode dev (sauf demande explicite)

- Introduire une base de données, un vector store, un framework de mémoire.
- Ajouter une dépendance Python/Node.
- Créer une webapp, un bot, une API.
- Publier un remote public.
- Refactorer la structure globale "pour faire plus propre".
- Ajouter des tests, du CI, des hooks.

Ces points sont soit volontairement hors scope, soit à traiter en phase 3 (voir roadmap).
