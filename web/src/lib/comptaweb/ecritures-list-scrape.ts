// Scraping de la page `GET /recettedepense?m=1` côté Comptaweb : liste
// complète des écritures de la période active (un mois en général, parfois
// l'exercice complet selon le filtre serveur).
//
// Utilisé par la sync incrémentale (Phase 2) pour promouvoir les
// écritures Baloo `pending_sync` en `mirror` quand elles apparaissent
// dans Comptaweb. Cf. doc/specs/2026-05-19-baloo-sync-incremental-design.md.
//
// Structure HTML observée (capture locale du 2026-05-19) :
//
// ```
// <div class="panel panel-default">
//   <div class="panel-heading">… "DÉPENSE / RECETTE" …</div>
//   <div class="panel-body">
//     <table class="table table-striped … table-triable-sans-tri-initial">
//       <thead><tr>
//         <th></th><th>Date</th><th>Compte bancaire</th><th>Intitulé</th>
//         <th>Dépense</th><th>Recette</th><th>N° pièce</th>
//         <th>Mode de transaction</th><th>Catégorie tiers</th>
//         <th>Structure du tiers</th>
//       </tr></thead>
//       <tbody>
//         <tr>
//           <td>...boutons rapprochement (.fa-check si rapproché)...</td>
//           <td><div class="hidden">20260504</div>04/05/2026</td>
//           <td>GROUPE VAL DE SAONE</td>
//           <td>Don WET</td>
//           <td>1000,00</td>  <!-- ou vide si recette -->
//           <td></td>          <!-- ou montant si recette -->
//           <td>ECR-2026-213</td>
//           <td>Virement</td>
//           <td>Echelon National</td>
//           <td></td>
//         </tr>
//         ...
//       </tbody>
//     </table>
//   </div>
// </div>
// ```
//
// L'ID interne CW de chaque ligne est extrait du `onclick="window.location
// .href='/recettedepense/<ID>/afficher'"` présent sur (presque) toutes les
// cellules de la ligne.

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { fetchHtml } from './http';
import type {
  ComptawebConfig,
  CwEcritureRow,
  ScrapeListeEcrituresResult,
} from './types';

function parseMontantFr(text: string): number {
  // Garde le dernier nombre du texte (la cellule peut avoir des espaces,
  // sauts de ligne, et parfois la devise). Renvoie en centimes (positif).
  const match = text.match(/-?\d+(?:[\s.]\d{3})*(?:,\d{1,2})?/g);
  if (!match || match.length === 0) return 0;
  const raw = match[match.length - 1].replace(/\s/g, '').replace(',', '.');
  const n = Number(raw);
  if (Number.isNaN(n)) return 0;
  return Math.round(Math.abs(n) * 100);
}

function parseDateIso(cell: cheerio.Cheerio<AnyNode>): string {
  // La cellule date contient un `<div class="hidden">YYYYMMDD</div>` plus
  // fiable que le texte FR DD/MM/YYYY (mauvaise gestion des espaces).
  const hidden = cell.find('div.hidden').first().text().trim();
  if (/^\d{8}$/.test(hidden)) {
    return `${hidden.slice(0, 4)}-${hidden.slice(4, 6)}-${hidden.slice(6, 8)}`;
  }
  // Fallback texte FR.
  const text = cell.text();
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) throw new Error(`Date introuvable dans la cellule : "${text.slice(0, 100)}"`);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function extractEcritureId($row: cheerio.Cheerio<AnyNode>): number | null {
  // Plusieurs cellules portent `onclick="window.location.href='/recettedepense/<ID>/afficher'"`.
  // On prend la première.
  let foundId: number | null = null;
  $row.find('[onclick]').each((_, el) => {
    if (foundId !== null) return;
    const onclick = (el as { attribs?: Record<string, string> }).attribs?.onclick ?? '';
    const m = onclick.match(/\/recettedepense\/(\d+)\/afficher/);
    if (m) foundId = Number(m[1]);
  });
  return foundId;
}

