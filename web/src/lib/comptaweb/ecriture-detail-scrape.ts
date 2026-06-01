// Scraping de la page détail d'une écriture Comptaweb :
// `GET /recettedepense/<id>/afficher`.
//
// Objectif réconciliation (spec 2026-06-01) : récupérer la NATURE (→
// category_id), l'ACTIVITÉ et la BRANCHE/PÔLE (→ unite_id, porte la
// couleur), qui ne figurent PAS dans la liste `?m=1` mais dans le tableau
// de ventilation de la page détail. On ne lit le détail que de façon
// INCRÉMENTALE (cf. cw_signature) pour ne pas multiplier les requêtes.
//
// Structure réelle observée (2026-06-01, écriture 2390826) : un
// `<table class="table table-striped ...">` avec un `<thead>` colonnes
//   Montant | Nature | Activité | Branche / Pôle
// puis une (ou plusieurs) ligne(s) `<tbody><tr><td>` de valeurs, ex. :
//   1000.00 | Flux financiers entre structures (...) | WET | Groupe
//
// On lit la PREMIÈRE ligne de ventilation (cas mono-ventilation, le plus
// courant). En cas d'échec : null partout — la sync ne se bloque jamais
// sur le détail.

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { fetchHtml } from './http';
import type { ComptawebConfig } from './types';

export interface EcritureDetail {
  activite: string | null;
  brancheprojet: string | null;
  /** Libellé de la nature comptable (→ category_id via comptaweb_nature). */
  nature: string | null;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Localise la table de ventilation : son `<thead>` contient à la fois
 * « Nature » et « Activité ». Renvoie la table + l'index de colonne de
 * nature / activité / branche.
 */
function findVentilationTable(
  $: CheerioAPI,
): { table: cheerio.Cheerio<AnyNode>; cols: { nature: number; activite: number; branche: number } } | null {
  let result: ReturnType<typeof findVentilationTable> = null;
  $('table').each((_, t) => {
    if (result) return;
    const headerCells = $(t).find('thead th, thead td');
    if (headerCells.length === 0) return;
    const cols = { nature: -1, activite: -1, branche: -1 };
    headerCells.each((i, th) => {
      const txt = clean($(th).text()).toLowerCase();
      if (cols.nature === -1 && txt.includes('nature')) cols.nature = i;
      if (cols.activite === -1 && (txt.includes('activité') || txt.includes('activite'))) cols.activite = i;
      if (
        cols.branche === -1 &&
        (txt.includes('branche') || txt.includes('pôle') || txt.includes('pole') || txt.includes('projet'))
      )
        cols.branche = i;
    });
    if (cols.nature !== -1 && cols.activite !== -1) {
      result = { table: $(t), cols };
    }
  });
  return result;
}

export function parseEcritureDetailHtml(html: string): EcritureDetail {
  const $ = cheerio.load(html);
  const found = findVentilationTable($);
  if (!found) return { activite: null, brancheprojet: null, nature: null };

  // Première ligne de données (tbody en priorité, sinon 1er tr hors thead).
  const dataRow = found.table.find('tbody tr').first().length
    ? found.table.find('tbody tr').first()
    : found.table.find('tr').filter((_, tr) => $(tr).closest('thead').length === 0).first();

  const cells = dataRow.find('td');
  if (cells.length === 0) return { activite: null, brancheprojet: null, nature: null };

  const at = (idx: number): string | null => {
    if (idx < 0 || idx >= cells.length) return null;
    const v = clean($(cells[idx]).text());
    return v.length > 0 ? v : null;
  };

  return {
    nature: at(found.cols.nature),
    activite: at(found.cols.activite),
    brancheprojet: at(found.cols.branche),
  };
}

export async function scrapeEcritureDetail(
  config: ComptawebConfig,
  cwId: number,
): Promise<EcritureDetail> {
  const html = await fetchHtml(config, `/recettedepense/${cwId}/afficher`);
  return parseEcritureDetailHtml(html);
}
