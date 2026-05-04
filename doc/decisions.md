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

## ADR-014 — Écritures : flag `justif_attendu` plutôt qu'enum à trois états
**Date** : 2026-04-21
**Statut** : accepté

**Contexte** : une dépense dans `ecritures` peut se trouver dans trois situations vis-à-vis de son justificatif : (1) fichier rattaché côté Baloo, (2) pas de fichier mais `numero_piece` renseigné (sync vers Comptaweb possible, document à récupérer ultérieurement), (3) écriture pour laquelle **aucun justif papier n'existera jamais** — prélèvement national SGDF, contribution territoire, appel de fonds, cumul d'adhésions fiscalisées, etc. Avant cet ADR, le compteur `alertes.depenses_sans_justificatif` de `vue_ensemble` comptait indistinctement les cas (2) et (3), et la sync `cw_sync_draft` bloquait sur toute dépense sans `hasJustificatif && !numero_piece`, ce qui contraignait à renseigner un `numero_piece` fictif pour ces flux.

On cherche un modèle qui :
- permette de sortir les "non attendu" de l'alerte (sans bloquer la sync),
- garde l'alerte active tant qu'un document n'est pas rattaché, même si un `numero_piece` est renseigné (le code Comptaweb ne remplace pas la pièce),
- reste trivialement migrable (BDD en production dès le MVP).

**Options envisagées** :
1. **Enum à 3 états** `justif_status IN ('attendu', 'manquant_avec_code', 'non_attendu')` sur `ecritures`. Explicite mais redondant : « manquant avec code » se déduit déjà de `numero_piece IS NOT NULL AND hasJust = 0`, et « attendu » est le défaut. Introduit un état dénormalisé qui doit être maintenu en cohérence par l'UI et les server actions.
2. **Flag booléen `justif_attendu`** sur `ecritures`. Les 4 états visibles en UI (✓ / ⌛ / 🚫 / ⚠) se dérivent de ce flag, de la présence d'un fichier, et de `numero_piece` — aucune dénormalisation.
3. Ne rien faire, continuer à polluer le compteur.

**Décision** : option 2. Colonne `justif_attendu INTEGER NOT NULL DEFAULT 1` ajoutée sur `ecritures`.

- `justif_attendu = 1` + fichier rattaché → OK.
- `justif_attendu = 1` + pas de fichier + `numero_piece` → sync Comptaweb autorisée, alerte "à compléter" maintenue tant qu'un document n'est pas rattaché.
- `justif_attendu = 1` + pas de fichier + pas de `numero_piece` → sync bloquée, écriture dans « À compléter ».
- `justif_attendu = 0` → aucune alerte, sync autorisée sans exigence de justif.

**Raisons** :
- Pas de dénormalisation : les 4 états se calculent depuis trois données de base déjà présentes.
- Un bool migre plus proprement qu'un enum (pas de `CHECK` contraint à faire évoluer).
- L'UX du formulaire est naturelle : une case à cocher « Justificatif attendu pour cette écriture », cochée par défaut, suffit à couvrir les 3 situations.

**Conséquences** :
- Migration additive dans `compta/src/db.ts` (`ensureColumn` avec `DEFAULT 1`) — toutes les écritures existantes restent "attendu", comportement inchangé.
- `vue_ensemble.alertes.depenses_sans_justificatif` filtre désormais `justif_attendu = 1`.
- `cw_sync_draft` ne bloque plus si `justif_attendu = 0`, même sans `numero_piece` ni fichier.
- Front `/ecritures` : colonne `Just.` avec 4 états visuels distincts ; page détail avec checkbox + encart d'état.
- Script `npm run flag:prelevements-auto` (additif) pour marquer en bulk les dépenses récurrentes type "Regroupement de N prélèvements nationaux", "Cumul 6161/6586", "Appel de fond Territoire" (skip automatique de celles qui ont déjà un justif rattaché).

