# Journal des décisions

Un ADR ("Architecture Decision Record") léger : chaque décision structurelle est datée, motivée, et peut être révisée plus tard si le contexte change. À compléter au fil du projet.

Format : **titre**, date, statut, contexte, décision, conséquences.

---

## ADR-001 — Runtime d'agent : Claude Code (pas Agent SDK) au MVP
**Date** : 2026-04-13
**Statut** : accepté

**Contexte** : il faut un moteur d'agent. Deux options : Claude Code (CLI, déjà installé, couvert par abo Max) ou Agent SDK (bibliothèque à intégrer dans du code custom).

**Décision** : utiliser **Claude Code** au MVP. L'Agent SDK sera introduit uniquement si/quand on passe en phase 3 (webapp / service hébergé).

**Raisons** :
- Coût marginal nul (abo Max existant).
- Aucun code à écrire pour démarrer.
- Pas besoin d'un service qui tourne sans l'utilisateur devant l'écran avant la phase 3.
- Permet de se concentrer sur le contenu (mémoire, process) plutôt que sur la tuyauterie.

**Conséquences** :
- Pas d'accès mobile au MVP (assumé).
- Tout ce qui est MCP doit être configuré côté Claude Code (pas de tool custom "facile" avant qu'on passe au SDK).
- Le jour où on migre vers l'Agent SDK, les skills et la mémoire markdown sont réutilisables tels quels.

---

## ADR-002 — Mémoire : fichiers markdown versionnés en git
**Date** : 2026-04-13
**Statut** : accepté

**Contexte** : il faut stocker une mémoire long terme. Options : fichiers markdown, base SQLite, Postgres + pgvector, framework type Mem0/Letta, Notion comme source de vérité.

**Décision** : **fichiers markdown** organisés par thème, versionnés avec git.

**Raisons** :
- Lisibles sans l'agent, indépendants de toute techno.
- Diffables, versionnables, auditables.
- Zéro infra, zéro dépendance.
- Alignés avec le fonctionnement natif de Claude Code.
- Migrables vers n'importe quelle base le jour où le volume le justifie.

**Conséquences** :
- Pas de recherche sémantique au MVP (suffisant à notre échelle).
- Limite de volume : à partir de quelques centaines de fichiers, il faudra pgvector — ce sera le signal pour la phase 3.
- Les conventions de structuration (ADR-004) deviennent critiques pour la lisibilité.

---

## ADR-003 — Séparation `sgdf-core/` vs `mon-groupe/` dès le jour 1
**Date** : 2026-04-13
**Statut** : accepté

**Contexte** : on envisage à terme une distribution du projet. Faut-il structurer maintenant pour préserver cette option, ou rester ultra-simple quitte à refactorer ?

**Décision** : **séparer dès le jour 1** le contenu générique SGDF (`sgdf-core/`) des données privées du groupe (`mon-groupe/`).

**Raisons** :
- Coût de mise en place nul (juste deux dossiers).
- Coût d'un refactor tardif non nul (il faut relire et re-classer chaque fichier).
- Permet un repo public pour `sgdf-core/` le jour voulu sans fuite de données privées.
- Discipline cognitive : force à distinguer "ce qui est commun à tous les groupes" vs "ce qui est spécifique au nôtre".

**Conséquences** :
- Au démarrage, `sgdf-core/` sera presque vide — c'est normal, il se remplira par extraction au fil du temps.
- Les skills auront la même séparation (`sgdf-core/skills/` vs `mon-groupe/skills/`).

---

## ADR-004 — Extraction plutôt que résumé pour la mémoire
**Date** : 2026-04-13
**Statut** : accepté

**Contexte** : comment stocker les informations issues des échanges ? Résumés de conversation, ou faits discrets ?

**Décision** : toujours **extraire des faits atomiques**, datés quand pertinent, et les ranger dans le fichier thématique approprié. Pas de "journal de conversation".

**Raisons** :
- Bonnes pratiques établies (voir [`references.md`](references.md)).
- Les résumés deviennent du texte opaque qui ne se met pas à jour proprement.
- Les faits atomiques sont recherchables, modifiables, supprimables individuellement.

**Conséquences** :
- L'agent doit savoir où ranger chaque type d'info → précisé dans `CLAUDE.md`.
- Demande une discipline d'écriture plus stricte, mais évite la dégradation de la mémoire dans le temps.

---

## ADR-005 — Interface MVP : terminal uniquement
**Date** : 2026-04-13
**Statut** : accepté

**Contexte** : l'utilisateur veut à terme un accès mobile. Faut-il prévoir une interface "jolie" dès le MVP ?

**Décision** : **CLI Claude Code uniquement** au MVP. Pas de bot, pas de webapp, pas de GUI.

**Raisons** :
- L'objectif du MVP est de valider la valeur de l'assistant, pas l'interface.
- Une interface custom demande du code, de l'hébergement et des choix qu'il est prématuré de faire.
- Le mobile devient un problème de **déploiement** quand la phase 3 arrivera — pas un problème de conception maintenant.

**Conséquences** :
- Pas d'accès mobile au MVP (assumé et acceptable).
- Pas de test utilisateur au-delà de l'auteur pendant la phase 1.

---

## ADR-006 — Skills comme format de process métier
**Date** : 2026-04-13
**Statut** : accepté

**Contexte** : comment formaliser les process récurrents (remboursement, adhésion, clôture de camp…) ?

**Décision** : chaque process est un **skill Claude Code** (un dossier avec un `SKILL.md` structuré).

**Raisons** :
- Portable entre Claude Code (MVP) et Agent SDK (phase 3) sans modification.
- Lisible par n'importe quel bénévole, pas besoin d'être développeur pour amender.
- Versionnable, partageable, distribuable via `sgdf-core/skills/` plus tard.

**Conséquences** :
- Les skills sont un actif central au même titre que la mémoire.
- Les conventions d'écriture de skills doivent être stables (voir [`process-skills.md`](process-skills.md)).

---

## ADR-007 — Outil compta unifié : Compta-Web reste maître, Baloo devient l'amont
**Date** : 2026-04-14
**Statut** : accepté

**Contexte** : aujourd'hui le trésorier jongle entre Airtable (suivi remboursements), un Google Sheet `Compta Unités` (suivi opérationnel par unité), et Compta-Web (compta officielle SGDF). C'est redondant, fragile, et personne n'a de vue d'ensemble. Le trésorier veut **un outil unique** côté groupe pour remplacer Airtable + le Sheet.

Compta-Web est imposé par l'asso nationale et ne peut **pas** être remplacé.

**Décision** :
1. **Compta-Web reste la source de vérité comptable**, non négociable.
2. Baloo (et la mémoire `mon-groupe/`) devient progressivement le **remplaçant d'Airtable + du Sheet** : tous les flux opérationnels (remboursements, suivi par unité, justificatifs, état des dépenses des chefs) y sont saisis et stockés sous forme de données structurées en markdown.
3. La relation avec Compta-Web est unidirectionnelle : Baloo **aide à remplir Compta-Web correctement**. Cible long terme : **saisie automatisée** (via API si elle existe un jour, sinon automation navigateur). Pas de double saisie, pas de divergence assumée.
4. Le sens de la sync inverse (Compta-Web → Baloo) est l'**import d'exports CSV** (cf. `inbox/`), pour confronter le réel à l'opérationnel et calculer écarts/restes à faire.

**Raisons** :
- Cohérent avec les principes directeurs de [`vision.md`](vision.md) : Compta-Web reste source de vérité, Baloo est un assistant amont.
- Évite une double saisie destructrice de confiance.
- Permet de progresser par étapes : (a) fichiers markdown structurés en remplacement d'Airtable/Sheet → (b) assistance à la saisie Compta-Web (checklists, pré-remplissage) → (c) automation complète.
- Ne crée aucune dépendance technique nouvelle au MVP : on continue en markdown.

**Conséquences** :
- Le format de stockage des remboursements / écritures opérationnelles dans `mon-groupe/` doit être **structuré** (pas du texte libre) pour pouvoir un jour être lu/écrit par du code. Convention à fixer dans un prochain ADR quand on attaquera concrètement.
- Tant qu'aucun MCP officiel SGDF n'existe, la sync vers Compta-Web reste manuelle (l'utilisateur fait la saisie en s'appuyant sur Baloo).
- L'automation navigateur (Claude in Chrome) est un candidat sérieux pour l'étape (c) — à évaluer en phase 2.
- Airtable et le Sheet restent en service tant que leur remplaçant Baloo n'est pas opérationnel. Pas de big bang.

---

## ADR-008 — Penser multi-tenant dès la phase 1, sans le construire
**Date** : 2026-04-14
**Statut** : accepté

**Contexte** : le trésorier rêve à long terme d'un Baloo "OS agentique SaaS" pour tous les groupes SGDF (cf. [`vision.md`](vision.md), phase 4). Cette vision est **assumée comme lointaine**. Question : est-ce qu'on en tient compte dans les choix de phase 1, au risque de sur-ingéniérier ?

**Décision** : oui, mais en **mode discipline cognitive**, pas en mode construction.
- Quand on conçoit la structure de `mon-groupe/`, les conventions de skills, les formats de fichier, on se demande **"comment ça se généraliserait à 100 groupes ?"** — et on évite les choix qui ne marchent que pour un seul groupe (chemins en dur, hypothèses sur le bureau, conventions implicites).
- Mais on **ne construit aucune brique multi-tenant** (pas d'auth, pas de namespacing, pas d'abstraction "tenant", pas de DB) tant qu'il y a un seul utilisateur. ADR-001, ADR-002, ADR-005 restent en vigueur.
- La séparation `sgdf-core/` vs `mon-groupe/` (ADR-003) est **la** garantie structurelle de cette discipline : tout ce qui est dans `sgdf-core/` doit être pensé comme partageable.

**Raisons** :
- Coût cognitif faible (juste se poser la question), gain potentiel élevé (évite un refactor douloureux en phase 3).
- Construire vraiment du multi-tenant maintenant violerait les principes "pas d'infra inutile" et "pas de décisions au cas où".

**Conséquences** :
- Les revues de code/structure en mode dev doivent inclure le réflexe "est-ce que ça scale à N groupes ?".
- Si on est tenté d'introduire une convention spécifique à un groupe donné (ex. nom de famille en dur, structure d'unité particulière), c'est un **signal d'alerte** : soit on l'abstrait, soit on la met en BDD et pas dans `sgdf-core/` ou `doc/`.

