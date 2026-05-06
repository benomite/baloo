import type { Unite } from '../types';

// Parser pur de l'omnibox caisse — pas de dépendance BDD pour pouvoir
// le tester en unitaire et l'inclure dans un Server Component sans
// effet de bord.
//
// Cas d'usage : le trésorier saisit en 1 ligne au moment où on lui
// donne du cash :
//   `+180 extra-job rouges`     → +180 €, "extra-job", unité Pi-Ca
//   `-25 chocolat caravelles`   → -25 €, "chocolat", unité Caravelles
//   `+50 tombola`               → +50 €, "tombola", pas d'unité
//
// Convention :
//   - 1er token : montant signé. Pas de signe → entrée (positif).
//   - tokens suivants : description + éventuellement une unité.
//   - une unité matche par (code, nom, couleur, ou couleur SGDF par
//     branche d'âge). Le token qui matche l'unité est retiré de la
//     description.
//
// Si aucune unité ne matche, l'opération est créée sans unité — le
// trésorier complétera depuis le tableau plus tard.

export interface OmniboxParseResult {
  amount_cents: number; // signé : positif = entrée, négatif = sortie
  description: string;
  unite_id: string | null;
  // Pour le toast de confirmation : "Unité détectée : Pi-Ca".
  unite_match_label: string | null;
  warnings: string[];
}

export interface OmniboxParseError {
  error: string;
}

export type OmniboxParse = OmniboxParseResult | OmniboxParseError;

export function isOmniboxError(p: OmniboxParse): p is OmniboxParseError {
  return 'error' in p;
}

// Couleurs traditionnelles SGDF par branche d'âge. Sert de fallback
// quand l'unité n'a pas de champ `couleur` mais que le user dit
// "rouges" / "verts" / etc. — on remonte à la branche, et si une seule
// unité du groupe est dans cette branche on prend celle-là.
const COULEUR_TO_BRANCHE: Record<string, string[]> = {
  rouge: ['pi-ca', 'pi_ca', 'pica', 'pionniers', 'caravelles'],
  rouges: ['pi-ca', 'pi_ca', 'pica', 'pionniers', 'caravelles'],
  bleu: ['sg', 'scouts', 'guides'],
  bleus: ['sg', 'scouts', 'guides'],
  bleues: ['sg', 'scouts', 'guides'],
  orange: ['lj', 'louveteaux', 'jeannettes'],
  oranges: ['lj', 'louveteaux', 'jeannettes'],
  vert: ['compagnons', 'compa'],
  verts: ['compagnons', 'compa'],
  violet: ['farfadets'],
  violets: ['farfadets'],
};

export function parseOmniboxInput(
  rawInput: string,
  unites: Unite[],
): OmniboxParse {
  const input = rawInput.trim();
  if (!input) return { error: 'Saisie vide.' };

  const amountMatch = input.match(/^([+\-])?\s*(\d+(?:[.,]\d{1,2})?)/);
  if (!amountMatch) {
    return {
      error:
        'Montant introuvable. Commence par un nombre (ex : "+180 extra-job rouges").',
    };
  }
  const sign = amountMatch[1] === '-' ? -1 : 1;
  const amountFloat = parseFloat(amountMatch[2].replace(',', '.'));
  if (Number.isNaN(amountFloat) || amountFloat <= 0) {
    return { error: 'Montant invalide.' };
  }
  const amountCents = Math.round(amountFloat * 100) * sign;

  const rest = input.slice(amountMatch[0].length).trim();
  if (!rest) {
    return {
      error: 'Description manquante. Ex : "+180 extra-job rouges".',
    };
  }

  const tokens = rest.split(/\s+/);
  const warnings: string[] = [];

  let matchedUnite: Unite | null = null;
  let matchedTokenIndex: number | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const candidate = matchUnite(tokens[i], unites);
    if (!candidate) continue;
    if (matchedUnite && matchedUnite.id !== candidate.id) {
      warnings.push(
        `Plusieurs unités détectées (${matchedUnite.code} et ${candidate.code}) — j'ai gardé "${matchedUnite.code}".`,
      );
      break;
    }
    matchedUnite = candidate;
    matchedTokenIndex = i;
  }

  const descriptionTokens =
    matchedTokenIndex === null
      ? tokens
      : tokens.filter((_, i) => i !== matchedTokenIndex);

  const description = descriptionTokens.join(' ').trim() || rest;

  return {
    amount_cents: amountCents,
    description,
    unite_id: matchedUnite?.id ?? null,
    unite_match_label: matchedUnite?.code ?? null,
    warnings,
  };
}

function matchUnite(rawToken: string, unites: Unite[]): Unite | null {
  const tok = normalize(rawToken);
  if (tok.length < 2) return null;

  // Match exact sur code (case insensible)
  for (const u of unites) {
    if (normalize(u.code) === tok) return u;
  }
  // Match exact sur nom complet
  for (const u of unites) {
    if (normalize(u.name) === tok) return u;
  }
  // Match exact sur couleur stockée
  for (const u of unites) {
    if (u.couleur && normalize(u.couleur) === tok) return u;
  }
  // Match couleur SGDF → branche → unité unique de cette branche
  const branches = COULEUR_TO_BRANCHE[tok];
  if (branches) {
    const matching = unites.filter((u) => {
      if (!u.branche) return false;
      const b = normalize(u.branche);
      return branches.some((needle) => b.includes(needle));
    });
    if (matching.length === 1) return matching[0];
  }
  // Match partiel sur nom (>= 3 caractères, 1 seule correspondance)
  if (tok.length >= 3) {
    const partials = unites.filter((u) => normalize(u.name).includes(tok));
    if (partials.length === 1) return partials[0];
  }
  return null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