**Liens** :
- [ADR-010](#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript) — SQLite + MCP (table `ecritures`)
- [ADR-011](#adr-011--client-api-comptaweb-par-reverse-engineering) — sync Comptaweb (contrainte de validation)

---

## ADR-015 — Sync additive des référentiels Comptaweb vers la BDD locale
**Date** : 2026-04-22
**Statut** : accepté

**Contexte** : les référentiels Comptaweb (**branches/projets**, natures, activités, modes de transaction) sont **modifiables côté Comptaweb** : un groupe peut créer un nouveau projet de camp, ajouter une branche "Groupe" qui manquait, renommer une nature. Le script initial `map:referentiels` ne faisait qu'**attacher un `comptaweb_id`** aux entrées locales déjà présentes (via un match par nom normalisé). Il ne créait **pas** les entrées locales manquantes. Conséquence observée : la branche Comptaweb « Groupe » n'existait pas côté Baloo, donc impossible d'assigner une unité aux 14 prélèvements auto et de les pousser proprement vers Comptaweb.

Le besoin : depuis l'app web, pouvoir **synchroniser les configs** d'un clic pour que les dropdowns d'édition (Unité, Catégorie, Activité, Mode de paiement) reflètent exactement ce que Comptaweb propose aujourd'hui.

**Décision** :

1. **Pattern unique** appliqué aux 4 référentiels. Pour chaque option récupérée depuis Comptaweb (`{value, label}` où `value = comptaweb_id`) :
   - **Match 1** : ligne locale avec même `comptaweb_id` → inchangée.
   - **Match 2** (fallback) : ligne locale sans `comptaweb_id`, dont le `name` normalisé (NFD → sans accents → lowercase → alphanumérique) correspond au `label` Comptaweb. Tolérance singulier/pluriel pour les unités (ex. « Impeesa » local vs « Impeesas » Comptaweb). → UPDATE `comptaweb_id`, entrée "mappée".
   - Sinon → INSERT nouvelle entrée locale, entrée "ajoutée".

2. **Additive uniquement** : aucune suppression, aucun archivage automatique. Les entrées locales avec un `comptaweb_id` introuvable côté CW sont signalées comme **orphelines** dans le rapport, mais jamais modifiées. L'utilisateur tranche manuellement (renommage en amont, suppression dans Comptaweb, ou désalignement délibéré).

3. **Conventions à l'INSERT** :
   - `unites` : `id = u-${groupId}-${slug(label)}`, `code` dérivé des initiales du label avec résolution de collision par suffixe numérique (ex. « Groupe » → `GR`, collision ultérieure → `GR2`).
   - `categories` : `id = cat-${slug(label)}`, `type = 'les_deux'` par défaut (Comptaweb ne donne pas cette info), `comptaweb_nature = label`.
   - `activites` : `id = act-${groupId}-${slug(label)}`.
   - `modes_paiement` : `id = mp-${slug(label)}`.

4. **Deux points d'entrée** partageant la même logique pure (`applyReferentielsSync(db, groupId, refs, now)`) :
   - **Front web** : bouton « Synchroniser les configs » sur `/import`, server action `syncReferentielsFromComptaweb()`, `revalidatePath` sur `/ecritures` et `/import` pour rafraîchir les dropdowns.
   - **MCP** : tool `cw_sync_referentiels` + script `npm run sync:referentiels`.
   - La logique pure est **dupliquée à la main** entre `compta/src/comptaweb-client/` et `web/src/lib/comptaweb/`, cohérent avec le reste du client Comptaweb (pas de workspace pnpm pour l'instant).

5. **Pas de dry-run** dans le flux : sync = un clic = un INSERT/UPDATE idempotent + toast avec le bilan. Le risque est faible (additif, transactionnel).

**Raisons** :
- Un match par `comptaweb_id` d'abord évite de dupliquer une entrée si son libellé a légèrement changé côté CW.
- Le fallback par nom normalisé absorbe les entrées locales historiquement nommées à la main (les 5 branches-jeunes du bootstrap n'ont pas de `comptaweb_id` après un fresh install, il faut les mapper).
- Le tout-additif garantit qu'on ne peut pas casser une entrée locale existante à cause d'un changement côté Comptaweb.
- `type = 'les_deux'` par défaut sur les nouvelles natures n'est pas optimal (il faudra affiner manuellement) mais Comptaweb ne renvoie pas cette information, donc on fait avec.

**Conséquences** :
- `val-de-saone` a ajouté au premier run : 3 unités (Groupe, AJUSTEMENTS, Impeesas), 56 natures, 2 activités (ExtraJob, WET), 6 modes. La branche « Groupe » manquante est couverte.
- Les dropdowns d'édition du front `/ecritures/[id]` listent désormais tous les choix de Comptaweb.
- Le script initial `map:referentiels` reste dispo mais devient redondant — `sync:referentiels` le remplace fonctionnellement.
- Nouveaux fichiers : `compta/src/comptaweb-client/sync-referentiels-logic.ts`, `compta/src/tools/sync-referentiels.ts`, `compta/src/scripts/sync-referentiels.ts`, `web/src/lib/comptaweb/sync-referentiels-logic.ts`, `web/src/lib/actions/referentiels.ts`, `web/src/components/config/sync-referentiels-button.tsx`.
- Aucune nouvelle dépendance.

**Liens** :
- [ADR-010](#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript) — schéma de référence
- [ADR-011](#adr-011--client-api-comptaweb-par-reverse-engineering) — client Comptaweb
- [ADR-012](#adr-012--comptaweb--webapp-server-rendered-scraping-html-avec-cheerio) — parsing HTML (la source des options)

---

## ADR-016 — Auth multi-user : Auth.js v5 + magic link + token MCP
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

## ADR-017 — BDD production : SQLite hébergée (Turso) plutôt que Postgres
**Date** : 2026-04-27
**Statut** : accepté

**Contexte** : le chantier 7 du pivot P2 (cf. [`p2-pivot-webapp.md`](p2-pivot-webapp.md)) doit sortir SQLite du dev local pour pouvoir héberger la webapp. Trois familles d'options ont été examinées :

1. **SQLite hébergée** : Turso (libsql avec SDK HTTP) ou LiteFS (montage FUSE distribué sur Fly.io).
2. **Postgres managé** : Neon (serverless, branches), Supabase (DB + auth + storage), Fly Postgres.
3. **SQLite tel quel sur VPS** : on garde `better-sqlite3` + fichier `.db` sur le disque du VPS.

L'audit de portabilité montre que migrer le code vers Postgres demande **~3-4 semaines** d'effort à cause de la conversion synchrone → async (97 appels `getDb()` dans 26 fichiers, 4 sites `db.transaction`, plus l'abstraction de `PRAGMA table_info`). Coût très élevé pour un MVP intra-groupe.

Côté usage : 1 groupe SGDF, ~500 écritures/an, données mostly write-once-read-many, 5-10 users actifs. La charge est minuscule comparée aux limites de SQLite.

**Décision** :

1. **Turso en production** (`@libsql/client` SDK HTTP). On garde `better-sqlite3` en dev local — Turso expose une API libsql 100% compatible SQLite côté SQL.
2. Plus précisément :
   - Dev : `DB_PATH=../data/baloo.db` (better-sqlite3 → fichier local).
   - Prod : `DB_URL=libsql://<groupe>.turso.io` + `DB_AUTH_TOKEN=...` (libsql HTTP).
   - Adapter `web/src/lib/db.ts` pour exposer un client unifié.
3. **Pas de Postgres au MVP** — option remise sur la table en P3 (multi-groupes), où l'effort async devient justifiable.
4. **Stockage justifs** : reste en local au MVP. Si l'instance prod est serverless (Vercel), basculer vers blob storage — à arbitrer dans ADR-018.

**Raisons** :

- Turso = SQLite avec API HTTP : zéro refactoring async côté code.
- Coût marginal : free tier généreux (500 BDD, 9 GB). On n'en utilisera qu'une.
- Backups quotidiens managés par Turso, pas d'opérations à gérer.
- Branches BDD (style git) pour les migrations risquées en prod.
- Réversible : si on bascule sur Postgres en P3, l'audit de portabilité reste à faire mais le coût est connu.

**Conséquences** :

- **Refactoring async** : `@libsql/client` expose une API async (`await client.execute(...)`). better-sqlite3 est synchrone. Donc passer à libsql impose de convertir les ~97 appels `getDb().prepare().run/get/all()` synchrones en async (et la cascade de `await` dans tous les call-sites). Coût estimé : 3-4 semaines en mode rigoureux, plus rapide en mode automatisé. **C'est le coût qu'on a accepté** : le payback est qu'à terme, basculer sur Postgres en P3 devient gratuit (le refacto async est déjà fait).
- `web/src/lib/db.ts` exporte un client `Database` unifié — wrapper minimal qui imite l'API `prepare/run/get/all/transaction/exec/pragma` mais async. Permet une conversion mécanique du reste du code.
- Driver : `@libsql/client` avec `url: 'file:./data/baloo.db'` en dev (lit/écrit fichier local sans HTTP) et `url: 'libsql://...'` + `authToken` en prod.
- `ensureColumn` (migrations idempotentes) : libsql supporte `PRAGMA table_info` à l'identique.
- `db.transaction(...)` : libsql expose `client.transaction('write')` qui retourne un objet avec `commit()`/`rollback()`. Wrapper à écrire pour préserver le pattern existant.
- Documentation `doc/distribution.md` à mettre à jour avec la procédure de provisioning Turso.

**Liens** :
- [`p2-pivot-webapp.md`](p2-pivot-webapp.md) — chantier 7
- [ADR-010](#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript) — choix initial SQLite
- [ADR-018](#adr-018--hébergement--vercel--turso-pour-le-mvp-intra-groupe) — hébergement

---

## ADR-018 — Hébergement : Vercel + Turso pour le MVP intra-groupe
**Date** : 2026-04-27
**Statut** : accepté

**Contexte** : suite à [ADR-017](#adr-017--bdd-production--sqlite-hébergée-turso-plutôt-que-postgres) (Turso retenu pour la BDD), il faut héberger la webapp Next.js. Trois options examinées :

1. **Vercel** (managed PaaS) — déploiement par git push, env vars dans le dashboard, CDN intégré. Free tier (Hobby) ou ~$20/mois (Pro).
2. **VPS Hetzner CX11** (~5 €/mois) — Docker compose (Next.js + Caddy/Nginx), contrôle total, demande des compétences DevOps.
3. **Fly.io** — entre les deux, pricing à l'usage (~$5/mois shared-cpu).

Charge attendue : 5-10 users actifs intra-groupe, pas de pic, accès depuis France métropolitaine. Trésorier bénévole = budget ops proche de zéro en heures comme en euros.

**Décision** :

1. **Vercel Hobby** au MVP. Gratuit pour usage non commercial (le projet est associatif). À surveiller : si Vercel reclasse, basculer vers Hobby payant ($20/mois) ou Hetzner.
2. **Stockage justifs** : Vercel Blob (S3-compatible managé, ~$0.15/GB/mois). Service `web/src/lib/services/justificatifs.ts` adapté pour deux backends (FS local en dev, Vercel Blob en prod) selon env.
3. **Domaine** : `baloo.benomite.com` (sous-domaine d'un domaine personnel existant, configuré en CNAME vers Vercel). Pas de coût supplémentaire.
4. **Magic link en prod** : SMTP via Resend (free tier 100/jour, 3000/mois) ou Brevo (300/jour). `EMAIL_SERVER` côté env Vercel.
5. **Backups** : Turso fournit des backups quotidiens. `git push` reste notre source canonique pour le code.

**Raisons** :

- Vercel + Next.js = intégration native, support SSR/ISR/Edge prêt.
- Hetzner aurait demandé ~4h/mois d'ops (patches OS, certs, monitoring), incompatible avec un MVP bénévole.
- Free tier réellement gratuit pour un usage 5-10 users.
- Magic link via Resend reste gratuit pour le volume attendu.

**Conséquences** :

- Nouvelle dépendance `@vercel/blob` côté `web/`. Service `justificatifs.ts` adapté.
- Env vars Vercel à provisionner : `AUTH_SECRET`, `DB_URL`, `DB_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `EMAIL_SERVER`, `EMAIL_FROM`, `BALOO_USER_EMAIL` (compat scripts CLI).
- Le serveur MCP `baloo-compta` continue de tourner en local (machine du trésorier) et appelle Vercel via HTTPS : `BALOO_API_URL=https://baloo.benomite.com`.
- Si Vercel devient payant pour notre usage, on reste libres de basculer vers Hetzner — la stack Next.js + Turso est portable.

**Liens** :
- [`p2-pivot-webapp.md`](p2-pivot-webapp.md) — chantier 7
- [ADR-017](#adr-017--bdd-production--sqlite-hébergée-turso-plutôt-que-postgres)
- [ADR-016](#adr-016--auth-multi-user--authjs-v5--magic-link--token-mcp) — magic link compat Resend SMTP

---

## ADR-019 — Hiérarchie de rôles applicatifs V2
**Date** : 2026-04-29
**Statut** : accepté

**Contexte** : la P2 a livré 4 rôles `users.role` (`tresorier`, `cotresorier`, `chef_unite`, `parent`) qui couvraient les besoins du MVP. L'ouverture aux workflows internes du groupe (cf. [`p2-workflows-internes.md`](p2-workflows-internes.md)) demande deux ajustements : (1) un rôle pour les bénévoles autres que les chefs d'unité (parents organisateurs, équipiers d'unité, responsables matos, etc.) qui ne gèrent pas de budget mais doivent pouvoir déposer un justif et faire une demande, (2) un rôle pour le responsable de groupe (RG), supérieur hiérarchique du trésorier, qui valide certaines actions critiques.

Par ailleurs `cotresorier` s'est révélé inutile : un cotrésorier travaille avec les mêmes droits qu'un trésorier ; le distinguer en BDD ne sert qu'à identifier "qui est le principal" — distinction qui n'a aucun impact applicatif.

**Décision** :

1. **Rôles applicatifs `users.role`** :
   - `tresorier` — accès à tout. Multi-instance par groupe.
   - `RG` — accès à tout. Au MVP droits identiques à `tresorier` ; à terme valide les actions critiques (remboursements > seuil, abandons, sortie de caisse exceptionnelle).
   - `chef` — accès limité à la compta de son unité via `scope_unite_id`. Peut déposer justifs et faire des demandes.
   - `equipier` — pas d'accès compta. Peut déposer justifs et faire des demandes.
   - `parent` — accès lecture seule à `/moi` (ses propres dons / reçus fiscaux).
2. **Migration BDD idempotente** dans `web/src/lib/auth/schema.ts` (`ensureAuthSchema`) :
   - **DROP de la CHECK historique** sur `users.role` (héritée de l'ancien `compta/src/schema.sql` supprimé au chantier 6, qui imposait `role IN ('tresorier', 'cotresorier', 'chef_unite', 'parent', 'membre_autre_groupe')`). SQLite ne supporte pas DROP CONSTRAINT → recréation de la table sans CHECK sur `role` (procédure standard : new table, copy, drop, rename, recreate indexes). Idempotent : détecté via `sqlite_master.sql` contenant `'cotresorier'`. La CHECK sur `statut` est conservée.
   - `UPDATE users SET role='tresorier' WHERE role='cotresorier'`
   - `UPDATE users SET role='chef' WHERE role='chef_unite'`
3. **Plus de CHECK constraint** sur `users.role` après migration : les valeurs valides sont définies côté code dans `web/src/lib/context.ts` (`UserRole` union). L'avantage : ajouter un rôle dans le futur ne demande plus de migration BDD.
4. **`personnes.role_groupe` n'est PAS touché** : c'est l'annuaire SGDF avec un set de valeurs distinct (`co-rg`, `secretaire_principal`, `responsable_matos`, etc.). Confusion à éviter — un user peut être `tresorier` côté auth ET avoir `role_groupe='co-rg'` côté annuaire.

**Raisons** :

- **`cotresorier` supprimé** : aucun comportement applicatif ne distingue trésorier principal vs cotrésorier. La séniorité ou le rôle officiel SGDF se note via `personnes.role_groupe`. Garder deux rôles auth pour exprimer la même chose multiplie les comparaisons en dur (`['tresorier','cotresorier']`) sans bénéfice.
- **`RG` introduit dès maintenant** même s'il a au MVP les mêmes droits que `tresorier` : le rôle est porté par l'organigramme du groupe, ne pas l'introduire forcerait à donner le rôle `tresorier` au RG ce qui prête à confusion. Quand la validation RG sera implémentée, on n'aura pas à migrer la BDD.
- **`equipier` plutôt que d'élargir `chef`** : un chef d'unité a un budget à voir ; un parent organisateur n'en a pas. Leur donner le même rôle ouvre l'accès à des données qui ne le concernent pas. La page de dépôt et les pages de demande seront accessibles aux deux rôles via une whitelist explicite, pas via un rôle commun.
- **`parent` conservé** : l'espace `/moi` (consultation des dons et reçus fiscaux) doit rester ouvert aux parents purs (pas organisateurs). Un parent qui aide à organiser une activité reçoit un rôle `equipier` en plus s'il doit déposer.

**Conséquences** :

- Type `UserRole` dans `web/src/lib/context.ts` mis à jour : `'tresorier' | 'RG' | 'chef' | 'equipier' | 'parent' | string`.
- `web/src/lib/auth/access.ts` : `ALL_ADMIN_ROLES = ['tresorier', 'RG']`. Ajout de helpers `requireCanSubmit` (whitelist `tresorier/RG/chef/equipier`) et `requireCanViewCompta` (whitelist `tresorier/RG/chef`).
- `web/src/components/layout/sidebar.tsx` : les liens `Caisse` et `Import Comptaweb` passent à `roles: ['tresorier', 'RG']`.
- `web/src/lib/services/ecritures.ts` : commentaires mis à jour (`chef` au lieu de `chef_unite`).
- Aucun changement côté `personnes.role_groupe` ni `personnes.ts`.
- Aucun renommage de variable Comptaweb : la séparation auth/annuaire est claire.
- Pas d'invalidation des sessions Auth.js existantes : le rôle est lu en BDD à chaque requête (cf. `getCurrentContext` qui SELECT `role` à chaque appel).
- Documentation à jour dans [`p2-workflows-internes.md`](p2-workflows-internes.md) section 1.1.

**Liens** :
- [`p2-workflows-internes.md`](p2-workflows-internes.md) — chantier 0
- [ADR-013](#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git) — schéma multi-user/multi-tenant
- [ADR-016](#adr-016--auth-multi-user--authjs-v5--magic-link--token-mcp) — auth multi-user

---

## ADR-020 — Flux d'invitation par email
**Date** : 2026-04-29
**Statut** : accepté

**Contexte** : [ADR-016](#adr-016--auth-multi-user--authjs-v5--magic-link--token-mcp) a fermé l'auto-création de users via Auth.js (`createUser` throw, `getUserByEmail` filtre `statut='actif'`). C'était une restriction MVP volontaire : le seed créait le trésorier, et seul lui pouvait se connecter. Pour l'ouverture aux workflows internes (cf. [`p2-workflows-internes.md`](p2-workflows-internes.md) — dépôt de justifs, demandes de remboursement par les chefs/équipiers), il faut permettre au trésorier d'inviter d'autres users sans entrer en SQL.

Trois options ont été examinées :
1. **Magic link auto-généré côté serveur**. Au moment de l'invitation, on génère soi-même un `verification_token` Auth.js (avec le format de hash interne d'Auth.js) et on envoie directement le lien magique au user. 1 seul email, 1 seul clic pour activer le compte.
2. **2 emails (bienvenue + magic link standard)**. L'invitation envoie un email "bienvenue, va sur /login pour activer ton compte". Le user clique, arrive sur /login, saisit son email, reçoit un magic link standard, se connecte.
3. **Table d'invitations dédiée + endpoint custom**. On crée une table `invitations(token, email, role, expires)` séparée des `verification_tokens` Auth.js. L'email pointe vers `/invitation/<token>` qui valide puis crée une session. Plus de code, plus de surface à maintenir.

**Décision** : option 2 (2 emails). Au MVP, on garde la machinerie magic link Auth.js telle qu'elle est et on lui rajoute juste un email de bienvenue qui pointe vers /login.

Concrètement :

1. **Création du user en BDD** par le service `web/src/lib/services/invitations.ts` :
   - INSERT dans `users` avec `statut='actif'` directement (pas de statut `invite` intermédiaire — l'absence d'`email_verified` suffit à indiquer "pas encore connecté").
   - `role`, `scope_unite_id`, `nom_affichage` renseignés à la création.
   - ID dérivé de l'email (slug du local part), avec `uniqueId` pour gérer les collisions.
2. **Email de bienvenue** envoyé via le helper `web/src/lib/email/transport.ts` (réutilise le transport SMTP nodemailer configuré pour Auth.js, fallback console en dev).
3. **Premier login** : le user va sur `/login`, saisit son email, reçoit un magic link standard, se connecte. Le callback `signIn` ne fait rien de spécial : `getUserByEmail` trouve le user (`statut='actif'`), `email_verified` est mis à jour automatiquement par Auth.js → on peut détecter dans l'admin que la connexion a eu lieu.
4. **UI admin** : page `/admin/invitations` (réservée `tresorier` / `RG` via `requireAdmin`), formulaire de création + liste des invitations en attente (users avec `email_verified IS NULL`).
5. **API HTTP** : route `POST/GET /api/invitations` (admin only, via `ADMIN_ROLES` exporté par `lib/auth/access.ts`).

**Raisons** :

- L'option 1 (magic link auto-généré) demanderait soit d'importer des internes Auth.js (instables entre versions), soit de réimplémenter le hash exact d'Auth.js (`createHash('sha256').update(token + secret).digest('hex')` côté Email provider). Le risque de désynchronisation à la première mise à jour Auth.js est trop élevé pour un gain UX d'1 clic.
- L'option 3 (table dédiée) ajoute une table, un endpoint, et un mécanisme de session manuelle (créer une `session` Auth.js sans passer par le flow standard). Beaucoup de code, surface d'attaque non triviale (création de session = équivalent crypto à un token).
- L'option 2 est la moins inventive : elle réutilise le flow magic link déjà éprouvé, et le coût UX d'un email supplémentaire est marginal pour un acte qui se produit une fois par user dans la vie d'un groupe.

**Conséquences** :

- Nouveau service `web/src/lib/services/invitations.ts` avec `createInvitation` et `listPendingInvitations`.
- Nouveau helper email `web/src/lib/email/transport.ts` (factorise nodemailer + fallback console). Réutilisable pour les futurs notifs (relances justifs, transitions de statut remboursement, etc.).
- Nouveau template `web/src/lib/email/invitation.ts` — texte simple, pas de HTML au MVP.
- Nouvelle route API `web/src/app/api/invitations/route.ts` (POST création, GET liste).
- Nouvelle server action `web/src/lib/actions/invitations.ts` (consommée par la page admin).
- Nouvelle page `/admin/invitations` (UI admin), liée dans la sidebar pour `tresorier` / `RG`.
- **Pas d'évolution du adapter Auth.js** : `createUser` continue à throw. Le service d'invitation insère directement dans `users` via SQL, sans passer par Auth.js.
- **Pas de table `invitations` dédiée** : on s'appuie sur `users.email_verified IS NULL` pour identifier les invitations en attente.
- **Pas de TTL d'invitation** au MVP : un user créé qui ne se connecte jamais reste en attente indéfiniment. Le trésorier peut le supprimer à la main si besoin (hors scope de cet ADR).
- **Doublon possible** si le même email est invité deux fois dans le même groupe : le service vérifie via `(group_id, email)` et lève une erreur. Le contrainte d'unicité existe déjà côté schéma (cf. ON CONFLICT du seed `web/scripts/bootstrap.ts`).
- **Sécurité du formulaire admin** : `requireAdmin` côté page + check `ADMIN_ROLES` côté API + check côté server action. Triple ceinture-bretelle (page, API, action) parce que les trois sont accessibles séparément.

**Évolutions ultérieures non couvertes par cet ADR** :

- Ré-envoi d'un email d'invitation depuis l'UI admin (un clic).
- Suppression d'invitation en attente.
- TTL et nettoyage automatique.
- Magic link auto-généré (option 1) si le 2-mails se révèle douloureux à l'usage.
- OIDC SGDF : si un jour la fédération expose un IdP, un user invité avec un email correspondant peut directement se connecter via OIDC sans passer par le magic link — l'email de bienvenue restera utile pour pointer vers `/login`.

**Liens** :
- [`p2-workflows-internes.md`](p2-workflows-internes.md) — chantier 0.2
- [ADR-016](#adr-016--auth-multi-user--authjs-v5--magic-link--token-mcp) — auth multi-user
- [ADR-019](#adr-019--hiérarchie-de-rôles-applicatifs-v2) — rôles V2

---

## ADR-021 — Dépôt de justificatif libre : table dédiée séparée des écritures
**Date** : 2026-04-29
**Statut** : accepté

**Contexte** : le chantier 1 du plan workflows internes ([`p2-workflows-internes.md`](p2-workflows-internes.md)) doit permettre à n'importe quel user authentifié (sauf `parent`) de déposer un justif (photo / PDF + métadonnées : titre, montant, date, unité, catégorie, carte). Le trésorier rapproche ensuite ce dépôt avec une écriture comptable.

Deux options de modélisation ont été discutées :
1. **Le dépôt crée immédiatement une écriture en statut `brouillon`** + `justificatifs` attaché. Le trésorier traite le brouillon comme tous les autres (notamment ceux issus du scan Comptaweb).
2. **Le dépôt vit dans une table dédiée** `depots_justificatifs`, distincte de `ecritures`. Le rapprochement avec une écriture est une étape explicite côté UI trésorier.

**Décision** : option 2 (table dédiée).

Modèle :
```sql
CREATE TABLE depots_justificatifs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groupes(id),
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
  titre TEXT NOT NULL,
  description TEXT,
  category_id TEXT REFERENCES categories(id),
  unite_id TEXT REFERENCES unites(id),
  amount_cents INTEGER,
  date_estimee TEXT,
  carte_id TEXT REFERENCES cartes(id),
  statut TEXT NOT NULL DEFAULT 'a_traiter',  -- a_traiter | rattache | rejete
  ecriture_id TEXT REFERENCES ecritures(id), -- rempli quand statut=rattache
  motif_rejet TEXT,                          -- rempli quand statut=rejete
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Le file lui-même reste dans `justificatifs` avec `entity_type='depot'` + `entity_id=depot.id`. Au rattachement (statut → `rattache`), on update `justificatifs.entity_type='ecriture'` et `entity_id=ecriture.id` ; ainsi les services existants qui cherchent les justifs d'une écriture (`overview`, `ecritures.has_justificatif`, `drafts`) continuent de fonctionner sans modification.

**Raisons** :

- **Risque de doublons écarté** : `scanDraftsFromComptaweb` génère un `brouillon` à partir de chaque ligne bancaire non rapprochée. Si le déposant créait aussi un `brouillon`, on aurait deux brouillons pour la même opération réelle (un côté banque, un côté humain) qu'il faudrait merger. La table dédiée rend l'opération de rapprochement explicite et évite le merge inverse.
- **Workflow distinct** : `a_traiter → rattache | rejete` est un cycle de vie propre au dépôt. Le confondre avec celui d'une écriture (`brouillon → valide → saisie_comptaweb`) brouille la sémantique. Un dépôt peut être rejeté (justif illisible, hors scope) sans que ça touche une écriture.
- **Métadonnées sans valeur comptable** : le déposant fournit titre/description/montant/date/carte qui sont des indices pour le trésorier, pas de la donnée comptable validée. Les stocker dans `ecritures` mélangerait données validées et indices à confirmer.
- **Fonctionnellement compatible avec un changement futur** : si un jour on veut auto-créer un `brouillon` à partir du dépôt, on peut le faire — la table `depots_justificatifs` reste la trace d'audit du flux humain. L'inverse (auto-créer une `ecriture` puis revenir en arrière) serait beaucoup plus douloureux.
- **Pas de CHECK sur `statut`** : cohérent avec ADR-019 (validation côté code, pas en BDD). Les valeurs valides sont déclarées dans `web/src/lib/services/depots.ts` (`DEPOT_STATUTS`).

**Conséquences** :

- Nouvelle table `depots_justificatifs`, créée idempotemment par `ensureDepotsSchema` au lazy-init du module `lib/services/depots.ts` (même pattern que `ensureAuthSchema`).
- Nouveau service `web/src/lib/services/depots.ts` (CRUD + workflow + `listCandidateEcritures` qui propose les écritures sans justif matching ±10% montant et ±15j date).
- Nouvelles server actions `web/src/lib/actions/depots.ts` (`createDepot`, `attachDepotToEcriture`, `rejectDepot`).
- Nouvelles pages : `/depot` (form de soumission, mobile-first, accessible à `tresorier/RG/chef/equipier`) et `/depots` (file de traitement, accessible à `tresorier/RG`).
- Bouton "Relancer pour le justif" sur la page d'une écriture sans justif (admin only), envoi mail via `lib/email/relance.ts`.
- Liens dans la sidebar (`📎 Déposer un justif`, `📨 Dépôts à traiter`).
- **Sécurité de la route file** : `/api/justificatifs/[...path]/route.ts` était auparavant ouverte (pas d'auth). Patchée dans ce chantier : `requireApiContext` (session ou Bearer MCP) + vérification que `justificatifs.group_id` matche le groupe du user. Pas de filtrage par rôle au MVP (tout user du groupe voit tous les justifs du groupe) — à raffiner si nécessaire (`chef` → unité, `equipier` → siens).
- **Pas de pré-remplissage `?ecriture_hint=<id>`** au MVP : l'email de relance pointe vers `/depot` sans préremplir les champs depuis l'écriture relancée. À ajouter si l'usage le demande.
- **Pas de notification au déposant** quand son dépôt est rattaché ou rejeté. Évolution possible.
- **Pas de purge** des files de dépôts rejetés : le justif reste en storage avec `entity_type='depot'`. À rajouter si volume devient un souci.

**Liens** :
- [`p2-workflows-internes.md`](p2-workflows-internes.md) — chantier 1
- [ADR-019](#adr-019--hiérarchie-de-rôles-applicatifs-v2) — pas de CHECK SQL sur enums applicatifs
- [ADR-014](#adr-014--écritures--flag-justif_attendu-plutôt-quenum-à-trois-états) — modèle des justifs côté écritures (réutilisé sans modif)

---

## ADR-022 — Refonte du modèle remboursement : multi-lignes + 5 statuts + feuille PDF générée
**Date** : 2026-04-29
**Statut** : accepté

**Contexte** : la première impl du workflow remboursement self-service (chantier 2 du plan workflows internes, livrée juste avant) avait été écrite sans regarder le draft existant `~/Perso/valdesous` (app webapp Express + Airtable + Firebase utilisée jusqu'ici). Diff identifiée :
1. valdesous saisit **prénom / nom / email / RIB** explicitement (pas auto-rempli depuis le user) — utile car les bénévoles occasionnels n'ont pas forcément de compte Baloo, et un trésorier peut saisir pour quelqu'un d'autre.
2. valdesous demande une **feuille de remboursement** (Excel/PDF SGDF) signée à uploader, et **N justificatifs** (tickets) séparés. Côté Baloo, on n'avait qu'**un seul fichier**.
3. valdesous a une **timeline 5 étapes** : `À traiter → Validé Trésorier → Validé RG → Virement effectué → Terminé` (avec rôle RG distinct du trésorier). Côté Baloo, on n'avait que `demande/valide/paye/refuse`.
4. valdesous fonctionne **sans login** via tokens (`edit_token`, `validate_token`).

Le user a tranché : garder l'impl Baloo (auth, scopes, etc.) **+** rapprocher du workflow valdesous, en remplaçant la "feuille de remboursement Excel" par une feuille **reconstruite côté Baloo** depuis des données structurées + génération PDF auto à la soumission. Avantage : plus de saisie redondante (le bénévole ne remplit plus à la main une feuille puis upload, tout se passe dans le form).

**Décision** :

1. **Modèle "1 demande = N lignes de dépense"** :
   - Nouvelle table `remboursement_lignes(id, remboursement_id, date_depense, amount_cents, nature, notes, created_at)`.
   - `remboursements.total_cents` (nouveau) recalculé à chaque modification de ligne via `recalcTotal(rbtId)`. `amount_cents` legacy mirroré sur `total_cents` pour compat avec les services historiques.
   - Migration : pour chaque demande pré-existante (mono-ligne), création automatique d'une ligne reprenant les anciens champs `date_depense / amount_cents / nature`.

2. **Nouveaux champs sur `remboursements`** :
   - `prenom`, `nom`, `email` (auparavant tout dans `demandeur`).
   - `rib_texte`, `rib_file_path` (le RIB devient un champ de premier ordre).
   - `motif_refus` (auparavant fourré dans `notes`).
   - `edit_token`, `validate_token` (pour la phase B = workflow public token-based, non implémentée ici mais champs ajoutés en avance).

3. **Refonte des statuts** : 5 étapes valdesous + refus.
   - `a_traiter → valide_tresorier → valide_rg → virement_effectue → termine` + `refuse` (depuis n'importe quelle étape avant `termine`).
   - Migration des anciens statuts : `demande→a_traiter`, `valide→valide_tresorier`, `paye→virement_effectue`, `refuse→refuse`.
   - DROP de la CHECK SQL historique sur `status` (recréation de table, idempotente, comme [ADR-019](#adr-019--hiérarchie-de-rôles-applicatifs-v2)). Validation des statuts désormais côté code (`RBT_STATUTS` dans `lib/services/remboursements.ts`).
   - Garde de transition + check de rôle dans `updateRemboursementStatus` : `valide_tresorier` réservé au `tresorier`, `valide_rg` réservé au `RG`. Le RG n'est qu'un alias droits-équivalents-au-tresorier au MVP, mais cette transition impose qu'un humain "RG" l'effectue explicitement → introduit le **double validateur** prévu dans ADR-019.

4. **Génération PDF "feuille de remboursement" à la soumission** :
   - Lib retenue : **`pdfkit`** (impératif, ~250 KB). `@react-pdf/renderer` testé d'abord mais **incompatible types React 19** au moment du build (typeof View/Text non assignable à JSX.IntrinsicAttributes). Pas de patch propre disponible côté types — basculé sur pdfkit.
   - Module `web/src/lib/pdf/feuille-remboursement.ts` : prend la demande + ses lignes + le nom du groupe, retourne un `Buffer` PDF.
   - **Stockage** : pas de nouvelle table ni de nouveau champ dédié. Le PDF est attaché via `attachJustificatif` avec `entity_type='remboursement_feuille'` (cf. [ADR-021](#adr-021--dépôt-de-justificatif-libre--table-dédiée-séparée-des-écritures) qui pose ce pattern). Réutilise route + auth existantes.
   - Idem pour le RIB file : `entity_type='remboursement_rib'`.
   - Idem pour les justifs (tickets/factures) : `entity_type='remboursement'`.

5. **UI** :
   - Form `/moi/remboursements/nouveau` refait en client component avec éditeur multi-lignes (boutons + / − ligne, total live).
   - Page `/remboursements/[id]` : timeline 5 étapes + boutons d'actions conditionnés au statut courant ET au rôle (le bouton "Valider Trésorier" n'apparaît que pour le rôle `tresorier` ; "Valider RG" seulement pour `RG`).
   - Section refus accessible à toute étape avant `termine`, avec motif obligatoire.

**Raisons** :

- **Reconstruire la feuille depuis des données structurées plutôt que la stocker en Excel** : les données sont exploitables côté trésorier (matching avec lignes bancaires, recalcul, recherches), et le PDF généré reste produisible "en cas de contrôle" (citation du user). Plus fiable qu'un Excel reçu chiffres faits à la main qui peut contenir n'importe quoi.
- **`pdfkit` plutôt que `@react-pdf/renderer`** : compatibilité types React 19. Si le projet revient à React 18 ou si `@react-pdf/renderer` patche ses types, on pourra réévaluer ; pour le moment pdfkit fait le job avec une syntaxe impérative un peu plus verbeuse mais sans surprise.
- **Pas de nouvelle table dédiée pour la feuille** : `entity_type='remboursement_feuille'` dans `justificatifs` réutilise toute l'infra (storage backend, route auth, listing). Pattern aligné avec ADR-021 (dépôts de justif).
- **Double validateur (Trésorier + RG)** : honore l'organigramme SGDF (le RG est supérieur hiérarchique du trésorier) et matérialise le rôle distinct posé dans ADR-019. Au MVP, RG et Trésorier ont les mêmes accès lecture, mais `valide_rg` ne peut être déclenché QUE par un user `role='RG'` — ce qui force qu'une seconde personne ait validé.
- **Signature électronique simple** (case à cocher au form, horodatage en BDD) : suffit pour l'usage interne SGDF. Si un jour il faut une signature qualifiée (eIDAS), ce sera un autre chantier.

**Conséquences** :

- Migration BDD non triviale dans `web/src/lib/auth/schema.ts` :
  - DROP CHECK `status` via recréation de table (procédure SQLite standard, PRAGMA foreign_keys = OFF / ON, DROP TABLE / RENAME).
  - Mapping des anciens statuts vers les nouveaux dans le `INSERT … SELECT`.
  - CREATE TABLE `remboursement_lignes` + INSERT auto pour les demandes pré-existantes mono-ligne.
- Le service `remboursements.ts` gagne `addLigne`, `listLignes`, `deleteLigne`, `recalcTotal`, plus le filtre `submittedByUserId` (déjà ajouté au chantier 2). `RBT_STATUTS` exporté pour validation côté code.
- Le service `updateRemboursement` accepte désormais `motif_refus`. La server action `updateRemboursementStatus` change de signature (FormData en dernier arg pour pouvoir être bind sur des forms).
- Page admin `/remboursements/[id]` refaite avec timeline + actions par rôle.
- Page demandeur `/moi/remboursements/nouveau` refaite en client component multi-lignes.
- Nouvelle dépendance : `pdfkit` + `@types/pdfkit`. ~250 KB, pas d'impact runtime sensible. Les fonts core PDF (Helvetica, Times, Courier) sont fournies en AFM par pdfkit, pas besoin de fichiers supplémentaires.
- Le component `RemboursementStatusBadge` connaît les 6 nouvelles valeurs. Pages `/moi`, `/remboursements`, `/remboursements/[id]` mises à jour.
- Routes API `/api/remboursements` (zod enum) mises à jour avec les nouveaux statuts.
- **Phase B reste à faire** : workflow public token-based (pages `/r/...`, envoi de tokens par email). Les colonnes `edit_token` et `validate_token` sont déjà en BDD ; il manque l'UI publique et la logique de génération / vérification des tokens.

**Limites assumées** :

- Le PDF est généré à la soumission, jamais regénéré ensuite. Si le RG modifie une ligne (par exemple via SQL en cas de pépin), le PDF archivé reste celui d'origine. Cohérent avec l'idée "trace immuable de ce qu'a soumis le bénévole".
- Pas de versioning des PDF.
- Pas de pré-validation côté client (autre que `required` HTML). Si le user soumet 0 ligne, le serveur refuse via redirect avec error.

**Liens** :
- [`p2-workflows-internes.md`](p2-workflows-internes.md) — chantier 2 / 2-bis
- [ADR-019](#adr-019--hiérarchie-de-rôles-applicatifs-v2) — rôles V2 (RG distinct, validation côté code)
- [ADR-021](#adr-021--dépôt-de-justificatif-libre--table-dédiée-séparée-des-écritures) — pattern `entity_type` réutilisé pour le PDF feuille
- `~/Perso/valdesous` — draft Express+Airtable+Firebase d'origine (workflow source d'inspiration)

---

## ADR-023 — Signature électronique simple avec chaînage interne (multi-signatures par document)
**Date** : 2026-04-29
**Statut** : accepté

**Contexte** : la feuille de remboursement générée à la soumission ([ADR-022](#adr-022--refonte-du-modèle-remboursement--multi-lignes--5-statuts--feuille-pdf-générée)) doit être signée — pas seulement par le demandeur mais aussi par le trésorier puis le RG aux étapes de validation. Le user a précisé : "plusieurs signatures sont attendues sur la demande : RG (ou autre responsable, trésorier ?) et demandeur".

L'usage cible (remboursements de bénévoles d'asso loi 1901, contrôle URSSAF / fiscal éventuel) ne demande pas de signature qualifiée eIDAS (QES). Une **signature électronique simple (SES)** au sens eIDAS art. 25 suffit, à condition d'avoir un audit trail solide. Pour un cran de plus sans payer un PSCQ, on peut ajouter un timestamping RFC 3161 (TSA externe type FreeTSA) — mais le boilerplate ASN.1 est conséquent.

**Décision** :

1. **Une table `signatures`** dédiée, multi-instances par document :
   ```sql
   CREATE TABLE signatures (
     id TEXT PRIMARY KEY,
     document_type TEXT NOT NULL,
     document_id TEXT NOT NULL,
     signer_role TEXT NOT NULL,   -- 'demandeur' | 'tresorier' | 'RG' | ...
     signer_user_id TEXT REFERENCES users(id),
     signer_email TEXT NOT NULL,
     signer_name TEXT,
     data_hash TEXT NOT NULL,     -- SHA-256 des données canoniques au moment de la signature
     previous_signature_id TEXT REFERENCES signatures(id),
     chain_hash TEXT NOT NULL,    -- SHA-256(prev || data_hash || role || email || timestamp)
     ip TEXT,
     user_agent TEXT,
     server_timestamp TEXT NOT NULL,
     tsa_response TEXT,           -- NULL au MVP, prêt pour RFC 3161
     tsa_timestamp TEXT,
     created_at TEXT NOT NULL
   );
   ```

2. **Hash canonique des données métier** (pas du PDF) : on hash `{id, prenom, nom, email, rib_texte, rib_file_path, lignes triées par id}`. Si une ligne ou un champ est modifié après une signature, le hash recalculé ne matche plus celui stocké → falsification détectable. Le statut et les autres champs de workflow (qui changent par construction au fil des validations) sont **exclus** du hash canonique.

3. **Chaînage type mini-blockchain** : `chain_hash` de chaque signature inclut le `chain_hash` de la précédente. Toute insertion / suppression / modification d'une ligne d'audit casse la chaîne suivante. La fonction `verifyChain(documentType, documentId)` recalcule et compare.

4. **3 signatures par demande de remboursement** :
   - À la soumission → `signer_role='demandeur'`.
   - À la transition `valide_tresorier` → `signer_role='tresorier'`.
   - À la transition `valide_rg` → `signer_role='RG'`.
   Les rôles sont contraints par les gardes de transition existantes (cf. ADR-022) : un user `equipier` ne peut pas signer comme `tresorier`.

5. **Capture du contexte** côté server action : IP (via `x-forwarded-for` ou `x-real-ip`), user agent (header `User-Agent`), timestamp serveur (ISO 8601). Stockés en clair dans la table.

6. **Régénération du PDF feuille à chaque signature** avec un encart "Signatures" mis à jour en dernière page (rôle, nom, email, date, IP, hash data + chain). Le PDF en BDD est écrasé via `attachJustificatif(entity_type='remboursement_feuille')` (les anciennes versions restent en storage et apparaissent en historique). La preuve juridique vit dans la table `signatures`, pas dans le PDF — qui est juste un rendu lisible humain.

7. **Pas de TSA externe au MVP** : le champ `tsa_response` (et `tsa_timestamp`) reste NULL. Le chaînage interne donne déjà une bonne valeur de preuve sans dépendance externe. RFC 3161 (FreeTSA ou autre) pourra être ajouté ultérieurement sans migration BDD ni changement de schéma — c'est le sens du champ "prêt".

**Raisons** :

- **SES suffit** pour l'usage cible : eIDAS art. 25 reconnaît la SES comme preuve recevable (ne peut être refusée au seul motif qu'elle est électronique). C'est ce qu'utilisent la majorité des asso. Au-delà (AES via certificats X.509 ou QES via PSCQ), c'est de l'overengineering pour un remboursement de tickets de métro.
- **Hash des données plutôt que du PDF** : permet de régénérer le PDF (par exemple à chaque signature pour mettre à jour l'encart) sans invalider les hashes des signatures précédentes. La preuve porte sur les données métier, pas sur leur représentation visuelle.
- **Chaînage interne plutôt que TSA externe au MVP** : 0 dépendance, 0 € / mois, ~3 h de dev. Le coût/bénéfice de RFC 3161 (FreeTSA = ASN.1 DER manuel ou lib `@peculiar/asn1-tsp`) ne se justifie pas tant qu'on n'a pas un cas concret de contestation de date.
- **Table dédiée `signatures` plutôt que colonnes sur `remboursements`** : on aura besoin de signer d'autres documents (abandons de frais, recettes, etc.) avec le même mécanisme. La table polyvalente (`document_type` + `document_id`) évite la duplication.
- **Rôle libre côté schéma** (TEXT, pas CHECK) : cohérent avec ADR-019 (validation côté code, pas en BDD). Permet d'ajouter un rôle `cotresorier` ou autre sans migration.

**Conséquences** :

- Migration BDD idempotente dans `web/src/lib/auth/schema.ts` : `CREATE TABLE IF NOT EXISTS signatures`.
- Nouveau service `web/src/lib/services/signatures.ts` : `signDocument`, `listSignatures`, `verifyChain`. Indépendant du domaine remboursement (utilisable pour abandons, etc.).
- Nouveau helper `web/src/lib/services/remboursement-signing.ts` : orchestration "signer + régénérer PDF" en un appel.
- Nouveau helper `computeRemboursementHash(rbt, lignes)` dans `lib/services/remboursements.ts` (export pur).
- Server action `createMyRemboursement` : appelle le helper en fin d'exécution avec `signer_role='demandeur'`.
- Server action `updateRemboursementStatus` : appelle le helper sur les transitions `valide_tresorier` et `valide_rg`.
- PDF (`lib/pdf/feuille-remboursement.ts`) accepte un paramètre `signatures` et rend l'encart "Signatures électroniques" en dernière page.
- Page admin `/remboursements/[id]` : section "Signatures" sur la sidebar droite, avec badge "✓ chaîne intègre" / "⚠ chaîne brisée" (résultat de `verifyChain`), liste des signataires + IP + timestamp + hashes (en details collapsible).
- **Capture IP en local** peut retourner null (pas de `x-forwarded-for` derrière Next dev server). En prod sur Vercel, `x-forwarded-for` contient l'IP réelle.
- **PDF historique** : à chaque signature, une nouvelle ligne dans `justificatifs` avec `entity_type='remboursement_feuille'`. La page admin affiche la plus récente par défaut + un compteur "(N versions)". Les anciennes versions restent accessibles via l'API mais pas mises en avant. Pas de purge auto au MVP.

**Limites assumées** :

- **Pas de timestamping opposable** au MVP. Si quelqu'un conteste la date de signature, on n'a que le timestamp serveur (qui peut théoriquement être falsifié par l'opérateur). Le chaînage protège contre la modification a posteriori d'une ligne, pas contre la falsification de date à la création.
- **Pas de signature cryptographique du PDF** lui-même (PKCS#7 / PAdES). Adobe Reader ne reconnaîtra pas les signatures. Cohérent avec une SES pure : la valeur de preuve vit dans l'audit trail BDD.
- **Hash limité aux données canoniques explicites** : si on ajoute un nouveau champ à `remboursements` plus tard, il faut penser à l'inclure dans `computeRemboursementHash` sinon il ne sera pas couvert par les signatures.
- **Nettoyage des PDF historiques** non implémenté : N signatures = N PDFs en storage. À surveiller si volume devient un problème.

**Évolutions ultérieures** :

- **Activation TSA RFC 3161** : implémenter `getTsaTimestamp(hash)` qui appelle FreeTSA (ou autre). Stocker la `TimeStampResp` DER-encodée dans `tsa_response` + le timestamp en clair dans `tsa_timestamp`. Pas de migration BDD nécessaire.
- **Signature PAdES sur le PDF** : utiliser `node-signpdf` + un certificat (auto-généré ou délivré par PSCQ) pour incruster une vraie signature PKCS#7 dans le PDF. Compatible Adobe Reader. Niveau AES.
- **Étendre aux abandons** : appeler `signDocument({ document_type: 'abandon', ... })` à la création / validation. Service polyvalent.

**Liens** :
- [ADR-022](#adr-022--refonte-du-modèle-remboursement--multi-lignes--5-statuts--feuille-pdf-générée) — modèle multi-lignes, génération PDF
- [ADR-019](#adr-019--hiérarchie-de-rôles-applicatifs-v2) — rôles applicatifs et validation côté code
- [eIDAS art. 25-26](https://eur-lex.europa.eu/eli/reg/2014/910/oj) — Signature électronique simple / avancée

---

## ADR-024 — Workflow abandons étendu (a_traiter → valide → envoye_national + flag CERFA séparé)

**Contexte** : la P2 livrait un workflow abandons minimaliste (création + flag `cerfa_emis` toggle admin). Insuffisant en pratique : le trésorier doit suivre **avant** l'envoi au national (avoir signé la feuille, l'avoir envoyée à `donateurs@sgdf.fr`), puis **après** (CERFA reçu en retour, parfois plusieurs semaines plus tard). Sans étapes intermédiaires, la to-do se perdait.

**Décision** : workflow à 3 étapes + statut terminal :

```
a_traiter → valide → envoye_national
       ↓        ↓
       refuse   refuse
```

Le flag `cerfa_emis` (booléen + `cerfa_emis_at`) reste **séparé** du status. Le retour CERFA est asynchrone et peut tomber après la fin du workflow logique. Une fois `envoye_national`, le statut est figé et seul `cerfa_emis` évolue.

**Champs ajoutés à `abandons_frais`** (migration idempotente dans `auth/schema.ts`) :
- `status TEXT DEFAULT 'a_traiter'` (sans NOT NULL pour libsql, cf. AGENTS.md ; backfill explicite)
- `motif_refus TEXT`
- `sent_to_national_at TEXT`, `cerfa_emis_at TEXT`
- `prenom`, `nom`, `email` (le champ legacy `donateur` reste rempli pour rétrocompat)

**UI** :
- Page liste `/abandons` ouverte aux non-admins avec scope auto (un equipier voit ses propres abandons, admin voit tout le groupe).
- Page détail `/abandons/[id]` (nouvelle) : timeline status + sidebar feuille/justifs + bloc actions admin (validation, envoi national avec mailto pré-rempli, toggle CERFA, refus avec motif).
- Page admin `/abandons/nouveau` : saisie pour autrui (rattrapage d'historique, aide aux donateurs qui ne se connectent pas eux-mêmes). `submitted_by_user_id` reste NULL.
- Helper `buildNationalMailto()` qui génère un mailto: pré-rempli pour `donateurs@sgdf.fr` (sujet + corps avec infos du don). PJ à attacher manuellement par l'admin (limite du protocole mailto:).

**Garde de transitions** : module pur `isAllowedAbandonTransition(from, to)` testable sans BDD. Self-transitions interdites, statuts terminaux verrouillés.

**Modèles SGDF** servis statiquement depuis `web/public/docs/` :
- `formulaire_abandon.xlsx` (formulaire à compléter)
- `fiche_abandon.pdf` (notice explicative SGDF)
- Lien dans le form `/moi/abandons/nouveau`.

**Liens** :
- [ADR-022](#adr-022--refonte-du-modèle-remboursement--multi-lignes--5-statuts--feuille-pdf-générée) — pattern workflow + transitions sur rembs.
- Doc SGDF : `web/public/docs/fiche_abandon.pdf`.

---

## ADR-025 — Journal d'erreurs interne plutôt que tier externe (Sentry-like)

**Contexte** : un crash en prod sans log accessible = aveuglement total. Vercel CLI `vercel logs` est quasi inutilisable (ne stream que les nouveaux logs, jamais l'historique). L'épisode du `CREATE INDEX idx_abandons_status` qui cassait l'auth en boucle n'a été identifié que via le user qui l'a vu en local — sans ça, on aurait eu zéro feedback de la prod.

**Décision** : table `error_log` en BDD + helper `logError(mod, message, err, data)` qui persiste en fire-and-forget + page admin `/admin/errors`. **Pas de tier externe** (Sentry, Logtail, Datadog) au MVP.

**Justifications** :
- Coût marginal 0 € (vs 26 $/mois Sentry team).
- Pas de fuite de données vers un tier (pas de DPA à signer).
- Implémentation : ~45 min vs intégration tier (env vars, source maps upload, dépendance npm, ADR séparé).
- Suffisant pour un usage à 1-5 users actifs (volume d'erreurs faible). Si on bascule en multi-groupes (P3) avec 50+ users actifs, on pourra rebasculer sur un tier.

**Implémentation** :
- Table `error_log(id, mod, message, error_name, stack, data_json, created_at, resolved_at, resolved_by)` dans `business-schema.ts`.
- `lib/log.ts` : `logError()` émet en console + persiste en BDD via `persistError()` en fire-and-forget. Si la BDD plante, console.error direct sans récursion.
- `lib/services/errors.ts` : `listErrors`, `markErrorResolved`, `markErrorGroupResolved`.
- Page `/admin/errors` (admin only) avec tabs Non résolues / Toutes + counter, stack et data en details (pas affichés par défaut), bouton "Marquer résolue" / "Ré-ouvrir".

**Pattern de debug** : pour identifier quel `await` plante dans une page, wrapper avec :

```ts
async function trace<T>(mod: string, p: Promise<T>): Promise<T> {
  try { return await p; } catch (err) {
    logError(`page-name/${mod}`, 'await failed', err);
    throw err;
  }
}
```

Puis `await trace('myFn', maFonction())`. L'erreur apparaît dans `/admin/errors` avec le mod précis. À retirer après debug.

**Limites assumées** : pas d'alerting (mail / webhook). Le user doit aller consulter `/admin/errors` activement. Si le besoin émerge, ajouter un envoi Resend conditionnel (ex. > 5 erreurs identiques en 1h).

---

## ADR-026 — Home unifiée centrée utilisateur (suppression de `/moi`)

**Contexte** : la home `/` affichait jusqu'au commit `9ab65ac` le tableau de bord du trésorier (KPIs trésorerie + tableau par unité). Inutile pour les autres rôles (parent, equipier, chef) qui voyaient des chiffres comptables sans contexte d'action. La page `/moi` portait une vue archive des demandes du user, mais avec la home refondue les deux devenaient redondants.

**Décision** :

1. **Home unifiée pour tous les rôles** : bandeau hello + actions rapides (3-4 cards CTA selon le rôle) + Mes demandes (5 dernières, rembs + abandons mélangés) + (admin only) bloc "À traiter pour le groupe" avec compteurs cliquables + lien vers la nouvelle `/synthese`.

2. **Tableau de bord trésorier déménagé** vers `/synthese` (KPIs + tableau par unité tels quels). Lien dans la sidebar pour les rôles qui en ont besoin (`tresorier`, `RG`, `chef`).

3. **`/moi` supprimé** (redondant) — la page devient un simple redirect vers `/` qui préserve les query params (flash messages `?rbt_created`, `?abandon_created`, `?error`). Garde l'URL pour ne pas casser les liens existants (notifications email, server actions). Sidebar : "Mon espace" retiré.

4. **`/abandons` ouvert aux non-admins** avec scope auto (`submittedByUserId = userId` pour non-admin). Cohérent avec le comportement déjà en place sur `/remboursements`.

**Conséquences** :
- Une seule porte d'entrée → moins de friction pour l'onboarding d'un nouveau user.
- Les liens "Tout voir" sur la home pointent vers `/remboursements` et `/abandons` (qui scope auto pour non-admin).
- Le bandeau "Bienvenue sur Baloo" apparaît la première fois (cookie `baloo_welcome_dismissed` 1 an, server action `dismissWelcomeBanner`).

**Si plus tard on a besoin de "préférences perso"** (RIB par défaut explicite, opt-in/out notifs), créer `/parametres` plutôt que ressusciter `/moi`. Distinction claire : la home = "ce qui se passe maintenant", `/parametres` = "comment je veux que Baloo se comporte pour moi".

---

## ADR-027 — Pas d'engagements de délai user-facing

**Contexte** : la page `/aide` et plusieurs sous-titres affirmaient "Réponse sous 48h en moyenne" / "le CERFA arrivera sous 3 mois" / "L'envoi du mail prend 10-20 secondes" / etc. Le user a explicitement refusé : aucune de ces phrases n'est tenable comme engagement (le trésorier est bénévole, le national peut prendre plus, l'envoi mail dépend de Resend / SMTP).

**Décision** : **aucun délai chiffré** dans les copies user-facing. Reformuler en termes descriptifs :

| ❌ Avant | ✅ Après |
|---|---|
| "Réponse sous 48h en moyenne" | (rien) |
| "Délai habituel 1-3 semaines" | "Le virement part une fois la double-validation faite" |
| "CERFA reçu sous 3 mois" | "Le CERFA arrivera par mail" |
| "L'envoi du mail prend 10-20 secondes" | (rien) |
| "Compare en 30 secondes" | "Voir la comparaison" |

**Exception** : les **deadlines réglementaires SGDF** (ex. "envoyer la déclaration d'abandon avant le 15 avril N+1 pour les dépenses de l'année N") sont conservées — c'est une contrainte légale documentée par SGDF, pas un engagement Baloo.

**Cas connexe — affirmations fiscales** : ne pas affirmer "réduction d'impôt 66%" pour un CERFA d'abandon. C'est dépendant de la situation fiscale (plafond art 200 CGI à 20% du revenu imposable, contributions complémentaires…). La doc SGDF officielle (`web/public/docs/fiche_abandon.pdf`) dit juste "réduction d'impôt sur le revenu (art 200 CGI)". Cette formulation est juste, suffisante, et n'engage pas Baloo sur un chiffre potentiellement faux.

**Liens** : commit `49fe17a` (ratissage des copies), commit `1253841` (correction CERFA 66%).

---

## ADR-028 — Capture justif type "scan" : niveaux 1 + 2 livrés, niveau 3 (OCR + pré-remplissage) reporté

**Date** : 2026-05-04
**Statut** : niveaux 1 + 2 acceptés et livrés ; niveau 3 reporté

**Contexte** : la capture de justif via `<input type="file" capture="environment">` natif fonctionne mais produit des photos lourdes, mal cadrées, peu lisibles. Adobe Scan a fixé l'attente UX : détection automatique du document + crop perspective + filtre noir/blanc. Faut-il imiter, jusqu'où ?

**Décision** : implémenter en 3 niveaux progressifs, ne livrer que les 2 premiers maintenant.

### Niveau 1 — toujours actif (composant `JustifCapture`)
- 2 boutons explicites "Prendre une photo" / "Choisir un fichier"
- Preview immédiat
- 3 filtres canvas 2D : Couleur (passthrough), Document (contraste +20 %, sat -15 %), Noir & blanc (grayscale + contraste 2.1×)
- Resize max 2000 px sur le grand côté + JPEG q=0.85 → upload 5-10× plus léger
- PDF passe en pass-through sans traitement

Aucune dépendance externe ajoutée. Aucun coût bundle. Marche partout.

### Niveau 2 — à la demande
- Bouton "Détecter le document" dans la preview
- Charge OpenCV.js (~9 Mo) depuis le CDN `docs.opencv.org/4.7.0/opencv.js` + jscanify (lazy import via `jscanify/client`)
- Détection auto des 4 coins du papier (Canny + Otsu + findContours)
- Mode crop : overlay SVG avec poignées draggables pour ajuster manuellement
- "Appliquer" → `cv.warpPerspective` → image rectifiée, traverse ensuite le pipeline filtre niveau 1
- Fallback si la détection échoue : 4 coins par défaut (10/90 %) avec invite à les ajuster

**Choix CDN externe** plutôt que self-host d'OpenCV.js : éviter de stocker 9 Mo de binaire dans `/public` (pollue le repo, ralentit les builds). Compromis assumé : dépendance d'un service externe, mais `docs.opencv.org` est l'endpoint officiel et stable depuis des années. Si problème de fiabilité, fallback simple : copier le fichier dans `/public/opencv/opencv.js` et mettre à jour `OPENCV_CDN` dans `lib/scanify.ts`.

### Niveau 3 — REPORTÉ : OCR + pré-remplissage automatique du formulaire de dépôt

**Vision** : après la capture (et idéalement le crop), Baloo lit le justif et pré-remplit `titre`, `amount_cents`, `date_estimee`, suggère `category_id`, et propose `unite_id` quand pertinent. L'utilisateur valide / corrige.

**Options techniques envisagées** :

| Approche | Lib / API | Coût | Qualité OCR | Latence | Pré-remplissage intelligent |
|---|---|---|---|---|---|
| Tesseract.js client | `tesseract.js` (~3 Mo + langs) | gratuit | moyenne (tickets imprimés OK, manuscrits non) | 2-10 s sur mobile | non, juste OCR brut → faut parser nous-mêmes |
| Anthropic vision serveur | `claude-haiku-4-5` multimodal | ~0.5-2 ¢ / image | excellente, multilingue, comprend le contexte | 1-3 s | oui directement (prompt structured output → champs prêts) |
| Mistral Pixtral / OCR | API Mistral | ~0.1-0.5 ¢ / image | bonne | 1-2 s | partiel (OCR + parsing à faire) |
| Google Vision API | Cloud Vision OCR | ~0.15 ¢ / image | excellente | 0.5-1 s | non, juste OCR + entity extraction limité |

**Préférence à explorer** : **Anthropic vision côté serveur** (route API Next dédiée) avec un prompt qui demande directement les champs structurés (montant TTC, date, vendeur, catégorie suggérée parmi la liste du groupe). Avantages : qualité top, pré-remplissage en un seul aller-retour, cohérent avec la stack actuelle si on intègre l'API Anthropic. Coût ~0.5-2 ¢/justif acceptable au volume groupe SGDF (~100-200 justifs/an = max 4 €/an).

**Pourquoi reporté** :
- Coût opérationnel récurrent (même faible) → besoin d'un budget assumé et d'une variable d'env supplémentaire (`ANTHROPIC_API_KEY`)
- Complexité prompt + validation des champs extraits (le LLM peut halluciner un montant, faut UI de relecture obligatoire)
- Intérêt à valider d'abord en usage réel que le scan niveau 1+2 est utilisé activement avant d'ajouter cette couche
- Gain UX réel mais marginal vs coût d'implémentation

**À reprendre quand** : (a) le scan niveau 1+2 est utilisé sur > 50 % des dépôts en prod, et (b) l'utilisateur identifie le pré-remplissage manuel comme friction réelle (pas juste hypothétique).

### Conséquences

- Niveau 1 + 2 livrés sur `/depot`. Composant `JustifCapture` réutilisable ailleurs si besoin (justifs liés à des écritures, RIB des remboursements, etc.).
- Dépendance npm `jscanify@1.4.2` ajoutée. ~30 Mo unpacked (OpenCV.js inclus dans le package, mais on charge OpenCV via CDN, pas depuis node_modules). Bundle Next 16 ne pèse que jscanify.js (~10 KB), chargé en lazy chunk.
- L'utilisateur paye un coût initial de ~9 Mo + 3-5 s de chargement uniquement quand il clique "Détecter le document" — jamais sur la prise de photo standard.
- Si OpenCV CDN tombe : niveau 1 reste fonctionnel, le bouton "Détecter" affiche une erreur claire.

**Liens** : commits `eb586b5` (niveau 1), `cb91a1c` (niveau 2). Code : `web/src/components/shared/justif-capture.tsx`, `web/src/lib/scanify.ts`, `web/src/types/jscanify.d.ts`.

---

*Ajouter ici toute nouvelle décision significative, avec un numéro ADR-00X incrémental.*
