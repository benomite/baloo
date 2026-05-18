// Helpers sémantiques autour du nouveau cycle de vie des écritures
// (cf. ECRITURE_STATUSES dans `lib/types.ts`).
//
// La logique "verrouillée car déjà dans Comptaweb" s'exprimait avant par
// `status === 'saisie_comptaweb'`. Maintenant, "dans Comptaweb" couvre
// `mirror` (miroir propre) ET `divergent` (la sync a détecté un écart,
// mais l'écriture EXISTE bien côté CW). On ne touche pas localement aux
// champs sync dans ces deux cas : la réconciliation du divergent passe
// soit par la sync de retour (qui réécrit le miroir), soit par une
// action explicite côté MCP/CW.
//
// `draft` est l'équivalent direct de l'ancien `brouillon` : préparation
// locale, pas encore poussée. `pending_cw` (en cours d'envoi) et
// `pending_sync` (envoyée à CW, attend la sync de retour) sont des états
// transitoires : modifiables localement reste discutable, mais le flow
// MCP-first (Phase 2) écrira `pending_cw` brièvement le temps du round-
// trip — la doctrine actuelle est de les laisser éditables comme un
// draft, tant que le miroir n'est pas confirmé.

import type { EcritureStatus } from '../types';

// Statuts qui correspondent à une écriture présente dans Comptaweb (ou
// signalée comme telle par la sync). Les champs synchronisables d'une
// telle écriture sont LOCK côté Baloo — la mise à jour passe par CW.
const MIRROR_STATUSES: readonly EcritureStatus[] = ['mirror', 'divergent'];

// Statuts "en attente" affichés dans /inbox : tout ce qui n'est pas
// encore un miroir CW confirmé. Le futur dashboard liste ces écritures
// comme "à faire" (compléter, pousser à CW, etc.).
const PENDING_STATUSES: readonly EcritureStatus[] = ['draft', 'pending_cw', 'pending_sync'];

export function isMirrorStatus(status: string): boolean {
  return (MIRROR_STATUSES as readonly string[]).includes(status);
}

export function isPendingStatus(status: string): boolean {
  return (PENDING_STATUSES as readonly string[]).includes(status);
}

// Renvoie la liste sous forme de tableau modifiable (utile pour
// construire des clauses SQL `IN (?, ?, ?)`).
export function mirrorStatuses(): EcritureStatus[] {
  return [...MIRROR_STATUSES];
}

export function pendingStatuses(): EcritureStatus[] {
  return [...PENDING_STATUSES];
}
