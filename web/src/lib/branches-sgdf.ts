// Helpers de mapping unité Comptaweb → branche SGDF + couleur officielle.
//
// Vocabulaire :
//   - **Unité** : 1 ligne du référentiel "branches/projets" Comptaweb,
//     correspond à une vraie unité SGDF du groupe (Farfadets, Louveteaux,
//     etc.). Plusieurs unités peuvent partager la même branche d'âge.
//   - **Branche SGDF** : classification d'âge officielle (Farfadets, LJ,
//     SG, PC, CO, Adultes). Détermine la couleur de la charte.
//
// Détection : on parse le label de l'unité Comptaweb (case insensitive)
// pour identifier la branche. Couvre les variantes d'écriture et les
// abréviations.
//
// Si aucun match, la branche reste NULL et l'UI signale l'orphelin pour
// que le trésorier puisse intervenir manuellement.

export type BrancheCode = 'FA' | 'LJ' | 'SG' | 'PC' | 'CO' | 'AD' | 'AJ';

export interface BrancheSGDFSpec {
  code: BrancheCode;
  nom: string;
  couleur: string;
}

interface BrancheRule {
  spec: BrancheSGDFSpec;
  patterns: RegExp[];
}

// Couleurs charte SGDF officielles (par branche d'âge).
// Précisées par l'utilisateur (réponse 2026-05-04).
const RULES: BrancheRule[] = [
  {
    spec: { code: 'FA', nom: 'Farfadets', couleur: '#9DC30D' }, // vert clair
    patterns: [/farfadets?/i, /^fa$/i],
  },
  {
    spec: { code: 'LJ', nom: 'Louveteaux/Jeannettes', couleur: '#F39200' }, // orange
    patterns: [/louveteaux/i, /jeannettes?/i, /^lj$/i, /^l\/?j$/i, /louv/i],
  },
  {
    spec: { code: 'SG', nom: 'Scouts/Guides', couleur: '#0082BE' }, // bleu
    patterns: [/scouts?[-\s/]+guides?/i, /^sg$/i, /^s\/?g$/i],
  },
  {
    spec: { code: 'PC', nom: 'Pionniers/Caravelles', couleur: '#E2002B' }, // rouge
    patterns: [/pionniers?/i, /caravelles?/i, /^pc$/i, /^p\/?c$/i],
  },
  {
    spec: { code: 'CO', nom: 'Compagnons', couleur: '#1F7A2D' }, // vert foncé
    patterns: [/compagnons?/i, /^co$/i],
  },
  {
    spec: { code: 'AJ', nom: 'Ajustements', couleur: '#B0B0B0' }, // gris (hors charte)
    patterns: [/ajustements?/i, /^aj$/i],
  },
  // Branche "Adultes" : regroupe Groupe (compta du groupe au global —
  // cotisations, frais admin) et Impeesas (équipe nationale d'animation
  // adulte). Couleur indigo/violet.
  {
    spec: { code: 'AD', nom: 'Adultes', couleur: '#5E348B' }, // indigo/violet
    patterns: [/^groupe$/i, /\bgroupe\b/i, /^gr$/i, /impeesas?/i, /^im$/i],
  },
];

export function inferBrancheSGDF(label: string): BrancheSGDFSpec | null {
  if (!label) return null;
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(label)) return rule.spec;
    }
  }
  return null;
}

export const ALL_BRANCHES_SGDF: BrancheSGDFSpec[] = RULES.map((r) => r.spec);
