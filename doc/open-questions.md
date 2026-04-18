# Questions ouvertes

Questions structurelles non tranchées. Chacune a un contexte, des options, et éventuellement un déclencheur pour la décision. Elles ne sont **pas** à trancher tant que le déclencheur ne s'est pas produit — c'est le garde-fou contre les décisions prématurées.

Quand une question est tranchée, on écrit un ADR dans [`decisions.md`](decisions.md) et on supprime l'entrée d'ici.

---

## OQ-001 — Rester sur Airtable ou construire un outil perso ?

**Statut** : ouvert
**Ouvert le** : 2026-04-13

### Contexte

Airtable est actuellement utilisé pour plusieurs flux opérationnels : suivi des abandons/remboursements de frais, caisse physique, dépôts de chèques (banque + ANCV), quelques documents. L'état détaillé par groupe vit en BDD (`list_notes(topic='outils')`), la config générique dans [`integrations.md`](integrations.md).

Le pain point principal est **l'impossibilité de partager la base** sans passer à un plan payant, jugé trop cher pour une asso. Conséquence : aucun autre membre du bureau ne peut consulter ou alimenter le suivi — tout repose sur le trésorier seul.

Une tentative de migration de la "compta générale" vers Airtable a été abandonnée en cours de saison pour éviter de changer d'outil en milieu d'exercice, l'utilisateur est revenu sur le Google Sheets historique.

### Options envisagées

1. **Rester sur Airtable en l'état**, solo, et vivre avec la limite de non-partage.
2. **Migrer vers un outil déjà partageable gratuitement** (Google Sheets, NocoDB self-hosted, Baserow, Notion databases).
3. **Construire un outil perso**, probablement intégré à Baloo — exemples : fichiers structurés dans `mon-groupe/` (markdown ou JSON/YAML) lus et mis à jour par l'agent, interface éventuelle plus tard côté phase 3.

### Critères de décision

- **Partage** : possible pour le bureau sans coût.
- **Pérennité** : pas de dépendance à un outil qui peut devenir payant ou disparaître.
- **Lisibilité sans l'agent** : un humain doit pouvoir lire les données sans passer par Baloo.
- **Compatibilité Comptaweb** : ne pas dupliquer ce qui est déjà dans Comptaweb (source de vérité comptable).
- **Coût de migration** : il y a déjà plusieurs mois de données dans Airtable à récupérer proprement.

### Déclencheur de décision

- Quand l'utilisateur a besoin qu'un autre membre du bureau consulte ou alimente un suivi actuellement dans Airtable.
- **OU** quand Baloo a été utilisé suffisamment longtemps en mode MVP pour que l'utilisateur sache ce qu'il veut vraiment ranger où.

### À ne pas faire avant de trancher

- Ne pas migrer précipitamment — changer d'outil en cours d'année est précisément ce que l'utilisateur a voulu éviter une première fois.
- Ne pas concevoir un "outil perso" sans avoir d'abord observé l'usage réel de Baloo pendant quelques semaines.

---

*Ajouter ici toute nouvelle question structurelle non tranchée, avec un numéro OQ-00X incrémental.*
