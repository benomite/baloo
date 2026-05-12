# Contribuer à Baloo

Merci de l'intérêt porté au projet. Baloo est un outil mené par un bénévole pour les bénévoles, avec une feuille de route resserrée. Quelques règles pour qu'une contribution ait toutes ses chances d'aboutir.

## Avant d'ouvrir une PR

**Ouvre une issue d'abord.** Le projet a une [roadmap](doc/roadmap.md) et des [ADRs](doc/decisions.md) qui guident les choix. Une PR qui sort de ce cadre sans discussion préalable a peu de chances d'être mergée. Pour un bug ou une amélioration mineure, une issue suffit. Pour une fonctionnalité, on discute le besoin avant le code.

## Setup dev

Prérequis : **Node 20+**, **pnpm 10**.

```bash
git clone https://github.com/benomite/baloo.git
cd baloo/web
pnpm install
cp .env.example .env.local
pnpm bootstrap         # crée la BDD + un groupe démo
pnpm dev               # http://localhost:3000
```

Variables d'env minimales : `AUTH_SECRET`, `TURSO_DATABASE_URL` (ou rien = SQLite local), `RESEND_API_KEY` (ou rien = magic link en console).

## Standards de code

- **TypeScript strict.** `pnpm exec tsc --noEmit` doit passer.
- **Lint.** `pnpm lint`.
- **Tests.** `pnpm test`. Pour toute logique métier non triviale (transitions de workflow, import CSV…), un test Vitest est demandé.
- **Pas de `any`** sans commentaire `// eslint-disable-next-line` justifié.

## Convention de commit

Format inspiré de Conventional Commits :

```
type(scope): description courte

Corps optionnel.
```

Types : `feat`, `fix`, `refactor`, `docs`, `chore`, `test`. Scope = aire fonctionnelle (`remboursements`, `caisse`, `comptaweb`…). Voir l'historique pour des exemples.

## Préservation des données

Le projet manipule de la donnée user enrichie en continu (justifs, notes, liens). **Règle absolue** : pas de `DELETE` sur les tables métier, toujours UPSERT. Détail dans [`CLAUDE.md`](CLAUDE.md) section « Préservation des données ».

## Données sensibles

Le projet manipule des données financières et des données de mineurs. **Aucune** donnée nominative n'est versionnée :

- Pas de seed avec de vrais noms.
- Pas de capture écran avec des montants ou noms réels (les anonymiser).
- Le pre-commit hook bloque les fichiers dans `data/`, `inbox/`, `justificatifs/`, `mon-groupe/`. Active-le avec `git config core.hooksPath scripts/git-hooks`.

## Architecture decisions

Tout changement structurel (nouveau modèle BDD, nouveau service externe, modification d'auth) demande un **ADR** dans [`doc/decisions.md`](doc/decisions.md). Voir les ADRs existants comme modèle (court, motivé, daté).

## Comment lancer Claude Code dans le repo

Le repo est conçu pour être utilisé avec [Claude Code](https://claude.com/claude-code) (les fichiers `CLAUDE.md`, `AGENTS.md`, `.mcp.json` le configurent). C'est facultatif pour contribuer, mais ça aide. Lance simplement `claude` depuis la racine.

## Questions ?

Ouvre une issue avec le template « Question ». Pas de réponse garantie en 24h — c'est du bénévolat.
