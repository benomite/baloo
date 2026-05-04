// Helpers de mapping branche/projet Comptaweb → unité terrain SGDF.
//
// Une "unité terrain" représente une vraie unité SGDF du groupe (Farfadets,
// Louveteaux/Jeannettes, Scouts/Guides, Pionniers/Caravelles, Compagnons,
// Impeesas, Groupe, Ajustements). Une unité terrain peut regrouper
// plusieurs branches/projets Comptaweb (fonctionnement, camp été, weekend
// nature, etc.).
//
// Détection : on parse le label de la branche/projet (case insensitive)
// pour identifier la branche SGDF qu'il représente. Couvre les variantes
// d'écriture : "Louveteaux", "louveteaux/jeannettes", "Louveteaux-
// Jeannettes", "LJ", etc.
//
// Si aucun match, l'unite_terrain reste NULL et l'UI signale l'orphelin
// pour que le trésorier puisse intervenir manuellement.

export interface UniteTerrainSpec {
  code: string;
  nom: string;
  couleur: string;
}

interface BrancheRule {
  spec: UniteTerrainSpec;
  patterns: RegExp[];
}

// Couleurs charte SGDF officielles (cohérentes avec UNITE_COULEURS dans
// sync-referentiels-logic.ts — gardé en double pour découpler les modules).
const RULES: BrancheRule[] = [
  {
    spec: { code: 'FA', nom: 'Farfadets', couleur: '#E8485F' },
    patterns: [/farfadets?/i, /^fa$/i],
  },
  {
    spec: { code: 'LJ', nom: 'Louveteaux/Jeannettes', couleur: '#F39200' },
    patterns: [/louveteaux/i, /jeannettes?/i, /^lj$/i, /^l\/?j$/i, /louv/i],
  },
  {
    spec: { code: 'SG', nom: 'Scouts/Guides', couleur: '#0082BE' },
    patterns: [/scouts?[-\s/]+guides?/i, /^sg$/i, /^s\/?g$/i],
  },
  {
    spec: { code: 'PC', nom: 'Pionniers/Caravelles', couleur: '#7D1C2F' },
    patterns: [/pionniers?/i, /caravelles?/i, /^pc$/i, /^p\/?c$/i],
  },
  {
    spec: { code: 'CO', nom: 'Compagnons', couleur: '#00934D' },
    patterns: [/compagnons?/i, /^co$/i],
  },
  {
    spec: { code: 'IM', nom: 'Impeesas', couleur: '#9B4A97' },
    patterns: [/impeesas?/i, /^im$/i],
  },
  {
    spec: { code: 'AJ', nom: 'Ajustements', couleur: '#B0B0B0' },
    patterns: [/ajustements?/i, /^aj$/i],
  },
  // Groupe en dernier : c'est le fallback "compta du groupe au global"
  // (cotisations, frais administratifs). Match large pour ne pas laisser
  // d'orphelin sur les libellés type "Groupe", "GROUPE", "groupe local".
  {
    spec: { code: 'GR', nom: 'Groupe', couleur: '#4A4A4A' },
    patterns: [/^groupe$/i, /\bgroupe\b/i, /^gr$/i],
  },
];

export function inferUniteTerrain(label: string): UniteTerrainSpec | null {
  if (!label) return null;
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(label)) return rule.spec;
    }
  }
  return null;
}
