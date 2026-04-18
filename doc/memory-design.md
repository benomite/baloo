# Conception de la mémoire

> **Note 2026-04-18** : [ADR-013](decisions.md) réoriente la mémoire vers un modèle BDD pour tout ce qui est spécifique à un user ou à un groupe (données nominatives, compta, todo, notes). Ce document décrit la structure markdown historique — il sera refondu au fil des migrations `mon-groupe/*.md` → tables SQLite. Les principes d'écriture (faits atomiques, dates ISO, mise à jour plutôt que suppression) restent valables et s'appliquent aussi aux entrées BDD.

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
Ce qui est vrai **maintenant** dans l'asso : bureau en place, comptes ouverts, budgets votés, échéances à venir. Stocké dans `mon-groupe/` en markdown structuré.

### Long terme — le savoir
Ce qui est stable ou historique : process compta, glossaire SGDF, décisions passées, historique des trésoriers. Stocké dans `mon-groupe/historique/` et `sgdf-core/`.

Pas de vector store au MVP : Claude Code peut parcourir quelques dizaines de fichiers markdown sans problème. On ajoutera pgvector en phase 3 quand le volume grandira.

## Structure des fichiers mémoire

```
sgdf-core/
├── glossaire.md             ← jargon SGDF (camp, camp scout, maîtrise, ISTC, etc.)
├── compta-process.md        ← process compta génériques SGDF
├── structure-groupe.md      ← organigramme type d'un groupe
└── outils-officiels.md      ← Compta-Web, Intranet SGDF, etc.

mon-groupe/
├── asso.md                  ← identité, mission, historique court
├── personnes.md             ← bureau + membres clés, rôles, contacts
├── comptes.md               ← comptes bancaires, livrets, structure
├── budgets/
│   ├── 2026.md              ← budget voté pour l'année courante
│   └── archive/             ← années passées
├── process-specifiques.md   ← nos particularités vs le core SGDF
├── historique/
│   ├── decisions.md         ← journal daté des décisions du bureau
│   └── incidents.md         ← événements marquants (contrôle fiscal, sinistre…)
└── inbox-notes.md           ← notes brutes, à trier
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

- Quand l'utilisateur confirme une info nouvelle ou corrige une existante → mettre à jour le fichier adéquat.
- Quand une info devient obsolète (ex. ancien trésorier) → ne pas supprimer, mais **dater la fin de validité** (sauf erreur de saisie).
- Avant toute modification, lire le fichier cible pour éviter les doublons.
- Toujours commit git après modification significative.

## RGPD dans la mémoire

Les fichiers de `mon-groupe/` contiennent des données personnelles. Règles :
- Jamais commitées dans un repo public.
- Pas de données de mineurs sans nécessité (noms de jeunes scouts → éviter ou pseudonymiser).
- `.gitignore` strict sur `inbox/` (où atterrissent les pièces brutes).
- Chiffrement du dossier si le laptop est partagé (git-crypt ou équivalent, à évaluer).

Voir [`security-rgpd.md`](security-rgpd.md) pour les détails.
