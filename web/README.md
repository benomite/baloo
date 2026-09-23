This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Exports

Trois commandes `pnpm`, lancées en local (`tsx`, accès direct à la base via `getCliContext()`) — pas de bouton dans la webapp. Détails et justification dans [ADR-040](../doc/decisions.md#adr-040--export-darchive--deux-artefacts-script-local-caviardage-par-défaut) et la spec [`2026-09-21-export-archive-exercice-design.md`](../doc/superpowers/specs/2026-09-21-export-archive-exercice-design.md).

| Commande | Produit | Destination | Contenu sensible |
|---|---|---|---|
| `pnpm export:controles [exercice]` | un rapport texte des incohérences (justifs manquants, remboursements aboutis non signés, dépôts orphelins, écarts de miroir Comptaweb…) | la sortie du terminal | — |
| `pnpm export:dump [dossier]` | toutes les tables du groupe (`tables/*.jsonl`) + tous les fichiers (`blobs/`) + un manifest | le disque du trésorier, pour sa sauvegarde privée | **conservé** : RIB, IBAN/BIC, tokens d'accès direct aux remboursements |
| `pnpm export:exercice <exercice> [dossier]` | un dossier lisible d'un exercice (écritures, remboursements, abandons, caisse, référentiels, mémoire, `index.html` navigable) | le Drive du groupe | **caviardé** : ni RIB, ni IBAN/BIC, ni tokens |

**La règle qui sépare les deux artefacts** : le dump est un filet de sécurité **privé**, fidèle à la base au centime et au token près — il ne doit jamais quitter le disque du trésorier. L'archive d'exercice est **partageable** — elle est caviardée à la source, sans option pour désactiver le caviardage. Ne pas confondre les deux ferait circuler des coordonnées bancaires ou des liens d'accès direct à des remboursements en production.

`pnpm export:controles` est utile **avant** de déclarer un exercice clos : il dit ce qui manque (justificatif, signature, rapprochement) tant qu'il est encore temps de le corriger, et son rapport est repris en tête du `README.md` du dossier d'exercice.
