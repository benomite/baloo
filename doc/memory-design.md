# Conception de la mémoire

> **Note 2026-04-25** : la mémoire opérationnelle vit en BDD ([ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)). `mon-groupe/` n'existe plus dans le repo ; les structures markdown décrites en bas de ce document sont **historiques** et conservées à titre de référence. La trajectoire P2 (cf. [`roadmap.md`](roadmap.md)) déplace en outre cette BDD côté webapp : la SQLite locale du MCP `baloo-compta` est provisoire. Les principes d'écriture (faits atomiques, dates ISO, mise à jour plutôt que suppression) **restent valables** et s'appliquent telles quelles aux entrées BDD (tables `notes`, `personnes`, etc.) et aux fichiers markdown encore vivants (`sgdf-core/`, `doc/`).

La mémoire est **l'actif central** de Baloo. Le code est remplaçable, mais la formalisation de qui fait quoi, comment tient-on la compta, quelles sont les décisions passées — ça, c'est irremplaçable.

## Principes

Tirés des bonnes pratiques actuelles (voir [`references.md`](references.md)) adaptées à notre contexte :

1. **Extraction plutôt que résumé.** On ne stocke pas "résumé de la conversation d'hier avec Marie". On extrait des faits discrets : "Marie Dupont est trésorière adjointe depuis 2026-01". Chaque fait est atomique, recherchable, modifiable.
2. **Pipeline CRUD.** La mémoire doit pouvoir être lue, ajoutée, **mise à jour** et **supprimée**. Une mémoire append-only se dégrade.
3. **Temporalité explicite.** Beaucoup d'infos associatives sont datées (budget 2025, trésorier 2024). On tague les faits avec une date de validité plutôt que de tout laisser au présent.
4. **Lisibilité humaine.** La mémoire doit rester lisible sans l'agent. Markdown, organisation sémantique, pas de format proprio.
5. **Sémantique, pas chronologique.** On organise par sujet (personnes, compta, process), pas par date d'ajout.

## Les trois couches

### Court terme — le contexte de la conversation
Géré par Claude Code automatiquement. Rien à faire.

### Moyen terme — l'état courant
Ce qui est vrai **maintenant** dans l'asso : bureau en place, comptes ouverts, budgets votés, échéances à venir. Stocké en BDD via les tables `groupes`, `personnes`, `comptes_bancaires`, `budgets`, `notes` (cf. tableau ci-dessous), accessibles via le MCP `baloo-compta`.

### Long terme — le savoir
Ce qui est stable ou historique : process compta, glossaire SGDF, décisions passées, historique des trésoriers. Stocké en BDD pour ce qui est spécifique au groupe (table `notes` topic='historique', `personnes` avec `jusqu_a`/`statut='ancien'`, etc.) et en markdown pour ce qui est partageable (`sgdf-core/`).

Pas de vector store : Claude Code parcourt sans difficulté quelques dizaines de fichiers markdown et la BDD reste de petite taille tant qu'on est sur un seul groupe. pgvector ou équivalent ne sera introduit qu'à la P3 si le besoin émerge.

## Structure de mémoire (présent)

**Markdown versionné en git** (générique, partageable, public-ready) :

```
sgdf-core/
├── glossaire.md
├── ressources-chefscadres/
└── skills/
    └── remboursement/SKILL.md

doc/                  ← conception, décisions (ADRs), refs
```

**BDD multi-tenant** (`data/baloo.db` en P1, BDD côté webapp en P2 — gitignored) :

| Table | Contenu |
|---|---|
| `groupes`, `users`, `personnes` | Identité du groupe et des humains qui gravitent autour. |
| `comptes_bancaires`, `budgets`, `budget_lignes` | État financier structurel. |
| `ecritures`, `remboursements`, `abandons_frais`, `mouvements_caisse`, `depots_cheques` | Journal opérationnel. |
| `justificatifs` | Pointeurs vers fichiers (les fichiers eux-mêmes vivent dans `justificatifs/`, gitignored). |
| `notes` | Notes libres avec `topic` (`asso`, `finances`, `comptes`, `outils`, `incidents`, `historique`…). C'est l'équivalent BDD des anciens `mon-groupe/*.md`. |
| `todos` | Liste de tâches du trésorier. |
| `user_credentials` | Tokens/cookies d'intégrations externes (Comptaweb, etc.), par user. |

Le schéma est SQL-standard et déjà multi-tenant (`group_id` partout, cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)), ce qui permet la migration mécanique vers la BDD webapp en P2.

## Structure markdown historique (avant ADR-013)

> Cette section est conservée pour mémoire seulement. La structure ci-dessous **n'existe plus dans le repo** : `mon-groupe/` a été retiré et migré en BDD.

```
mon-groupe/                  ← retiré du repo (ADR-013)
├── asso.md                  ← migré vers notes(topic='asso') + groupes
├── personnes.md             ← migré vers personnes
├── comptes.md               ← migré vers comptes_bancaires
├── budgets/                 ← migré vers budgets / budget_lignes
├── process-specifiques.md   ← migré vers notes(topic='asso')
├── historique/              ← migré vers notes(topic='historique')
└── inbox-notes.md           ← migré vers notes (sans topic)
```

## Conventions d'écriture

**Faits datés** (recommandé pour tout ce qui peut changer) :
```markdown
- Marie Dupont — trésorière adjointe [depuis 2026-01-15]
- Ancien compte Crédit Mutuel clôturé [2025-09-03]
```

**Faits structurés** (personnes, comptes) :
```markdown
## Marie Dupont
- Rôle : trésorière adjointe
- Depuis : 2026-01-15
- Email : marie.dupont@example.org
- Notes : responsable des camps été
```

**Décisions** (toujours datées, dans `historique/decisions.md`) :
```markdown
## 2026-03-12 — Vote du budget camp été
Décidé en réunion de bureau : budget 4500€, sortie des fonds depuis compte camp.
Raison : inflation sur l'hébergement vs 2025.
Présents : A, B, C. Absents : D.
```

## Mise à jour de la mémoire

L'agent doit pouvoir modifier la mémoire. Dans `CLAUDE.md`, on lui indique :

- Quand l'utilisateur confirme une info nouvelle ou corrige une existante → mettre à jour la table BDD adéquate via le MCP (`update_personne`, `update_note`, `update_compte_bancaire`, etc.) ou le fichier markdown si c'est du partageable.
- Quand une info devient obsolète (ex. ancien trésorier) → ne pas supprimer, mais **dater la fin de validité** (`update_personne` avec `jusqu_a` et `statut='ancien'`), sauf erreur de saisie.
- Avant toute modification, lire l'état courant (`list_personnes`, `list_notes`, etc.) pour éviter les doublons.
- Pour les fichiers markdown trackés en git (`sgdf-core/`, `doc/`) : commit après modification significative. Pour la BDD : pas de commit (les écritures sont persistées par le MCP).

## RGPD dans la mémoire

Les données personnelles vivent **exclusivement** en BDD (gitignored), jamais dans les fichiers markdown trackés. Règles :
- Aucune donnée nominative ou financière dans `sgdf-core/` ou `doc/`.
- Pas de données de mineurs sans nécessité (noms de jeunes scouts → éviter ou pseudonymiser, même en BDD).
- `.gitignore` strict sur `inbox/` (où atterrissent les pièces brutes), `data/`, `justificatifs/`.
- Le fichier `data/baloo.db` est traité comme un secret (en P1) ; en P2 la BDD passe côté webapp avec auth + chiffrement à arbitrer.

Voir [`security-rgpd.md`](security-rgpd.md) pour les détails.