---

## ADR-009 — Format structuré des écritures opérationnelles en markdown
**Date** : 2026-04-17
**Statut** : accepté

**Contexte** : ADR-007 prévoit que Baloo remplace progressivement Airtable et le Google Sheet `Compta Unités` pour le suivi opérationnel (remboursements, dépenses par unité, abandons de frais…). Il faut fixer un format de stockage dans `mon-groupe/` qui soit à la fois lisible par un humain, manipulable par Claude Code, et migrable vers une base de données en phase 3.

**Décision** :

1. **Un fichier par type d'écriture** : `mon-groupe/remboursements.md`, `mon-groupe/depenses-unites.md`, etc. Pas un fichier par écriture (trop de fichiers) ni un fichier unique (trop gros, diff illisible).

2. **Chaque écriture est un bloc structuré** identifié par un heading `###` avec un identifiant unique, suivi de paires clé-valeur en liste markdown :

```markdown
### RBT-2026-001
- **Demandeur** : Prénom Nom
- **Montant** : 42,50 €
- **Date dépense** : 2026-03-15
- **Nature** : transport
- **Unité** : Scouts-Guides
- **Justificatif** : oui | en attente | non
- **Statut** : demandé | validé | payé | refusé
- **Date paiement** : —
- **Saisie Compta-Web** : oui | non
- **Notes** : (libre, optionnel)
```

