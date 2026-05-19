// Adapter scraper Comptaweb pour `createEcritureAndPushToCw` (Task 8).
//
// Doctrine (cf. doc/specs/2026-05-18-baloo-miroir-mcp-first-design.md) :
// le service `createEcritureAndPushToCw` est agnostique du protocole CW
// (il pilote juste le statut local : pending_cw → pending_sync). Cet
// adapter fait le pont entre le payload "Baloo-friendly" (cents, IDs
// Baloo) et l'API scraper bas niveau `comptaweb/ecritures-write.ts::createEcriture`
// qui veut des IDs CW déjà résolus et un montant formaté.
//
// Raccourcis pris (à documenter pour Task 9+) :
//
//  - **tiersCategId = 10 ("Autre : pas structure SGDF")** par défaut.
//    Cf. `drafts.ts` qui fait pareil. Cas nominal pour toute écriture
//    Baloo (dépense fournisseur, recette famille, frais bancaires).
//    Mouvements internes "Mon groupe" (4) nécessiteront une refonte —
//    pas dans le scope V1.
//
//  - **comptebancaireId = DEFAULT_COMPTE_BANCAIRE_ID** (791 = compte
//    courant du groupe Val de Saône). Multi-groupes nécessiteront un
//    lookup dans `comptes_bancaires` — pas dans le scope V1.
//
//  - **Pas de mapping fuzzy** : si une catégorie / mode / activité
//    Baloo n'a pas de `comptaweb_id` renseigné en BDD, on throw une
//    erreur claire. Le user doit mapper d'abord (via /sync-referentiels)
//    ou utiliser "Tout copier".
//
//  - **Une seule ventilation** (montant total = ventilation unique).
//    Les multi-ventilations CW (ex. dépense partagée entre 2 unités)
//    ne sont pas supportées via Baloo — passer par Comptaweb direct.

import { createEcriture } from '../comptaweb/ecritures-write';
import { loadConfig } from '../comptaweb/auth';
import { getDb } from '../db';
import type { ComptawebConfig, CreateEcritureInput } from '../comptaweb/types';
import type { CwScraper, EcriturePayload } from './ecritures-create';

// Cf. drafts.ts : valeurs validées en prod pour le groupe Val de Saône.
const DEFAULT_TIERS_CATEG_ID = '10'; // "Autre : pas structure SGDF"
const DEFAULT_TIERS_STRUCTURE_ID = '';
const DEFAULT_COMPTE_BANCAIRE_ID = '791';

interface CarteRow {
  id: string;
  type: 'cb' | 'procurement';
  comptaweb_id: number | null;
}

