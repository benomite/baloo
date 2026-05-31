// Scraping de la page détail d'une écriture Comptaweb :
// `GET /recettedepense/<id>/afficher`.
//
// Objectif réconciliation (spec 2026-06-01) : récupérer l'activité et la
// branche/projet, qui ne figurent PAS dans la liste `?m=1` mais portent
// l'imputation (et la couleur côté Baloo via l'unité). On ne lit le détail
// que de façon INCRÉMENTALE (cf. cw_signature) pour ne pas multiplier les
// requêtes.
//
// ⚠️ Les sélecteurs reposent sur un matching par LIBELLÉ (« Activité »,
// « Branche »/« Projet ») robuste à plusieurs layouts (dl/dt-dd, table
// th-td ou td-td). À confirmer sur une capture réelle ; en cas d'échec on
// renvoie `null` (la sync ne se bloque jamais sur le détail).

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { fetchHtml } from './http';
import type { ComptawebConfig } from './types';

export interface EcritureDetail {
  activite: string | null;
  brancheprojet: string | null;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Cherche la valeur associée à un libellé, en testant les layouts
 * usuels de Comptaweb :
 *   - <dt>Libellé</dt><dd>valeur</dd>
 *   - <th>Libellé</th><td>valeur</td>  (ligne de tableau)
 *   - <td>Libellé</td><td>valeur</td>
 *   - <label>Libellé</label> ... <span/div/input value>
 * `labelMatchers` : prédicats sur le texte du libellé (insensible casse).
 */
function findFieldValue($: CheerioAPI, labelMatchers: ((t: string) => boolean)[]): string | null {
  const matches = (txt: string) => labelMatchers.some((m) => m(txt.toLowerCase()));

  let found: string | null = null;

  // dt / dd
  $('dt').each((_, el) => {
    if (found !== null) return;
    const label = clean($(el).text());
    if (matches(label)) {
      const dd = $(el).next('dd');
      const v = clean(dd.text());
      if (v) found = v;
    }
  });
  if (found !== null) return found;

  // lignes de tableau : th|td libellé suivi d'un td valeur
  $('tr').each((_, tr) => {
    if (found !== null) return;
    const cells = $(tr).children('th,td');
    if (cells.length < 2) return;
    const label = clean($(cells[0]).text());
    if (matches(label)) {
      const v = clean($(cells[1]).text());
      if (v) found = v;
    }
  });
  if (found !== null) return found;

  // label + valeur frère
  $('label').each((_, el) => {
    if (found !== null) return;
    const label = clean($(el).text());
    if (matches(label)) {
      const sib = $(el).nextAll('span,div,p,input').first();
      const inputVal = sib.is('input') ? clean(String(sib.attr('value') ?? '')) : clean(sib.text());
      if (inputVal) found = inputVal;
    }
  });

  return found;
}

export function parseEcritureDetailHtml(html: string): EcritureDetail {
  const $ = cheerio.load(html);

  const activite = findFieldValue($, [
    (t) => t.includes('activité') || t.includes('activite'),
  ]);

  // « Branche » ou « Projet » ou « Branche / projet ».
  const brancheprojet = findFieldValue($, [
    (t) => t.includes('branche'),
    (t) => t.includes('projet'),
  ]);

  return { activite, brancheprojet };
}

export async function scrapeEcritureDetail(
  config: ComptawebConfig,
  cwId: number,
): Promise<EcritureDetail> {
  const html = await fetchHtml(config, `/recettedepense/${cwId}/afficher`);
  return parseEcritureDetailHtml(html);
}
