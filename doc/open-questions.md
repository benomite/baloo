# Questions ouvertes

Questions structurelles non tranchées. Chacune a un contexte, des options, et éventuellement un déclencheur pour la décision. Elles ne sont **pas** à trancher tant que le déclencheur ne s'est pas produit — c'est le garde-fou contre les décisions prématurées.

Quand une question est tranchée, on écrit un ADR dans [`decisions.md`](decisions.md) et on supprime l'entrée d'ici. Les questions résolues sans ADR (résolues par la trajectoire de la roadmap, par exemple) sont déplacées en bas du document avec une note de résolution.

---

*Aucune question structurelle ouverte au 2026-04-25.*

---

## Questions résolues sans ADR

### OQ-001 — Rester sur Airtable ou construire un outil perso ?

**Statut** : résolu — 2026-04-25
**Ouvert le** : 2026-04-13

**Résolution** : tranché par la trajectoire produit, sans ADR dédié. La construction d'un outil perso a été menée via [ADR-007](decisions.md#adr-007--outil-compta-unifié--compta-web-reste-maître-baloo-devient-lamont) (Baloo remplace Airtable + Sheet en amont de Compta-Web), [ADR-010](decisions.md#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript) (SQLite + MCP comme outil opérationnel) et [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git) (schéma multi-user/multi-tenant prêt pour ouverture aux autres rôles). La phase 2 ([`roadmap.md`](roadmap.md)) acte que cette base bascule vers une **webapp comme source de vérité**, ce qui répond directement au pain point initial (impossibilité de partager la base Airtable sans plan payant) en donnant à chaque rôle (chef d'unité, parent) un accès propre.

Airtable reste utilisé en lecture seule pour les **données historiques** pendant la transition.
