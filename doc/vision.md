# Vision

## Pourquoi

Tenir la compta et l'orga d'un groupe Scouts et Guides de France (SGDF) est chronophage, morcelé entre plusieurs outils (Compta-Web interne SGDF, Airtable, spreadsheets, Notion, Gmail, WhatsApp), et repose presque toujours sur un·e bénévole seul·e qui n'a ni le temps ni les outils d'un trésorier pro.

**Baloo** est un assistant personnel boosté par un LLM qui :
- garde en mémoire toutes les infos de l'asso (personnes, objectifs, process, historique) ;
- connaît les méthodologies pour garder l'orga au clair ;
- est accessible facilement (ordi d'abord, mobile ensuite) ;
- peut lire et (plus tard) écrire dans les outils de l'asso (Notion, Gmail, Airtable, Compta-Web, éventuellement WhatsApp) ;
- est capable d'exécuter des process métier (remboursement, adhésion, clôture de camp, etc.).

## Cap fonctionnel : un outil compta unifié, en amont de Compta-Web

À moyen terme, Baloo doit **remplacer Airtable + le Sheet `Compta Unités`** comme outil de suivi opérationnel de la compta du groupe (remboursements, dépenses par unité, justificatifs, écarts). Compta-Web reste **la source de vérité comptable** imposée par l'asso nationale et n'est jamais remplacé.

La trajectoire entre Baloo et Compta-Web va du plus simple au plus ambitieux :
1. **Aider** le trésorier à remplir Compta-Web correctement (checklists, données pré-formatées, vérification post-saisie).
2. **Faire la saisie à sa place** quand la confiance et la techno le permettent (API si elle existe, sinon automation navigateur).

Voir [`decisions.md`](decisions.md) ADR-007 pour le détail de la décision.

## Pour qui

**Court terme (MVP)** : l'auteur, trésorier d'un groupe SGDF, seul utilisateur.

**Moyen terme** : les autres membres du bureau du même groupe (co-consultation).

**Long terme (optionnel)** : les ~700 groupes SGDF de France, via une app ou un SaaS clé en main pour bénévoles non-techniques.

## Non-objectifs

- Remplacer Compta-Web (outil officiel SGDF imposé).
- Remplacer Notion comme source de vérité organisationnelle du groupe.
- Être un outil d'équipe temps-réel.
- Être un produit commercial à court terme.

## Principes directeurs

1. **Assistant d'abord, automatisation plus tard.** On commence en "read-mostly" (lire, répondre, préparer des brouillons). L'écriture automatique vient après la confiance.
2. **Pas d'infra inutile.** Le MVP tourne en local, sur un abo Claude Max existant, coût marginal 0€.
3. **La mémoire est le vrai actif.** Le code est remplaçable, le contenu (process, glossaire, historique) ne l'est pas.
4. **Séparation core / privé dès le jour 1.** Pour garder la porte ouverte à une distribution future sans devoir tout refactorer.
5. **RGPD pris au sérieux.** Données de membres (souvent mineurs) + données financières = pas de raccourcis.
