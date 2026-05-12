# Politique de sécurité

Baloo manipule des données financières et des données personnelles, dont parfois des données de mineurs. La sécurité est prise au sérieux.

## Signaler une faille

**Ne pas ouvrir d'issue publique pour un problème de sécurité.**

Préfère un signalement privé via [GitHub Security Advisories](https://github.com/benomite/baloo/security/advisories/new) ou un email à l'auteur (adresse sur le profil GitHub `@benomite`).

Inclure si possible :
- une description claire de la faille,
- les étapes pour la reproduire (proof of concept minimal),
- l'impact estimé (lecture, modification, accès à des données d'autres groupes…),
- ta proposition de correctif si tu en as une.

## Périmètre

Le projet considère comme **dans le périmètre** :

- L'instance hébergée publiquement [`baloo.benomite.com`](https://baloo.benomite.com) — toute faille permettant un accès non autorisé à des données.
- Le code de la webapp (`web/`) et du serveur MCP (`compta/`).
- Les scripts d'import (`web/scripts/`) si exposés à un input non maîtrisé.

**Hors périmètre** :
- Les dépendances tierces (signaler en amont).
- Les comportements documentés comme limites connues (cf. [`doc/security-rgpd.md`](doc/security-rgpd.md)).
- Les attaques sur l'auth qui supposent un accès physique à la machine du trésorier.

## Engagement

- Accusé de réception sous 7 jours ouvrés.
- Pas de délai garanti pour le correctif (projet bénévole), mais transparence sur le calendrier.
- Crédit dans le CHANGELOG si tu le souhaites, ou anonymat respecté si tu préfères.
- Pas de bug bounty (pas de revenus sur le projet).

## Versions supportées

Seule la branche `main` est maintenue. Pas de backports.

## Bonnes pratiques internes

Documentées dans [`doc/security-rgpd.md`](doc/security-rgpd.md). En résumé :

- Aucun secret en clair dans le repo (pre-commit hook actif).
- Aucune donnée user dans le repo (`data/`, `inbox/`, `justificatifs/`, `mon-groupe/` gitignored et bloqués au commit).
- Données minimales sur les mineurs.
- Justificatifs en blob privé avec URLs signées.
- Auth par magic link (pas de mot de passe stocké).
