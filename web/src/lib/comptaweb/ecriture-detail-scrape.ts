// Scraping de la page détail d'une écriture Comptaweb :
// `GET /recettedepense/<id>/afficher`.
//
// Une écriture CW porte une ou PLUSIEURS ventilations (ex. un regroupement
// de prélèvements : 481 Formation + 10 Cotisations). Côté Baloo le grain
// canonique est la VENTILATION (cf. import CSV) → on retourne toutes les
// lignes de ventilation pour que la réconciliation crée une écriture Baloo
// par ventilation. Cf. ADR-035 (correctifs post-prod, granularité).
//
// Structure réelle (2026-06-01) : un `<table class="table ...">` avec un
// `<thead>` colonnes `Montant | Nature | Activité | Branche / Pôle` puis une
// ligne `<tbody><tr><td>` par ventilation, ex. :
//   481.00 | Formation     | Formation     | Louveteaux-Jeannettes
//   10.00  | Cotisations…  | Fonctionnement| Pionniers-Caravelles
//
// En cas d'échec : ventilations vide — la sync ne se bloque jamais.

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { fetchHtml } from './http';
import type { ComptawebConfig } from './types';

export interface VentilationDetail {
  /** Montant de la ventilation en centimes (positif ; le signe vient du type). */
  montantCents: number;
  nature: string | null;
  activite: string | null;
  brancheprojet: string | null;
}

export interface EcritureDetail {
  ventilations: VentilationDetail[];
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Parse un montant de ventilation (format point-décimal CW, ex "481.00", "1 000.00"). */
function parseMontant(text: string): number {
  const raw = clean(text).replace(/\s/g, '').replace(',', '.');
  const m = raw.match(/-?\d+(?:\.\d{1,2})?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isNaN(n) ? 0 : Math.round(Math.abs(n) * 100);
}

/**
 * Localise la table de ventilation : son `<thead>` contient à la fois
 * « Nature » et « Activité ». Renvoie la table + l'index de colonne de
 * montant / nature / activité / branche.
 */
function findVentilationTable(
  $: CheerioAPI,
): { table: cheerio.Cheerio<AnyNode>; cols: { montant: number; nature: number; activite: number; branche: number } } | null {
  let result: ReturnType<typeof findVentilationTable> = null;
  $('table').each((_, t) => {
    if (result) return;
    const headerCells = $(t).find('thead th, thead td');
    if (headerCells.length === 0) return;
    const cols = { montant: -1, nature: -1, activite: -1, branche: -1 };
    headerCells.each((i, th) => {
      const txt = clean($(th).text()).toLowerCase();
      if (cols.montant === -1 && txt.includes('montant')) cols.montant = i;
      if (cols.nature === -1 && txt.includes('nature')) cols.nature = i;
      if (cols.activite === -1 && (txt.includes('activité') || txt.includes('activite'))) cols.activite = i;
      if (
        cols.branche === -1 &&
        (txt.includes('branche') || txt.includes('pôle') || txt.includes('pole') || txt.includes('projet'))
      )
        cols.branche = i;
    });
    if (cols.nature !== -1 && cols.activite !== -1) result = { table: $(t), cols };
  });
  return result;
}

export function parseEcritureDetailHtml(html: string): EcritureDetail {
  const $ = cheerio.load(html);
  const found = findVentilationTable($);
  if (!found) return { ventilations: [] };

  const rows = found.table.find('tbody tr').length
    ? found.table.find('tbody tr')
    : found.table.find('tr').filter((_, tr) => $(tr).closest('thead').length === 0);

  const ventilations: VentilationDetail[] = [];
  rows.each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 0) return;
    const at = (idx: number): string | null => {
      if (idx < 0 || idx >= cells.length) return null;
      const v = clean($(cells[idx]).text());
      return v.length > 0 ? v : null;
    };
    const montantText = found.cols.montant >= 0 ? $(cells[found.cols.montant]).text() : '';
    const montantCents = parseMontant(montantText);
    const nature = at(found.cols.nature);
    const activite = at(found.cols.activite);
    const brancheprojet = at(found.cols.branche);
    // Ignore les lignes vides / pied de tableau (ni montant ni imputation).
    if (montantCents === 0 && !nature && !activite && !brancheprojet) return;
    ventilations.push({ montantCents, nature, activite, brancheprojet });
  });

  return { ventilations };
}

export async function scrapeEcritureDetail(
  config: ComptawebConfig,
  cwId: number,
): Promise<EcritureDetail> {
  const html = await fetchHtml(config, `/recettedepense/${cwId}/afficher`);
  return parseEcritureDetailHtml(html);
}
