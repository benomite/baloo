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

1. **Aucun secret dans git.** Tokens MCP, clés d'API, RIBs, mots de passe → `.env`, BDD locale (`user_credentials`) ou keychain, jamais dans les fichiers trackés.
2. **`.gitignore` strict.** `inbox/`, `data/`, `justificatifs/`, `*.pdf`, `*.xlsx`, `.env*` par défaut. Les données spécifiques au groupe vivent en BDD (`data/baloo.db` aujourd'hui), jamais dans des fichiers markdown trackés (cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)).
3. **Repo open-source-ready.** Le repo ne doit contenir **aucune** donnée nominative ou financière, ni au présent ni dans l'historique (squash prévu avant publication github, cf. ADR-013).
4. **Minimiser les données de mineurs.** Si un process n'a pas besoin du nom d'un jeune, on utilise un identifiant anonyme ou un prénom seul. Jamais de nom + adresse + date de naissance dans le même endroit sans nécessité.
5. **Éviter d'envoyer l'inutile à l'API Anthropic.** Claude Code charge ce que l'utilisateur lui demande. Ne pas prendre l'habitude de "tout coller dans le contexte" — utiliser les outils de lecture ciblée du MCP (`recherche`, `list_*`).

## Considérations spécifiques Anthropic / Claude Code

- Claude Code avec un abo Max passe par l'API Anthropic → les contenus lus/écrits transitent par leurs serveurs.
- **Anthropic ne s'entraîne pas sur les données API par défaut** (à revérifier dans les CGU courantes, voir [`references.md`](references.md)).
- Les serveurs Anthropic sont principalement US → à mentionner dans la politique de traitement si on atteint la phase SaaS.

**Conséquence pratique au MVP** : pas de blocage, mais on évite de charger par principe l'intégralité de la base membres dans chaque conversation. On préfère des lectures ciblées.

## Règles supplémentaires à partir de la phase 2 (webapp ouverte)

Dès qu'un autre user que le trésorier accède à l'outil (chef d'unité, parent), on entre dans un cadre RGPD plus exigeant :

- **Auth réelle** (pas de "user implicite") : chaque accès est traçable.
- **Hébergement EU** (Hetzner, Scaleway, OVH) pour la BDD webapp et les justificatifs.
- **Chiffrement au repos** des données membres et des `user_credentials`.
- **Logs d'accès** : qui a lu/écrit quoi, quand. Audit trail minimal.
- **Procédure d'export et de suppression** (droit à l'effacement) — au moins documentée et exécutable manuellement.
- **Information des users** : à minima un texte clair dans l'UI sur les données traitées et leur finalité.

## Règles supplémentaires à partir de la phase 4 (SaaS multi-groupes facturé)

En plus de tout ce qui précède :

- **Contrat de sous-traitance RGPD** avec chaque groupe utilisateur (on traite les données pour leur compte).
- **DPO identifié** (peut être externe / mutualisé).
- **Registre des traitements**.
- **CGU et politique de confidentialité** publiées.
- **Assurance RC pro** si on devient responsable de données financières.

## Données WhatsApp — point d'attention

Lire les messages de groupes WhatsApp de l'asso soulève plusieurs questions :

- **Consentement** : les membres doivent savoir qu'un assistant IA a accès au groupe.
- **TOS Meta** : `whatsapp-web.js` et équivalents sont contre les conditions d'utilisation de WhatsApp. L'API WhatsApp Business est l'option propre, mais elle est pensée pour du "business → client", pas pour lire des groupes communautaires.
- **RGPD** : archiver et traiter des conversations de groupe sans consentement explicite = infraction claire.

**Conclusion au MVP** : WhatsApp est hors scope tant que le cadre n'est pas clarifié avec le bureau de l'asso. À traiter en phase 2 ou plus tard, pas dans le code initial.

## Chiffrement local (optionnel, à évaluer)

Si le laptop est partagé ou souvent nomade, envisager :
- Chiffrement du disque (FileVault sur Mac — souvent déjà activé).
- Chiffrement applicatif des `user_credentials` en BDD (à trancher dans un ADR dédié quand on attaque la P2, cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git)).

Le fichier `data/baloo.db` est gitignored et doit être traité comme un secret tant qu'on est en P1.
