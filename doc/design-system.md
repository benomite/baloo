# Design system Baloo — "Carnet du trésorier"

Direction visuelle de l'app web (`web/`), arrêtée fin avril 2026 après une refonte structurelle (cf. branche `feat/ui-tables-readability`).

L'idée : **outil pro avec matière éditoriale**, pas SaaS B2B générique, pas
Comic Sans non plus. Inspirations assumées : Pennylane (rigueur compta),
Linear (densité maîtrisée), Stripe Dashboard (typo et hiérarchie),
Notion (humanité subtile).

---

## Trois principes

1. **La typo fait le caractère, pas la couleur.** Une grotesque française
   expressive (Bricolage Grotesque) sur les titres courts, Geist
   sans-serif partout ailleurs. La couleur reste sobre.
2. **Fond crème + cards blanches** crée une matière "papier de carnet"
   sans skeuomorphisme. La hiérarchie vient de la surface, pas des
   bordures lourdes.
3. **Couleur = sémantique uniquement.** Bleu marine SGDF = action
   globale et navigation. Couleurs d'unités = imputation seulement
   (rail + pastille). Vert/rouge = signe financier. Rien d'autre n'a
   le droit d'être coloré.

---

## Typographie

| Police | Usage | Origine |
|---|---|---|
| **Bricolage Grotesque** (`font-display`) | Page titles courts (≤ 48 chars, pas en CAPS), KPI displays, wordmark sidebar | next/font/google, variable, axe opsz |
| **Geist** (`font-sans`) | Body, formulaires, status, tableaux, **page titles longs ou techniques** (libellés bancaires bruts) | next/font/google |
| **Geist Mono** (`font-mono`) | IDs (`ECR-2026-208`), codes (`PBWD76QHY`), montants en édition | next/font/google |

Le `<PageHeader>` (cf. `components/layout/page-header.tsx`) **bascule
automatiquement** vers Geist quand un titre est trop long ou contient
≥ 5 lettres consécutives en CAPS. Cette heuristique évite les libellés
bancaires bruts en serif (illisibles).

Classes typo composables dans `globals.css` :

- `.text-display-xl` / `.text-display` / `.text-display-sm` — Bricolage, h1
- `.text-h1-sans` / `.text-h2` / `.text-h3` — Geist, h1 long, h2, h3
- `.text-overline` — uppercase + `tracking-[0.14em]` muted xs
- `.text-caption` — info secondaire xs
- `.text-mono-data` — IDs / codes en `font-mono` `tabular-nums`

---

## Tokens couleurs (OKLch)

Définis dans `web/src/app/globals.css` puis exposés Tailwind via
`@theme inline`.

### Surfaces

| Token | Usage |
|---|---|
| `--bg` (alias `--background`) | Fond global crème (`oklch(0.985 0.005 85)`) |
| `--bg-elevated` (alias `--card`) | Cards et popovers (blanc pur) |
| `--bg-sunken` | Sidebar, sections muted (crème déprimé) |

### Texte

| Token | Usage |
|---|---|
| `--fg` | Texte principal (ardoise foncée, pas noir pur) |
| `--fg-muted` | Texte secondaire (labels, méta) |
| `--fg-subtle` | Texte tertiaire (overlines, placeholders) |

### Bordures

| Token | Usage |
|---|---|
| `--border-soft` | Séparations à peine perceptibles |
| `--border` | Cards, inputs (par défaut) |
| `--border-strong` | Hover, états actifs |

### Brand SGDF

| Token | Usage |
|---|---|
| `--brand` | Bleu marine SGDF (`oklch(0.34 0.10 252)`, ~`#003366`). Plus foncé que le bleu officiel des Scouts-Guides (`#0082BE`) pour ne pas confondre l'accent global avec une couleur d'unité |
| `--brand-50` | Fond hover/active très doux |
| `--brand-100` | Fond surfaces accent |
| `--brand-foreground` | Texte sur fond brand |

### Couleurs d'unités SGDF

Préservées telles qu'en BDD (table `unites.couleur`).

| Code | Branche | Hex |
|---|---|---|
| FA | Farfadets | `#E8485F` |
| LJ | Louveteaux/Jeannettes | `#F39200` |
| SG | Scouts/Guides | `#0082BE` |
| PC | Pionniers/Caravelles | `#7D1C2F` |
| CO | Compagnons | `#00934D` |
| IM | Impeesas | `#9B4A97` |
| AJ | Ajustements | `#B0B0B0` |
| GR | Groupe | `#4A4A4A` |

**Règles d'usage des couleurs unités** :

- ✅ Rail vertical 2-3px à gauche des rows (lecture par unité au scroll)
- ✅ Pastille colorée dans les badges, dropdowns, légendes
- ✅ Surface tinted (~6% alpha) en complément du rail sur les rows "Par unité"
- ❌ Jamais en background plein
- ❌ Jamais comme couleur primary d'un bouton ou d'un état d'app
- ❌ Pas d'utilisation hors du contexte "imputation"

