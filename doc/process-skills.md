# Process métier et skills

Les "process" de l'asso (remboursement d'un chef, adhésion d'un jeune, clôture d'un camp, déclaration d'un sinistre, etc.) sont formalisés comme **skills** exécutables par Claude Code.

## Qu'est-ce qu'un skill

Un skill est un dossier contenant un fichier `SKILL.md` qui décrit à l'agent **comment exécuter un process précis**, étape par étape, avec les questions à poser, les fichiers à produire, les outils à utiliser.

Au MVP, on ne code rien : un skill = un markdown. L'utilisateur le déclenche en demandant à Claude Code "lance le process remboursement" ou équivalent.

## Pourquoi c'est le bon format

1. **Portable** : un skill marche en local (Claude Code) et plus tard côté backend (Agent SDK) sans modification.
2. **Lisible** : n'importe quel bénévole peut relire et amender un skill markdown. Pas de code caché.
3. **Versionnable** : les skills évoluent au fil du temps, git garde l'historique.
4. **Distribuable** : les skills génériques peuvent vivre dans `sgdf-core/skills/` et être partagés avec d'autres groupes.

## Structure type d'un skill

```markdown
# Skill : remboursement

## Quand l'utiliser
Quand un chef, un membre du bureau ou un parent a avancé des frais
pour l'asso et attend un remboursement.

## Informations nécessaires
- Qui avance (nom)
- Montant
- Date de la dépense
- Nature (camp, matériel, transport…)
- Justificatif (ticket, facture)
- Compte de destination (RIB)

## Étapes

1. Demander à l'utilisateur les infos manquantes.
2. Extraire le montant du justificatif si c'est une image/PDF (déposé dans `inbox/`).
3. Vérifier que le montant est cohérent avec le budget ouvert (`list_budget_lignes`).
4. Créer le remboursement via le MCP (`create_remboursement`) et attacher le justificatif (`attach_justificatif`).
5. Confirmer à l'utilisateur ce qui a été fait et ce qu'il reste à faire manuellement (saisie Comptaweb, relance RIB, etc.).

## Pièges connus
- Les tickets restaurants sont parfois ambigus sur le montant TTC.
- Certains chefs oublient le RIB : prévoir une relance standardisée.
```

## Skills candidats au MVP

À prioriser en fonction de ce que l'auteur fait vraiment le plus souvent. Premiers candidats probables :

- `remboursement` — traiter une demande de remboursement.
- `adhesion` — enregistrer une nouvelle adhésion.
- `cloture-camp` — checklist de clôture comptable d'un camp.
- `rapprochement-bancaire` — assistance au rapprochement mensuel.
- `relance-cotisation` — identifier et relancer les cotisations impayées.

**À valider en Phase 1** lors de l'implémentation, en fonction des besoins réels.

## Skills "core SGDF" vs skills "spécifiques au groupe"

Même logique que pour la mémoire (cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)) : les skills génériques vivent dans `sgdf-core/skills/` (partageables, public-ready) ; les skills spécifiques à un groupe vivent dans `skills/` à la racine (gitignored si jamais ils contenaient des références sensibles).

```
sgdf-core/
└── skills/
    ├── remboursement/        ← générique, adaptable
    └── cloture-camp/

skills/
└── rapprochement-cic/        ← spécifique à notre banque (vide pour l'instant)
```

Un skill de `skills/` peut **hériter ou surcharger** un skill de `sgdf-core/skills/` en y référençant le process générique puis en ajoutant les spécificités. Aucune donnée nominative ou financière dans le contenu d'un skill — les références concrètes vivent en BDD.

## Évolution vers les phases suivantes

- **Phase 1 (MVP CLI)** : skills markdown, déclenchés manuellement depuis Claude Code, opérations via le MCP `baloo-compta`.
- **Phase 2 (ouverture intra-groupe)** : mêmes skills côté Claude Code, mais le MCP devient client HTTP de la webapp (cf. [`roadmap.md`](roadmap.md)). Certains skills peuvent gagner un équivalent "action" déclenchable depuis l'UI webapp pour les chefs/parents (ex. dépôt de justif). Le markdown reste la spec ; l'impl tape l'API.
- **Phase 3 (multi-groupes)** : les skills `sgdf-core/` deviennent un actif partagé entre groupes ; chaque groupe peut surcharger via ses propres skills si besoin.
- **Phase 4 (SaaS)** : skills comme feature commerciale — "Baloo automatise N process compta SGDF".

**Le format ne change pas entre les phases.** C'est ça, l'intérêt principal du choix.
