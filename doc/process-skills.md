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
2. Extraire le montant du justificatif si c'est une image/PDF.
3. Vérifier que le montant est cohérent avec le budget ouvert.
4. Créer une entrée dans Airtable "Remboursements".
5. Générer un brouillon de mail au trésorier avec le justificatif en pièce jointe.
6. Mettre à jour `mon-groupe/historique/remboursements.md`.
7. Confirmer à l'utilisateur ce qui a été fait et ce qu'il reste à faire manuellement.

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

## Skills "core SGDF" vs skills "mon groupe"

Même logique que pour la mémoire :

```
sgdf-core/
└── skills/
    ├── remboursement/        ← générique, adaptable
    └── cloture-camp/

mon-groupe/
└── skills/
    └── rapprochement-cic/    ← spécifique à notre banque
```

Un skill de `mon-groupe/` peut **hériter ou surcharger** un skill de `sgdf-core/` en y référençant le process générique puis en ajoutant les spécificités.

## Évolution vers les phases suivantes

- **Phase 1 (MVP)** : skills markdown, déclenchés manuellement depuis Claude Code.
- **Phase 2** : mêmes skills, testés par d'autres utilisateurs, raffinés.
- **Phase 3** : skills chargés par le backend Agent SDK, exposés comme "actions" dans la webapp ou commandes du bot.
- **Phase 4** : skills comme feature commerciale — "Baloo automatise 15 process compta SGDF".

**Le format ne change pas entre les phases.** C'est ça, l'intérêt principal du choix.