function isoToFr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Date ISO invalide : ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function centsToMontantFr(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

async function lookupComptawebId(
  table: 'categories' | 'activites' | 'unites' | 'modes_paiement',
  id: string | null | undefined,
): Promise<number | null> {
  if (!id) return null;
  const row = await getDb()
    .prepare(`SELECT comptaweb_id FROM ${table} WHERE id = ?`)
    .get<{ comptaweb_id: number | null }>(id);
  return row?.comptaweb_id ?? null;
}

async function lookupCarte(id: string | null | undefined): Promise<CarteRow | null> {
  if (!id) return null;
  const row = await getDb()
    .prepare('SELECT id, type, comptaweb_id FROM cartes WHERE id = ?')
    .get<CarteRow>(id);
  return row ?? null;
}

export interface ResolveDeps {
  /** Override pour tests : remplace le lookup BDD pour `comptaweb_id`. */
  lookupComptawebId?: (
    table: 'categories' | 'activites' | 'unites' | 'modes_paiement',
    id: string | null | undefined,
  ) => Promise<number | null>;
  /** Override pour tests : remplace le lookup carte. */
  lookupCarte?: (id: string | null | undefined) => Promise<CarteRow | null>;
  /** Override pour tests : remplace l'appel scraper réel. */
  createEcriture?: typeof createEcriture;
}

/**
 * Construit le `CreateEcritureInput` (format scraper bas niveau)
 * à partir du payload Baloo. Throws si un mapping CW manque.
 *
 * Exporté pour pouvoir être testé indépendamment du scraper.
 */
export async function buildCwInputFromPayload(
  payload: EcriturePayload,
  deps: ResolveDeps = {},
): Promise<CreateEcritureInput> {
  const luComptawebId = deps.lookupComptawebId ?? lookupComptawebId;
  const luCarte = deps.lookupCarte ?? lookupCarte;

  const [natureCw, activiteCw, uniteCw, modeCw] = await Promise.all([
    luComptawebId('categories', payload.category_id),
    luComptawebId('activites', payload.activite_id),
    luComptawebId('unites', payload.unite_id),
    luComptawebId('modes_paiement', payload.mode_paiement_id),
  ]);

  const missing: string[] = [];
  if (!payload.category_id) missing.push('catégorie');
  else if (natureCw === null) missing.push('mapping CW de la catégorie');
  if (!payload.activite_id) missing.push('activité');
  else if (activiteCw === null) missing.push('mapping CW de l\'activité');
  if (!payload.unite_id) missing.push('unité');
  else if (uniteCw === null) missing.push('mapping CW de l\'unité');
  if (!payload.mode_paiement_id) missing.push('mode de paiement');
  else if (modeCw === null) missing.push('mapping CW du mode de paiement');

  if (missing.length > 0) {
    throw new Error(
      `Impossible d'envoyer à Comptaweb — il manque : ${missing.join(', ')}. ` +
      `Mappe les référentiels (page Sync référentiels) ou utilise "Tout copier".`,
    );
  }

  const carte = await luCarte(payload.carte_id);
  const cartebancaireId =
    carte?.type === 'cb' && carte.comptaweb_id ? String(carte.comptaweb_id) : undefined;
  const carteprocurementId =
    carte?.type === 'procurement' && carte.comptaweb_id
      ? String(carte.comptaweb_id)
      : undefined;

  const montantFr = centsToMontantFr(payload.amount_cents);

  return {
    type: payload.type,
    libel: payload.description,
    dateecriture: isoToFr(payload.date_ecriture),
    montant: montantFr,
    numeropiece: payload.numero_piece ?? undefined,
    modetransactionId: String(modeCw),
    comptebancaireId: DEFAULT_COMPTE_BANCAIRE_ID,
    cartebancaireId,
    carteprocurementId,
    tiersCategId: DEFAULT_TIERS_CATEG_ID,
    tiersStructureId: DEFAULT_TIERS_STRUCTURE_ID,
    ventilations: [
      {
        montant: montantFr,
        natureId: String(natureCw),
        activiteId: String(activiteCw),
        brancheprojetId: String(uniteCw),
      },
    ],
  };
}

/**
 * Scraper adapter conforme à la signature `CwScraper`. Branchable
 * directement sur `createEcritureAndPushToCw`. Charge la config via
 * `loadConfig` (passé séparément côté caller) ; cet adapter ne fait que
 * la résolution + l'appel scraper.
 */
export const defaultCwScraper: CwScraper = async (
  config: ComptawebConfig,
  payload: EcriturePayload,
) => {
  const input = await buildCwInputFromPayload(payload);
  // dryRun=false : on veut vraiment créer dans CW.
  const result = await createEcriture(config, input, { dryRun: false });
  if (result.dryRun) {
    // Garde-fou : `dryRun=false` au-dessus → ne devrait jamais arriver.
    throw new Error('Scraper Comptaweb a retourné dryRun=true malgré dryRun:false explicite.');
  }
  // Le scraper bas niveau ne retourne PAS de numéro de pièce CW (ce
  // champ est généré par Comptaweb à la création, mais le scraper
  // n'extrait que `ecritureId` depuis le `Location` de la redirection).
  // Pour le miroir strict, on utilise l'`ecritureId` CW (numérique) comme
  // `cwNumeroPiece` faute de mieux — la sync incrémentale Phase 2
  // l'écrasera avec le vrai numéro de pièce quand elle retrouvera
  // l'écriture dans la liste CW (par tuple date/montant/libellé/id).
  // C'est cohérent avec l'invariant "cwNumeroPiece unique stable" tant
  // que `ecritureId` CW l'est aussi (il l'est).
  const cwId = result.ecritureId;
  if (!cwId) {
    throw new Error(
      'Comptaweb a accepté la création mais ne renvoie pas d\'ecritureId. ' +
      'Échec du parsing du Location header — probablement une session expirée.',
    );
  }
  return {
    cwNumeroPiece: String(cwId),
    cwEcritureId: cwId,
  };
};

/**
 * Re-export pratique pour la route POST /api/ecritures : la config est
 * chargée à la demande (lazy) au moment de l'appel.
 */
export { loadConfig as defaultCwConfigLoader };

// Re-exports pour tests (permet d'injecter via `buildCwInputFromPayload`).
export type { CarteRow };
