# Intégrations externes (MCPs)

Ce document décrit comment configurer les intégrations externes utilisées par Baloo (Airtable, Google Workspace, Notion). Il est **générique** : aucune information propre à un groupe ou à un user n'apparaît ici — les credentials et l'état spécifique au trésorier vivent dans `.env` (gitignored) et dans la mémoire BDD (notes topic='outils'), cf. [ADR-013](decisions.md).

---

## Pattern général

Les intégrations se font via **serveurs MCP** déclarés dans `.mcp.json` au scope projet. Les secrets (PAT, client IDs, tokens OAuth) sont référencés par expansion de variable d'environnement lue depuis `.env` (gitignored). Le fichier `.mcp.json` est commité, il ne contient **jamais** de valeur en clair.

Pour que Claude Code trouve automatiquement les variables, on utilise [direnv](https://direnv.net) avec un `.envrc` contenant juste `dotenv` (charge `.env` à l'entrée du dossier). Setup une fois :

```bash
brew install direnv
# ajouter à ~/.zshrc : eval "$(direnv hook zsh)"
source ~/.zshrc
cd baloo && direnv allow
```

---

## Airtable (MCP officiel)

Utilisé comme système de suivi historique (pain point : pas de partage gratuit).

**MCP** : `https://mcp.airtable.com/mcp` (transport HTTP).

**Bloc `.mcp.json`** :

```json
"airtable": {
  "type": "http",
  "url": "https://mcp.airtable.com/mcp",
  "headers": {
    "Authorization": "Bearer ${AIRTABLE_PAT}"
  }
}
```

**PAT (Personal Access Token)** : créé dans Airtable Builder Hub → Personal access tokens.

**Scopes recommandés au MVP (lecture seule)** :
- `data.records:read`
- `schema.bases:read`

L'écriture (`data.records:write`, `schema.bases:write`) est activée **uniquement** si un skill concret en a besoin, après validation explicite.

**Bases autorisées par le PAT** : **uniquement** la base compta du groupe courant. Ne jamais autoriser d'autres bases personnelles.

**Outils MCP exposés** :
- `list_bases`, `search_bases` — trouver les bases
- `list_tables_for_base` — lister les tables d'une base
- `get_table_schema` — détail des champs
- `list_records_for_table` — lire les enregistrements (avec filtres)

**Rotation / révocation du PAT** :
1. Airtable Builder Hub → Personal access tokens → révoquer l'ancien.
2. Générer un nouveau PAT avec les mêmes scopes et la même base autorisée.
3. Mettre à jour `AIRTABLE_PAT` dans `.env`, relancer Claude Code.

---

## Google Workspace (MCP communautaire)

**MCP utilisé** : [`taylorwilsdon/google_workspace_mcp`](https://github.com/taylorwilsdon/google_workspace_mcp) — MCP communautaire unifié qui couvre Gmail, Drive, Calendar, Docs, Sheets, Slides, Tasks. Choix motivé par :

1. Un seul flow OAuth pour tous les services Google.
2. Flag `--read-only` imposé côté serveur (la lecture seule vient du MCP, pas d'une règle interne Baloo).
3. Flag `--tools` pour limiter la surface (au MVP : `gmail drive sheets`).
4. Extensible à Calendar/Docs sans nouvelle config OAuth.

Pas de MCP officiel Google à ce jour.

**Prérequis côté Google Cloud** (une fois) :

1. [Google Cloud Console](https://console.cloud.google.com/) → se connecter avec le compte de l'asso.
2. Créer un projet (ex. `baloo-workspace`).
3. *APIs & Services → Library* : activer **Gmail API**, **Drive API**, **Sheets API** (et Calendar, Docs plus tard si besoin).
4. *OAuth consent screen* :
   - Type : **External** (obligatoire pour un Gmail classique sans Workspace).
   - Publishing status : laisser en **Testing**.
   - Test users : ajouter l'email de l'asso.
5. *APIs & Services → Credentials* : créer un **OAuth client ID** de type "Desktop app".
6. Noter le Client ID et le Client Secret. **Ne jamais les commiter.**

**Prérequis système** : [`uv`](https://github.com/astral-sh/uv) (`brew install uv` sur macOS). `uvx` lance le MCP sans installation globale.

**Variables d'environnement** (dans `.env` gitignored) :

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

**Bloc `.mcp.json`** :

```json
"workspace": {
  "type": "stdio",
  "command": "uvx",
  "args": ["workspace-mcp", "--tools", "gmail", "drive", "sheets", "--read-only"],
  "env": {
    "GOOGLE_OAUTH_CLIENT_ID": "${GOOGLE_OAUTH_CLIENT_ID}",
    "GOOGLE_OAUTH_CLIENT_SECRET": "${GOOGLE_OAUTH_CLIENT_SECRET}"
  }
}
```

**Premier lancement / authentification OAuth** : l'auth Google n'est déclenchée qu'au premier **appel réel** d'un outil Gmail/Drive/Sheets, pas au démarrage. Le navigateur s'ouvre → choisir le compte, accepter les scopes. Les credentials sont mis en cache localement (par défaut dans `~/.config/workspace-mcp/` ou équivalent).

**Règle MVP : lecture seule partout** grâce à `--read-only`. Concrètement :
- Gmail : lecture, recherche, téléchargement d'attachements ✅. Envoi/brouillon/suppression ❌.
- Drive : lecture, recherche ✅. Écriture/partage/suppression ❌.
- Sheets : lecture ✅. Modification ❌.

**Pièces jointes téléchargées** : toujours dans `inbox/` (gitignored), jamais ailleurs.

**Révocation** : compte Google → *Sécurité → Tiers avec accès au compte* → supprimer l'application.

---

## Notion (non accessible en MCP, contrainte d'accès)

Le MCP Notion officiel suppose une authentification OAuth sur un compte **membre** du workspace. Si le trésorier n'est qu'un **invité** du workspace Notion, le MCP ne peut pas être utilisé.

**Alternatives** (à évaluer si besoin concret) :
1. Demander à un administrateur du workspace un accès membre ou une invitation plus étendue.
2. Copier-coller les informations utiles dans la mémoire Baloo au fil du temps.
3. Exports Notion ponctuels dans `inbox/` pour lecture ponctuelle.

---

## Principe de mémoire

L'**état spécifique au groupe** (adresse mail, base Airtable utilisée, tables en service, incidents) ne vit **pas** dans ce document. Il est stocké en BDD dans des notes `topic='outils'` accessibles via `list_notes`.

Ce document ne parle que du **comment** (installation, scopes, configuration). Le **quoi** (quelles bases, quels comptes, quel état) est dans la mémoire utilisateur.
