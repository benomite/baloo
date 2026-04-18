# Sécurité et RGPD

Baloo manipule des données sensibles : membres d'une asso (dont potentiellement des mineurs), données financières, correspondance mail. Ce document liste les règles à respecter **dès le MVP**, même en usage solo.

## Catégories de données traitées

| Catégorie | Exemples | Sensibilité |
|---|---|---|
| Identité des membres adultes | Noms, emails, rôles, téléphones | Moyenne |
| Identité des mineurs | Noms de jeunes scouts, parents | **Haute** |
| Données financières | Comptes, transactions, budgets, RIB | Haute |
| Correspondance | Mails asso, messages WhatsApp | Haute |
| Pièces justificatives | Factures, tickets, reçus | Moyenne à haute |

## Règles dès le MVP

1. **Aucun secret dans git.** Tokens MCP, clés d'API, RIBs, mots de passe → `.env` ou keychain, jamais dans les fichiers trackés.
2. **`.gitignore` strict.** `inbox/`, `*.pdf`, `*.xlsx`, `.env*`, `mon-groupe/secrets/` par défaut.
3. **Repo privé.** Pas de push sur un remote public pour `mon-groupe/` tant que la séparation core/privé n'est pas 100% étanche.
4. **Minimiser les données de mineurs.** Si un process n'a pas besoin du nom d'un jeune, on utilise un identifiant anonyme ou un prénom seul. Jamais de nom + adresse + date de naissance dans le même endroit sans nécessité.
5. **Éviter d'envoyer l'inutile à l'API Anthropic.** Claude Code charge ce que l'utilisateur lui demande. Ne pas prendre l'habitude de "tout coller dans le contexte" — utiliser les outils de lecture ciblée.

## Considérations spécifiques Anthropic / Claude Code

- Claude Code avec un abo Max passe par l'API Anthropic → les contenus lus/écrits transitent par leurs serveurs.
- **Anthropic ne s'entraîne pas sur les données API par défaut** (à revérifier dans les CGU courantes, voir [`references.md`](references.md)).
- Les serveurs Anthropic sont principalement US → à mentionner dans la politique de traitement si on atteint la phase SaaS.

**Conséquence pratique au MVP** : pas de blocage, mais on évite de charger par principe l'intégralité de la base membres dans chaque conversation. On préfère des lectures ciblées.

## Règles supplémentaires à partir de la phase 3 (SaaS)

- Contrat de sous-traitance RGPD avec chaque groupe utilisateur.
- Hébergement EU (Hetzner, Scaleway, OVH) pour tout stockage de données perso.
- Chiffrement au repos des données membres.
- Logs d'accès (qui a lu quoi, quand).
- Procédure d'export et de suppression (droit à l'effacement).
- DPO identifié.
- Registre des traitements.

Aucune de ces mesures n'est nécessaire au MVP, mais elles sont à **prévoir dans l'archi phase 3** dès qu'on la dessine.

## Données WhatsApp — point d'attention

Lire les messages de groupes WhatsApp de l'asso soulève plusieurs questions :

- **Consentement** : les membres doivent savoir qu'un assistant IA a accès au groupe.
- **TOS Meta** : `whatsapp-web.js` et équivalents sont contre les conditions d'utilisation de WhatsApp. L'API WhatsApp Business est l'option propre, mais elle est pensée pour du "business → client", pas pour lire des groupes communautaires.
- **RGPD** : archiver et traiter des conversations de groupe sans consentement explicite = infraction claire.

**Conclusion au MVP** : WhatsApp est hors scope tant que le cadre n'est pas clarifié avec le bureau de l'asso. À traiter en phase 2 ou plus tard, pas dans le code initial.

## Chiffrement local (optionnel, à évaluer)

Si le laptop est partagé ou souvent nomade, envisager :
- Chiffrement du disque (FileVault sur Mac — souvent déjà activé).
- `git-crypt` ou `age` pour chiffrer `mon-groupe/` dans le repo.

Ce n'est pas bloquant pour démarrer, mais à trancher avant de commiter quoi que ce soit de vraiment sensible.