function parseRow($: CheerioAPI, tr: AnyNode): CwEcritureRow | null {
  const $tr = $(tr);
  const cells = $tr.find('> td');
  // 10 cellules attendues : actions, date, compte, intitulé, dépense,
  // recette, n° pièce, mode, catégorie tiers, structure tiers.
  if (cells.length < 10) return null;

  const id = extractEcritureId($tr);
  if (id === null) return null;

  const $actions = $(cells[0]);
  // Rapproché si on a soit un bouton check (.fa-check) soit un lien
  // /rapprochementbancaire/voir/ (les deux apparaissent ensemble dans
  // les fixtures observées).
  const rapproche =
    $actions.find('a[href*="/rapprochementbancaire/voir/"]').length > 0 ||
    $actions.find('.fa-check').length > 0;

  const dateEcriture = parseDateIso($(cells[1]));
  const compteBancaire = $(cells[2]).text().replace(/\s+/g, ' ').trim();
  const intitule = $(cells[3]).text().replace(/\s+/g, ' ').trim();

  const depenseTxt = $(cells[4]).text().replace(/\s+/g, ' ').trim();
  const recetteTxt = $(cells[5]).text().replace(/\s+/g, ' ').trim();
  const depenseCents = depenseTxt ? parseMontantFr(depenseTxt) : 0;
  const recetteCents = recetteTxt ? parseMontantFr(recetteTxt) : 0;

  let type: 'depense' | 'recette';
  let montantCentimes: number;
  if (depenseCents > 0 && recetteCents === 0) {
    type = 'depense';
    montantCentimes = depenseCents;
  } else if (recetteCents > 0 && depenseCents === 0) {
    type = 'recette';
    montantCentimes = recetteCents;
  } else if (depenseCents > 0 && recetteCents > 0) {
    // Cas dégénéré observé : on prend le plus grand (cas "regroupement"
    // peut afficher les deux mais l'un est généralement zéro). On loggue.
    // Ne pas throw : la sync doit continuer même si une ligne est tordue.
    type = depenseCents >= recetteCents ? 'depense' : 'recette';
    montantCentimes = Math.max(depenseCents, recetteCents);
  } else {
    // Ni dépense ni recette renseignée : ligne probablement de pied de
    // tableau / total. Skip.
    return null;
  }

  const numeroPiece = $(cells[6]).text().replace(/\s+/g, ' ').trim();
  const modeTransaction = $(cells[7]).text().replace(/\s+/g, ' ').trim();
  const categorieTiers = $(cells[8]).text().replace(/\s+/g, ' ').trim();
  const structureTiers = $(cells[9]).text().replace(/\s+/g, ' ').trim();

  return {
    id,
    numeroPiece,
    dateEcriture,
    type,
    intitule,
    montantCentimes,
    compteBancaire,
    modeTransaction,
    categorieTiers,
    structureTiers,
    rapproche,
  };
}

/**
 * Localise la table principale de la page `/recettedepense?m=1` en se
 * basant sur la signature des `<th>` (la table n'a pas d'id stable et
 * sa classe `table-triable-sans-tri-initial` est partagée avec d'autres
 * tables tri). Critère : le `<thead>` contient les colonnes "Dépense" ET
 * "Recette" ET "N° pièce".
 */
function findMainTable($: CheerioAPI): cheerio.Cheerio<AnyNode> {
  const candidates = $('table').filter((_, t) => {
    const ths = $(t).find('thead th');
    let hasDepense = false;
    let hasRecette = false;
    let hasPiece = false;
    ths.each((_i, th) => {
      const txt = $(th).text().replace(/\s+/g, ' ').toLowerCase();
      if (txt.includes('dépense')) hasDepense = true;
      if (txt.includes('recette')) hasRecette = true;
      if (txt.includes('pièce')) hasPiece = true;
    });
    return hasDepense && hasRecette && hasPiece;
  });
  return candidates.first();
}

export function parseListeEcrituresHtml(html: string): ScrapeListeEcrituresResult {
  const $ = cheerio.load(html);
  const table = findMainTable($);
  if (!table.length) {
    throw new Error(
      'Table /recettedepense introuvable : la structure Comptaweb a peut-être changé. ' +
        'Critère cherché : <th> contenant "Dépense", "Recette" et "pièce" dans le même thead.',
    );
  }

  const ecritures: CwEcritureRow[] = [];
  table.find('tbody > tr').each((_, tr) => {
    try {
      const row = parseRow($, tr);
      if (row) ecritures.push(row);
    } catch {
      // Ligne mal formée : on log côté caller via le journal d'erreurs si
      // nécessaire. Ici on tolère pour ne pas bloquer la sync entière sur
      // une ligne corrompue.
    }
  });

  return { ecritures };
}

/** Étendue de la fenêtre scrapée (cf. spec réconciliation 2026-06-01). */
export type SyncScope = 'recent' | 'exercice';

/**
 * Récupère la liste des écritures Comptaweb. Pas de pagination observée :
 * tout est dans le HTML.
 *
 * - `scope='recent'` (défaut) → `/recettedepense?m=1` : période active CW
 *   (en pratique le mois / les écritures récentes). Utilisé par les cycles
 *   automatiques.
 * - `scope='exercice'` → `/recettedepense` sans filtre `m` : l'exercice
 *   complet tel que servi par CW. Plus lourd, déclenché explicitement.
 *
 * ⚠️ Le mapping exact `exercice` → URL est l'hypothèse retenue (absence du
 * filtre `m=1`). À confirmer sur l'instance CW ; le parser, lui, est
 * identique quel que soit le volume retourné.
 */
export async function scrapeListeEcritures(
  config: ComptawebConfig,
  scope: SyncScope = 'recent',
): Promise<ScrapeListeEcrituresResult> {
  const path = scope === 'exercice' ? '/recettedepense' : '/recettedepense?m=1';
  const html = await fetchHtml(config, path);
  return parseListeEcrituresHtml(html);
}