---

## Densité & espacement

```
Page padding         px-8 py-6  (lg: px-12 py-8)
Container max-width  max-w-6xl  (pages détail)
                     max-w-7xl  (listes wide)

Section gap          gap-6 / space-y-6
Card padding         p-6
Card padding tight   p-4
Field gap            gap-4 (vertical) / gap-3 (horizontal grid)
Inline gap           gap-2 / gap-1.5

Body text            text-[13.5px] / leading-relaxed
Small text           text-[12.5px]
Caption              text-[11px] uppercase tracking-[0.12em]

Input / Button h     h-10 (40px) — confortable, pas serré
Button sm            h-9 (36px)
Row height table     h-11 (44px)
```

---

## Composants primitives

Tous sous `web/src/components/`, classés par couche.

### `ui/` — primitives stylées (générique)

| Composant | Rôle |
|---|---|
| `Input` | Champ texte. h-10, focus brand, hover border-strong. |
| `Select` (shadcn / @base-ui) | Dropdown custom. Items hover en `bg-brand-50 text-brand`. |
| `Textarea` | Zone de texte multi-ligne. |
| `Button` | Variants `default` (brand), `outline`, `secondary`, `ghost`, `destructive`. |
| `Badge` | Pill outline générique (peu utilisé direct, préférer `StatusPill`). |
| `Alert` | Bandeau `info` / `success` / `warning` / `error` avec icône lucide. |
| `Table` | Tableau financier : `tabular-nums`, sticky thead, hover marqué. |
| `Card` | Wrapper card de base (Header / Title / Description / Content / Footer). |
| `Tabs` | Tabs @base-ui (peu utilisé — préférer `TabLink` underline). |
| `FileDrop` | Zone drag&drop pour upload de 1 fichier (preview inclus). |
| `SelectField` | Wrapper haut-niveau du `Select` avec API `options[]`. |
| `Sonner` (`Toaster`) | Toasts via la lib `sonner`. |

### `shared/` — composants métier réutilisables

| Composant | Rôle |
|---|---|
| `Amount` | Affichage des montants centimes. `tabular-nums`, `slashed-zero`, séparateur de milliers, NBSP avant `€`. Variantes `tone`: default / muted / negative / positive / signed. |
| `StatusPill` | Pill outline + bullet coloré (5 tones : neutral / pending / progress / success / danger). Wrappers `EcritureStatusBadge` et `RemboursementStatusBadge` mappent status → tone. |
| `UniteBadge` | Pastille colorée + code unité. |
| `StatCard` | KPI plate avec label uppercase, valeur display, sublabel optionnel. |
| `Field` / `DataField` | Couple label + input (form) ou label + value (read-only). Label uppercase XS muted. |
| `Section` / `SectionHeader` | Carte de section (h2 sans-serif + body) ou juste un en-tête de section sans card. |
| `Alert` (cf. `ui/`) | Cf. ci-dessus. |
| `EmptyState` | État vide chaleureux : emoji 4xl + titre + description + action optionnelle. |
| `TabLink` | Tab underline (style Linear / Stripe). |
| `InlineSelect` | Edit-in-place pour les cellules de tableau. |

### `layout/`

| Composant | Rôle |
|---|---|
| `Sidebar` | Navigation principale, sections regroupées (Comptabilité / Demandes / Atelier / Administration), wordmark écusson, "Mon espace" en footer. |
| `PageHeader` | Header de page : eyebrow (breadcrumb) / title (display ou sans-serif auto) / subtitle / meta (status+montant) / actions. |

---

## Conventions de typo dans les call-sites

| Élément | Police / classe |
|---|---|
| Sidebar wordmark "Baloo" | `font-display` |
| Page title court | bascule auto (`PageHeader`) |
| Page title long ou CAPS | bascule auto vers `font-sans` |
| Section h2 (`Identité`, `Imputation`) | `font-sans` semibold ; **jamais** `font-display` |
| Card title | `font-sans` semibold |
| KPI value (StatCard) | display tracking-tight |
| Body / forms / tableaux | `font-sans` |
| IDs / codes | `font-mono` tabular |

---

## Workflows futurs

Ce design system n'est pas figé. Les rounds suivants pourront ajouter :

- Tabs underline généralisés (`TabLink` est déjà créé, à propager)
- Toasts colorés Sonner alignés sur les variants Alert
- Hover row plus marqué sur les tableaux (déjà `bg-muted/70`)
- Composant `<Money>` pour les exports CSV/PDF (texte brut, pas JSX)
- Dark mode revisité (les tokens existent, mais peu testé en usage réel)

Les ajouts doivent respecter les **trois principes** énoncés en tête. Si
un nouveau composant est tenté de saturer en couleur ou d'introduire une
nouvelle police, c'est probablement un signe qu'on s'éloigne de la
direction.