3. **Convention d'identifiant** : `<TYPE>-<ANNÉE>-<NNN>` avec numéro séquentiel à 3 chiffres. Types définis : `RBT` (remboursement), `ABF` (abandon de frais), `DEP` (dépense unité). Extensible.

4. **Les montants** utilisent la virgule décimale et le symbole `€` : `42,50 €`. C'est la convention naturelle en français et la plus lisible.

5. **Les statuts** utilisent un vocabulaire fermé par type d'écriture (défini dans le skill correspondant). Pas de statuts libres.

6. **Tri** : les écritures les plus récentes en haut du fichier (tri anti-chronologique). Facilite la lecture courante ; le diff git reste propre puisqu'on ajoute toujours en tête.

**Raisons** :
- Markdown avec heading + listes est nativement parseable par regex ou par un parseur markdown, sans dépendance.
- Le heading `###` avec identifiant permet de localiser une écriture par grep.
- Les paires clé-valeur en gras sont visuellement claires et structurellement régulières.
- Anti-chronologique = l'info fraîche est toujours visible sans scroll, et `git diff` montre les ajouts en tête.
- Compatible avec la migration vers une table SQL : chaque clé devient une colonne, chaque bloc devient une ligne.

**Conséquences** :
- Chaque skill qui crée des écritures doit respecter ce format. Le skill est responsable de la validation (champs obligatoires, vocabulaire de statut).
- Les fichiers d'écritures vivent dans `mon-groupe/` (données privées du groupe).
- On ne duplique **pas** dans Airtable ce qui est dans ces fichiers (et inversement). Pendant la transition, Airtable reste la source de vérité pour les écritures anciennes ; les nouvelles écritures sont créées ici.
- Le jour de la migration phase 3, un script pourra parser ces fichiers et les insérer en base.

---

## ADR-010 — Outil compta : SQLite + serveur MCP Node.js/TypeScript
**Date** : 2026-04-17
**Statut** : accepté (remplace ADR-009 pour les nouvelles écritures)

> **Note de statut (2026-04-25)** : la trajectoire phase 2 (cf. [`roadmap.md`](roadmap.md)) fait basculer la source de vérité opérationnelle vers la webapp `web/` (BDD + API HTTP côté serveur). Le MCP `baloo-compta` est refondu en client HTTP authentifié de cette API et n'attaque plus la BDD SQLite directement. ADR-010 reste valide pour la phase 1 (MVP CLI), mais la BDD SQLite locale qu'il introduit est **provisoire** et migrera vers la BDD webapp en P2. Le schéma SQL-standard prévu par cet ADR rend la migration mécanique. Pas de nouvel ADR à ce stade — la décision de pivot est documentée dans la roadmap.

