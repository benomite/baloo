# Index des ressources chefs-cadres SGDF

Source : <https://chefscadres.sgdf.fr/ressources/#/>
Date de capture : 2026-04-13
Méthode : appels directs à l'endpoint `/wp-admin/admin-ajax.php?action=ressourcesExploreContent&type=category&id=<id>` (la SPA utilise ce backend WordPress).

Ce dossier contient un fichier par catégorie principale du site chefs-cadres. Chaque fichier liste les ressources connues (titre + id de fichier SGDF). Les URL directes de téléchargement suivent le format `https://ressources.sgdf.fr/public/download/<id>` et la page de détail `https://chefscadres.sgdf.fr/ressources/#/explore/file/<id>/`.

## Catégories principales

| ID | Fichier | Thème | Ressources propres | Sous-catégories | Total sous-catégories |
|----|---------|-------|--------------------|------------------|-----------------------|
| 161 | 161-activites.md | Activités | 48 | 1 | 119 |
| 127 | 127-administratif-et-financier.md | Administratif et financier | 40 | 3 | 24 |
| 187 | 187-archives-et-documentation.md | Archives et documentation | 6 | 1 | 3 |
| 215 | 215-clameurs.md | Clameurs | 27 | 0 | 0 |
| 134 | 134-communication.md | Communication | 7 | 7 | 95 |
| 34  | 034-conversion-ecologique.md | Conversion écologique | 36 | 8 | 102 |
| 147 | 147-developpement-et-ouverture.md | Développement et ouverture | 27 | 5 | 50 |
| 118 | 118-engagement-benevole.md | Engagement bénévole | 2 | 9 | 173 |
| 124 | 124-gouvernance.md | Gouvernance | 6 | 5 | 119 |
| 17  | 017-international.md | International | 34 | 7 | 60 |
| 137 | 137-integrite-et-securite-des-adherents.md | Intégrité et sécurité des adhérents | 8 | 5 | 100 |
| 209 | 209-patrimoine.md | Patrimoine | 3 | 0 | 0 |
| 142 | 142-pedagogie-et-educatif.md | Pédagogie et éducatif | 26 | 13 | 706 |
| 106 | 106-vie-spirituelle.md | Vie spirituelle | 0 | 12 | 135 |

**Total** : 14 catégories principales, 76 sous-catégories, **1916 ressources uniques (comptées)**.

## Notes sur la structure

- Le site chefs-cadres est une Single Page Application Vue.js adossée à un backend WordPress. L'endpoint `admin-ajax.php` (action `ressourcesExploreContent`) renvoie du HTML pré-rendu contenant les `ressources_search_result`.
- Les ressources sont principalement des PDF téléchargeables via `ressources.sgdf.fr/public/download/<id>`.
- Une ressource peut être présente dans plusieurs catégories (les compteurs ne se somment pas avec l'ensemble unique).
- Certaines catégories annoncent un compteur différent du nombre d'items retournés par l'API (ex. catégorie 17 annoncée à 34, renvoie 34 ; Patrimoine 209 annoncé 3, renvoie 3 — cohérent ici).
- La catégorie `106 Vie Spirituelle` est vide à la racine mais ses sous-catégories contiennent 135 ressources.

## Ressources critiques pour un trésorier de groupe

À prioriser en lecture (voir fichier `127-administratif-et-financier.md` et `137-integrite-et-securite-des-adherents.md`) :
1. Charte financière du groupe
2. Modèle fichier budget + Fiche réflexe budget
3. Calendrier des flux financiers
4. Permanence comptaweb : guide pratique
5. Modèle note de frais + Formulaire abandon de frais
6. Guide helloasso
7. Assurances (dans 195)

## Mise à jour

Pour recapturer :

```
for id in <liste ids>; do
  curl -s -X POST https://chefscadres.sgdf.fr/wp-admin/admin-ajax.php \
    -d "action=ressourcesExploreContent&type=category&id=$id"
done
```

(Le script bash nécessite un accès réseau ; depuis un agent sandboxé, passer par le navigateur via `fetch` depuis le domaine chefscadres.sgdf.fr.)
