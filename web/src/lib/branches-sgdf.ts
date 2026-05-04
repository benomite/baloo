// Helpers de mapping unité Comptaweb → catégorie SGDF + couleur officielle.
//
// Vocabulaire :
//   - **Unité** : 1 ligne du référentiel "branches/projets" Comptaweb,
//     correspond à un budget géré dans le groupe (Farfadets, Louveteaux,
//     Impeesas, Ajustements, etc.). Chaque unité a 1 catégorie SGDF.
//   - **Catégorie SGDF** : classification officielle de la branche d'âge
//     (Farfadets, LJ, SG, PC, CO, Groupe + leurs équivalents marins).
//     Détermine la couleur de la charte.
//
// Détection : on parse le label de l'unité Comptaweb (case insensitive)
// pour identifier la catégorie. Couvre les variantes d'écriture.
//
// Si aucun match, la catégorie reste NULL (à mapper manuellement plus tard).

export type CategorieCode =
  | 'FA' | 'MS'           // Farfadets / Moussaillons
  | 'LJ' | 'MO'           // Louveteaux-Jeannettes / Mousses
  | 'SG' | 'MA'           // Scouts-Guides / Marins
  | 'PC'                  // Pionniers-Caravelles
  | 'CO' | 'CM'           // Compagnons / Compagnons Marins
  | 'AU'                  // Audacieux
  | 'GR';                 // Groupe (englobe Impeesas, Ajustements, etc.)

export interface CategorieSGDFSpec {
  code: CategorieCode;
  nom: string;
  couleur: string;
}

interface CategorieRule {
  spec: CategorieSGDFSpec;
  patterns: RegExp[];
}

// Couleurs charte SGDF officielles par catégorie d'âge.
// Source : utilisateur (capture liste catégories Comptaweb 2026-05-04).
// Les branches marines partagent la couleur de leur équivalent terre.
const RULES: CategorieRule[] = [
  // === Branches terre + marines équivalentes ===
  {
    spec: { code: 'FA', nom: 'Farfadets', couleur: '#9DC30D' }, // vert clair
    patterns: [/farfadets?/i, /^fa$/i],
  },
  {
    spec: { code: 'MS', nom: 'Moussaillons', couleur: '#9DC30D' }, // vert clair (= Farfadets)
    patterns: [/moussaillons?/i, /^ms$/i],
  },
  {
    spec: { code: 'LJ', nom: 'Louveteaux/Jeannettes', couleur: '#F39200' }, // orange
    patterns: [/louveteaux/i, /jeannettes?/i, /^lj$/i, /^l\/?j$/i, /louv/i],
  },
  {
    spec: { code: 'MO', nom: 'Mousses', couleur: '#F39200' }, // orange (= LJ)
    patterns: [/^mousses?$/i, /^mo$/i],
  },
  {
    spec: { code: 'SG', nom: 'Scouts/Guides', couleur: '#0082BE' }, // bleu
    patterns: [/scouts?[-\s/]+guides?/i, /^sg$/i, /^s\/?g$/i],
  },
  {
    spec: { code: 'MA', nom: 'Marins', couleur: '#0082BE' }, // bleu (= SG)
    patterns: [/^marins?$/i, /^ma$/i],
  },
  {
    spec: { code: 'PC', nom: 'Pionniers/Caravelles', couleur: '#E2002B' }, // rouge
    patterns: [/pionniers?/i, /caravelles?/i, /^pc$/i, /^p\/?c$/i],
  },
  {
    spec: { code: 'CO', nom: 'Compagnons', couleur: '#1F7A2D' }, // vert foncé
    patterns: [/compagnons?\s+marins?/i, /^cm$/i, /^co$/i, /^compagnons?$/i],
  },
  {
    spec: { code: 'CM', nom: 'Compagnons Marins', couleur: '#1F7A2D' }, // vert foncé
    patterns: [/compagnons?\s+marins?/i, /^cm$/i],
  },
  {
    spec: { code: 'AU', nom: 'Audacieux', couleur: '#EC4899' }, // magenta (à confirmer)
    patterns: [/audacieux/i, /^au$/i],
  },
  // === Catégorie Groupe : englobe les unités transverses du groupe
  // (Groupe, Impeesas, Ajustements, et toute unité créée par le
  // trésorier sous catégorie "Groupe" dans Comptaweb). ===
  {
    spec: { code: 'GR', nom: 'Groupe', couleur: '#5E348B' }, // indigo/violet
    patterns: [/^groupe$/i, /\bgroupe\b/i, /^gr$/i, /impeesas?/i, /^im$/i, /ajustements?/i],
  },
];

// Note sur l'ordre des règles ci-dessus :
// - Compagnons Marins doit matcher avant Compagnons (sinon "Compagnons Marins"
//   matche "compagnons?$" en premier). On résout en testant tous les patterns
//   de toutes les rules dans l'ordre — la 1ère rule qui matche gagne.
//   Compagnons Marins est listé AVANT dans la rule CO via le pattern "compagnons? marins" qui doit être testé avant "^compagnons$"
//   En pratique, la rule CO ci-dessus a le pattern marin en 1er pour matcher
//   "Compagnons Marins" sur la rule CM ensuite. Cleanup : on inverse la
//   rule CO pour ne PAS matcher Marins.

export function inferCategorieSGDF(label: string): CategorieSGDFSpec | null {
  if (!label) return null;
  // Cas spécial : "Compagnons Marins" doit aller en CM, pas CO. On teste
  // CM en premier explicitement.
  if (/compagnons?\s+marins?/i.test(label)) {
    const cm = RULES.find((r) => r.spec.code === 'CM');
    return cm?.spec ?? null;
  }
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(label)) return rule.spec;
    }
  }
  return null;
}

export const ALL_CATEGORIES_SGDF: CategorieSGDFSpec[] = RULES.map((r) => r.spec);

// Alias rétrocompat avec l'ancien nommage du fichier (à retirer en
// même temps que tous les call sites).
export const inferBrancheSGDF = inferCategorieSGDF;
export const ALL_BRANCHES_SGDF = ALL_CATEGORIES_SGDF;
export type BrancheCode = CategorieCode;
export type BrancheSGDFSpec = CategorieSGDFSpec;