**Contexte** : ADR-007 prévoit que Baloo remplace Airtable et le Sheet. ADR-009 proposait un format markdown structuré pour les écritures. En pratique, le trésorier a besoin d'un vrai outil de compta opérationnel — requêtable, filtrable, avec vue d'ensemble — pas de fichiers markdown qu'il ne lira pas.

**Décision** :
1. Introduire une **base SQLite** (`data/baloo.db`, gitignored) comme stockage opérationnel.
2. Exposer les opérations via un **serveur MCP** écrit en TypeScript (`compta/`), transport stdio, appelé directement par Claude Code.
3. Le schéma utilise du **SQL standard** (TEXT pour les dates ISO 8601, INTEGER pour les montants en centimes, pas de features SQLite-only) pour permettre une migration vers **Postgres/Neon** en phase 3.
4. Les **justificatifs** sont stockés en fichiers sur disque (`justificatifs/`, gitignored), référencés par chemin en base. Migration future vers Cloud Storage.
5. `group_id` présent sur toutes les tables pour préparer le multi-tenant (ADR-008).

**Stack** : Node.js, TypeScript (via `tsx`), `@modelcontextprotocol/sdk`, `better-sqlite3`. Pas d'ORM.

**Tables** : 4 de référence (categories, modes_paiement, unites, activites) + 7 métier (ecritures, remboursements, abandons_frais, mouvements_caisse, depots_cheques, justificatifs) + 2 pour import Comptaweb.

**Raisons** :
- Le trésorier veut un outil utilisable, pas des fichiers. SQLite + MCP = un outil natif pour Claude Code.
- TypeScript : SDK MCP de référence, écosystème cohérent avec la cible phase 3 (Next.js).
- SQLite : zéro infra, fichier unique, performant pour 1 utilisateur.
- Schéma Postgres-compatible : migration = changer `db.ts` + `strftime` → `NOW()`.

**Conséquences** :
- Premier code dans le repo. Dépendances npm dans `compta/node_modules/` (gitignored).
- ADR-009 (format markdown) reste documenté mais n'est plus utilisé pour les nouvelles écritures.
- `mon-groupe/remboursements.md` est obsolète (les données vivent en base).
- Airtable reste en service pour les données historiques pendant la transition.
- L'architecture passe de "100% markdown" à "markdown (mémoire/doc) + SQLite (compta opérationnelle)".

---

## ADR-011 — Client API Comptaweb par reverse engineering
**Date** : 2026-04-17
**Statut** : accepté (scope), étendu par [ADR-012](#adr-012--comptaweb--webapp-server-rendered-scraping-html-avec-cheerio)

**Contexte** : ADR-007 et [`vision.md`](vision.md) prévoient à terme que Baloo fasse la saisie Comptaweb à la place du trésorier, "via API si elle existe, sinon automation navigateur". L'[`architecture.md`](architecture.md) mentionnait un scraping Playwright en P3. En pratique, Comptaweb n'expose pas d'API publique documentée, mais son front appelle bien une API HTTP interne (comme toute webapp moderne).

Question : attendre une hypothétique API officielle SGDF (qui peut ne jamais venir) ? Faire du scraping DOM Playwright (fragile) ? Ou reverse-engineer l'API interne observable depuis le navigateur ?

**Décision** :
1. **Approche choisie** : reverse engineering de l'API HTTP interne de Comptaweb, à partir de l'observation du trafic navigateur. Un client TypeScript minimal est écrit dans `compta/src/comptaweb-client/` et exposé via le MCP `baloo-compta`.
2. **Scope fermé** : lecture des écritures et référentiels, création d'écritures de type dépense et recette (avec ventilations). **Aucun endpoint destructif ou administratif n'est exposé**, même si découvert pendant la phase discovery. Liste exhaustive dans [`comptaweb-api.md`](comptaweb-api.md).
3. **Safety par défaut** : dry-run par défaut sur toutes les opérations d'écriture, confirmation explicite requise pour écrire réellement. Pas de retry auto sur écriture.
4. **Pas de cadre légal / CGU traité à ce stade** : décision consciente de l'utilisateur de ne pas bloquer sur ce point. À ré-ouvrir si Baloo est distribué à d'autres groupes (phase 2+).

**Raisons** :
- L'API interne est beaucoup plus stable que le DOM (le front peut changer sans que les endpoints bougent).
- Plus rapide, plus typable, plus observable qu'une automation navigateur.
- Permet de couvrir les besoins du scope avec quelques endpoints bien cartographiés, sans avoir à simuler des clics.
- Aligne Baloo sur l'étape (c) de l'ADR-007 (automation complète) en évitant la fragilité du DOM scraping.

**Conséquences** :
- Dépendance forte à la stabilité de l'API interne Comptaweb. Un changement côté SGDF peut casser le client. → Tests d'intégration en lecture quotidiens pour détecter tôt. Fallback permanent sur la saisie manuelle.
- Les credentials Comptaweb du trésorier vivent en local (fichier `.env` gitignored) + la session persistée dans `data/comptaweb-session.json` (gitignored). Aucun secret ne part dans git.
- Les endpoints cartographiés sont documentés dans `doc/comptaweb-api-endpoints.md` (à créer en phase discovery). Les payloads réels ne sont **jamais** commités bruts — ils contiennent des données nominatives et financières.
- L'architecture `compta/` passe de "MCP SQLite" à "MCP SQLite + client Comptaweb". Pas d'autre dépendance introduite (fetch natif).
- `architecture.md` (ligne "Compta-Web / P3 / Scraping Playwright") devient obsolète — à mettre à jour pour refléter cette décision.

---

## ADR-012 — Comptaweb : webapp server-rendered, scraping HTML avec cheerio
**Date** : 2026-04-18
**Statut** : accepté, étend [ADR-011](#adr-011--client-api-comptaweb-par-reverse-engineering)

**Contexte** : la session discovery du 2026-04-18 (cf. [`comptaweb-api-endpoints.md`](comptaweb-api-endpoints.md)) a montré que Comptaweb n'est **pas une SPA avec API REST JSON** comme supposé dans ADR-011, mais une **webapp server-rendered classique** (stack jQuery + Bootstrap + DataTables + chosen + bootstrap-datepicker). Toutes les listes arrivent dans le HTML de la page, les DataTables sont initialisées client-side sur des données déjà présentes dans le DOM, et les soumissions sont des formulaires `application/x-www-form-urlencoded` classiques. Aucun endpoint JSON interne détecté pour les écrans du scope.

Par ailleurs, la discovery a révélé un élément précieux et **initialement hors scope** d'ADR-011 : sur l'écran `/rapprochementbancaire`, la liste des **écritures bancaires non rapprochées** (les lignes qui remontent du compte) est déjà disponible dans le HTML, **avec les sous-lignes DSP2 enrichies** par la banque (une ligne agrégée "PAIEMENT C. PROC …" contient dans son `tbody[id^="details_"]` les transactions individuelles avec montant + commerçant). Ce niveau de détail change le workflow cible : plutôt que de créer des écritures comptables de zéro dans Baloo, on part des lignes bancaires réelles et on vient les enrichir (catégorie, unité, facture) — exactement le modèle des logiciels de compta modernes.

**Décision** :

1. **Parsing HTML côté client** : ajouter `cheerio` en dépendance de production de `compta/` pour extraire les données des pages Comptaweb. Pas de meilleure option sans API JSON. (Contrairement à ADR-011 qui anticipait "pas de nouvelle dépendance npm a priori".)

2. **Extension du scope lecture** : la lecture des écritures bancaires non rapprochées **entre dans le scope** du client Comptaweb. C'est ce qui permettra à Baloo de remplacer l'export CSV manuel et de servir de base au workflow d'enrichissement. **Les sous-lignes DSP2** sont également extraites quand elles sont présentes.

3. **Pas de changement sur les endpoints destructifs/admin** : les exclusions de scope ADR-011 restent actives (pas de suppression, pas de modification d'écriture, pas de rapprochement automatique au MVP, pas d'admin). On se contente d'étendre la *lecture*.

4. **Approche auth** : non tranchée dans cet ADR. Le login passe par Keycloak SGDF (OIDC + PKCE, client `Comptaweb`, realm `sgdf_production`), pas un form POST classique. Trois pistes : (a) flow Authorization Code + PKCE piloté par `openid-client`, (b) ROPC si autorisé par le realm, (c) cookie de session copié manuellement depuis une session navigateur. À arbitrer à l'implémentation, dans un ADR-013 dédié si la décision est structurelle.

5. **Architecture client maintenue** : le module `compta/src/comptaweb-client/` reste le point d'entrée (cf. ADR-011). `http.ts` devient un wrapper `fetch` + cookie jar (pas de JSON par défaut, mais texte HTML), et `ecritures.ts` / `referentiels.ts` utilisent `cheerio` pour parser les réponses.

**Raisons** :
- On ne peut pas éviter le scraping HTML si l'app n'a pas d'API JSON : le choix est entre cheerio (parsing sain) et regex bricolé (dangereux). cheerio est la solution standard du milieu Node pour ce besoin.
- Les sous-lignes DSP2 sont un cadeau qu'il serait absurde de ne pas exploiter : elles sont déjà dans le HTML, pas de coût supplémentaire pour les extraire.
- Laisser l'auth ouverte évite de sur-engager l'implémentation sans avoir essayé chaque piste.

**Conséquences** :
- Dépendance `cheerio` ajoutée à `compta/package.json`.
- `doc/comptaweb-api.md` mis à jour : scope étendu, approche technique précisée (scraping vs API JSON).
- Fragilité structurelle vs SPA : le HTML peut changer (renommage d'un `id`, déplacement d'une colonne) sans que les URLs bougent. Les sélecteurs CSS utilisés dans le parser doivent être documentés et **vérifiés par des tests d'intégration en lecture**, au moins sur un échantillon.
- Les noms de champs HTML observés (`releve_a_rapprocher[<ID>]`, `ecriturecomptable[ecriturecomptabledetails][N][nature]`, etc.) deviennent des constantes typées dans le client. Un renommage côté Comptaweb = une PR à faire côté Baloo.
- L'approche auth sera tranchée à l'impl (ADR-013 si structurelle).

**Liens** :
- [ADR-011](#adr-011--client-api-comptaweb-par-reverse-engineering) — scope initial
- [`comptaweb-api-endpoints.md`](comptaweb-api-endpoints.md) — cartographie détaillée

---

## ADR-013 — Multi-user dès l'architecture, aucune donnée user-dépendante en git
**Date** : 2026-04-18
**Statut** : accepté

**Contexte** : jusqu'ici Baloo est pensé mono-utilisateur avec les données du groupe Val de Saône versionnées en markdown dans `mon-groupe/` (cf. ADR-002, ADR-003, ADR-010). L'utilisateur exprime deux objectifs structurants pour la suite :

1. **Préparer la saasification** — plusieurs users par groupe, plusieurs groupes, des accès externes (chefs d'unité, parents). "Faire plus compliqué aujourd'hui pour se simplifier la vie plus tard."
2. **Publier le projet en open source sur github** — le repo public ne doit contenir **aucune** donnée personnelle, financière ou nominative, ni aujourd'hui ni dans l'historique.

ADR-008 avait déjà posé le principe "penser multi-tenant sans le construire", et `group_id` est déjà présent sur toutes les tables SQLite (ADR-010). Mais la mémoire en markdown (`mon-groupe/`) n'est pas prête : elle mélange structure du groupe, données nominatives et notes libres, et elle est versionnée. Il faut la sortir.

**Décision** :

1. **Règle d'or** : tout ce qui dépend d'un user ou d'un groupe spécifique vit **exclusivement en base de données**. Le dépôt git (et l'open source à venir) ne contient que du générique : code, documentation, skills de process, `sgdf-core/`. Aucune exception, même "temporaire".

2. **Modèle multi-user** prévu dans le schéma (pas activé au MVP) :
   - **Rôles** : `tresorier`, `cotresorier`, `chef_unite` (lecture filtrée à son unité), `parent` (lecture de ses propres paiements), `membre_autre_groupe` (phase 4 SaaS).
   - **Scopes** : un user a un `group_id` obligatoire, éventuellement un `scope_unite_id` pour les rôles filtrés.
   - **Une BDD multi-tenant** : un seul fichier SQLite (`data/baloo.db`) qui héberge plusieurs groupes, isolés par `group_id`. Pas une BDD par groupe.

3. **Distinction claire `users` vs `personnes`** :
   - `users` : comptes avec accès Baloo (authentification, rôle, scope).
   - `personnes` : annuaire du groupe (chefs, bénévoles, parents, enfants inscrits). Certaines personnes ont aussi un compte user, d'autres non. Un user peut être lié à une personne via `person_id`.

4. **Credentials externes (Comptaweb, etc.) en BDD, par user** dans une table `user_credentials`. **Chiffrement remis à plus tard** (ADR dédié le moment venu, avec une clé stockée dans `.env` ou un keychain OS). Au MVP mono-user, stockage en clair dans `user_credentials` — la BDD étant hors git, c'est acceptable tant qu'on accepte que le fichier `baloo.db` local est traité comme un secret.

5. **Notes libres et mémoire LLM** : les parties "notes" des anciens fichiers markdown (`asso.md`, `finances.md`, etc.) migrent vers une table `notes` (`group_id`, `user_id?`, `topic`, `content_md`, timestamps). Requêtable, filtrable, mais toujours consommable comme texte par le LLM.

6. **Partition des fichiers** :

   | Type | Où | Git | Cible open source |
   |---|---|---|---|
   | Code (`compta/`) | repo | oui | oui |
   | Doc de conception (`doc/`) | repo | oui | oui, après audit |
   | Process génériques (`sgdf-core/`, `skills/`) | repo | oui | oui |
   | Schéma BDD (`compta/src/schema.sql`) | repo | oui | oui |
   | Données groupe/user | BDD SQLite (`data/baloo.db`) | non (gitignored) | jamais |
   | Pièces justificatives | fichiers (`justificatifs/`) | non (gitignored) | jamais |
   | `mon-groupe/` | **supprimé du repo après migration** | non | jamais |

7. **Au MVP on ne construit PAS l'auth Baloo** (pas d'UI de login, pas de session). Un seul user implicite = l'utilisateur courant. Les tables `users`, `personnes`, `user_credentials`, etc. sont présentes et peuplées (via seed ou wizard initial), mais aucune vérification de droit n'est faite dans le code. L'auth est activée au 2e user concret.

8. **Historique git** : au moment de la publication github, squash de l'historique local en un commit unique (ou plusieurs commits propres post-migration). L'historique actuel **contient des données personnelles** dans plusieurs commits (`mon-groupe/*.md`) et ne sera donc jamais poussé tel quel. Le dépôt local garde l'historique complet pour traçabilité personnelle.

**Raisons** :
- Une architecture multi-user peut se refactorer plus tard, mais **un historique git pollué ne se nettoie pas** (sauf en réécrivant tout, ce qu'on évite en faisant propre dès le début de la publication). Donc le timing critique = avant push github.
- Stocker les credentials en BDD (même non chiffrés au MVP) plutôt qu'en `.env` scale au multi-user dès qu'on veut. Un `.env` n'a qu'un jeu de credentials.
- Séparer `users` et `personnes` évite la confusion typique (on veut lister les chefs sans forcément leur donner un accès Baloo).
- La règle "aucune donnée user-dépendante en git" est binaire : moins d'exceptions, moins d'accidents.

**Conséquences** :
- **Refactor schéma SQL** : ajouter `groupes`, `users`, `personnes`, `user_credentials`, `notes`, `todos`, `comptes_bancaires`, `budgets`, `budget_lignes`. Retirer les `DEFAULT 'val-de-saone'` sur `group_id` (le groupe courant devient obligatoire et peuplé par seed/wizard).
- **Migration progressive** : `mon-groupe/*.md` déplacé fichier par fichier vers la BDD. Chaque fichier migré est retiré du tracking git. Voir les chantiers 3 à 5 du plan 2026-04-18.
- **Audit de `doc/`** : passer en revue les ADRs et autres docs pour retirer les données nominatives ou financières (anonymiser par placeholders). Les endpoints Comptaweb sont déjà anonymisés (cf. `comptaweb-api-endpoints.md`).
- **`.gitignore` durci** : `mon-groupe/` ajouté intégralement (sauf peut-être une exception `mon-groupe/.gitkeep` pour préserver le dossier).
- **Nouvelle dépendance potentielle** : aucune. Le schéma multi-user s'implémente en SQL pur.
- **Interaction avec ADR-002** : les fichiers markdown dans `mon-groupe/` ne sont plus la source de vérité pour les données nominatives. `sgdf-core/` et `doc/` restent markdown pour le contenu partageable (cohérent avec ADR-002). La mémoire long terme **structurée** passe en BDD ; la mémoire long terme **partageable** reste en markdown.
- **Interaction avec ADR-008** : ADR-008 posait le principe "penser multi-tenant sans le construire" — ADR-013 *garde* ce principe mais précise *ce qu'on prépare* concrètement dans le schéma dès maintenant.
- **Roadmap** : cette préparation avance la phase 3. On ne construit pas la phase 3, mais on arrête d'accumuler de la dette qui la bloquerait.

**Liens** :
- [ADR-003](#adr-003--séparation-sgdf-core-vs-mon-groupe-dès-le-jour-1) — séparation des répertoires (encore valide, `sgdf-core/` inchangé)
- [ADR-008](#adr-008--penser-multi-tenant-dès-la-phase-1-sans-le-construire) — multi-tenant anticipé
- [ADR-010](#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript) — SQLite + MCP (base du stockage)
- [`roadmap.md`](roadmap.md) — phase 3

---

## ADR-014 — Auth multi-user : Auth.js v5 + magic link + token MCP
**Date** : 2026-04-26
**Statut** : accepté

**Contexte** : le chantier 4 du pivot P2 (cf. [`p2-pivot-webapp.md`](p2-pivot-webapp.md)) doit remplacer le mécanisme actuel de résolution de contexte (`BALOO_USER_EMAIL` lu en env) par une vraie auth multi-user. Sans ça, on ne peut pas ouvrir l'outil aux chefs/parents (chantier 5) et l'API HTTP du chantier 2 reste publique.

Quatre options ont été examinées :
1. **Auth.js v5 (NextAuth)** — standard de fait Next.js, mature, magic link natif via `Email` provider, OAuth en bonus pour brancher OIDC SGDF plus tard.
2. **Better Auth** — alternative récente, TS-first, plus contrôlable. Communauté plus jeune.
3. **Custom maison** — magic link maison + cookie signé. Réinvente la roue (cf. interdits dans [`DEVELOPING.md`](DEVELOPING.md)).
4. **OIDC SGDF (Keycloak)** — la fédération expose un IdP utilisé par Comptaweb. Idéal en théorie (les chefs/parents auraient un seul compte SGDF) mais demande une démarche administrative pour s'enregistrer comme application cliente, et rien ne garantit que c'est ouvert à des outils tiers non SGDF.

**Décision** :

1. **Lib retenue : Auth.js v5** (`next-auth@beta`, branche `5.0.0-beta.x`). Mature côté écosystème, intégration App Router native, providers prêts (Email magic link, et OIDC plus tard quand on tentera SGDF).

2. **Mécanisme côté UI : magic link par email**. Pas de mot de passe maison. L'utilisateur entre son email sur `/login` → token de vérification généré et stocké en BDD → email envoyé avec le lien `/auth/verify?token=…` → click → session créée.

3. **Transport email** :
   - **Dev** : transport "console" (le lien magic link est loggé dans la sortie du serveur Next.js). Suffit pour le trésorier seul.
   - **Prod** : SMTP via `nodemailer` (configuré par variables d'environnement `EMAIL_SERVER_*`). Sera branché au moment du déploiement (chantier 7).

4. **Mécanisme côté MCP : token long-vie (`Authorization: Bearer ...`)**. Le serveur `baloo-compta` s'authentifie auprès de l'API webapp via un token associé à un user. Le token est stocké haché en BDD (table `api_tokens`), généré par un script CLI dans `web/scripts/`, copié dans `compta/.env` (variable `BALOO_API_TOKEN`).

5. **Custom adapter SQLite** : Auth.js n'a pas d'adapter officiel `better-sqlite3`. On en écrit un dans `web/src/lib/auth/adapter.ts` qui implémente les fonctions Adapter nécessaires au flow Email + sessions DB. Schéma minimal côté BDD : trois tables ajoutées (`sessions`, `verification_tokens`, `api_tokens`) plus une colonne `email_verified` sur `users`.

6. **Restriction au MVP** : seuls les users **déjà existants** dans la table `users` peuvent se connecter (vérification dans le callback `signIn`). Pas de création automatique à partir d'un email inconnu — ça viendra en chantier 5 quand un mécanisme d'invitation propre sera en place.

7. **Middleware d'auth** : implémenté dans `web/src/lib/api/route-helpers.ts` (helper `requireApiContext` modifié pour vérifier `Authorization: Bearer …` puis cookie de session, sinon 401). Pas de `middleware.ts` Next.js edge — `better-sqlite3` ne tourne pas en edge runtime, donc on garde toute la logique dans Node runtime.

**Raisons** :

- Auth.js a la communauté la plus large : trouvable dans la doc Next.js officielle, des dizaines de tutos à jour, providers OAuth déjà câblés. C'est le choix le moins risqué.
- Magic link évite tous les pièges des mots de passe maison (hashing, oubli, brute force).
- Token Bearer pour le MCP est le standard pour les clients programmatiques (PAT GitHub, tokens Notion, etc.), bien plus simple qu'un OAuth machine-to-machine.
- Custom adapter coûte ~150 lignes mais évite d'introduire un ORM (Prisma, Drizzle) juste pour Auth.js. Cohérent avec [ADR-010](#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript) qui a refusé un ORM.

**Conséquences** :

- Nouvelle dépendance `next-auth@beta` dans `web/package.json`. Pas de dépendance ajoutée pour la BDD (on garde `better-sqlite3`).
- Trois tables ajoutées au schéma : `sessions`, `verification_tokens`, `api_tokens`. Une colonne ajoutée à `users` : `email_verified`. Migration via `db.ts` (`ALTER TABLE` idempotent).
- `web/src/lib/context.ts` change de source : il lit la session Auth.js (cookie ou Bearer) au lieu de `BALOO_USER_EMAIL`. Le fallback env var **est retiré** une fois l'auth en place — sinon n'importe quel process peut se faire passer pour le user.
- L'API webapp refuse désormais les requêtes non authentifiées. Côté pages web, le layout fait redirect `/login` si pas de session.
- Le MCP `baloo-compta` ne peut plus tourner sans `BALOO_API_TOKEN`. Documenter dans `compta/.env.example` la procédure de génération via le script.
- `BALOO_USER_EMAIL` reste dans la config du serveur webapp **uniquement** pour le bootstrap initial du premier user (le trésorier) : le script de seed crée un user avec cet email, qui peut ensuite se connecter via magic link.
- Branchement OIDC SGDF reporté : si la fédération expose un IdP utilisable, on l'ajoute comme provider Auth.js supplémentaire dans un ADR séparé.
- **Pas de chiffrement des `api_tokens` au MVP** : on stocke le hash SHA-256 du token (le token brut n'est montré qu'une fois à la génération). Les `user_credentials` (Comptaweb) restent en clair tant qu'on n'attaque pas l'ADR chiffrement (cf. [ADR-013](#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)).

**Liens** :
- [`p2-pivot-webapp.md`](p2-pivot-webapp.md) — chantier 4
- [ADR-013](#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git) — schéma multi-user/multi-tenant déjà prévu
- [ADR-010](#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript) — pas d'ORM, donc adapter custom

---

*Ajouter ici toute nouvelle décision significative, avec un numéro ADR-00X incrémental.*
