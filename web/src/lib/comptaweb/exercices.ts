// Contexte d'exercice d'une session Comptaweb (ADR-039).
//
// CW n'expose pas l'exercice en paramètre d'URL : chaque session a le sien,
// changé par le formulaire de `/exercice?m=1`. L'attribut `action` de ce
// formulaire porte l'id de l'exercice COURANT — c'est notre seule façon de lire
// le contexte d'une session.
import * as cheerio from 'cheerio';
import { fetchHtml } from './http';
import type { ComptawebConfig } from './types';
import type { ExerciceCw } from '../services/exercices-actifs';

const PAGE_PATH = '/exercice?m=1';

export interface PageExercices {
  contexteCwId: number;
  options: ExerciceCw[];
  csrfToken: string;
  actionPath: string;
}

export interface ExercicesDeps {
  lirePage?: (config: ComptawebConfig) => Promise<PageExercices>;
  poster?: (config: ComptawebConfig, path: string, body: URLSearchParams) => Promise<void>;
}

export function parseExercicesHtml(html: string): PageExercices {
  const $ = cheerio.load(html);
  const form = $('form[action*="/exercice/upd"]').first();
  const actionPath = form.attr('action') ?? '';
  const idMatch = actionPath.match(/id=(\d+)/);
  const select = form.find('select[name="exercice_change[identifiants_exercices]"]').first();
  const csrfToken = form.find('input[name="exercice_change[_token]"]').attr('value');

  if (!idMatch || !select.length || !csrfToken) {
    throw new Error(
      "Formulaire d'exercice introuvable sur /exercice?m=1 — le layout Comptaweb a changé.",
    );
  }

  const options: ExerciceCw[] = select
    .find('option')
    .toArray()
    .map((el) => ({ cwId: Number($(el).attr('value')), libelle: $(el).text().trim() }))
    .filter((o) => Number.isFinite(o.cwId) && o.libelle.length > 0);

  return { contexteCwId: Number(idMatch[1]), options, csrfToken, actionPath };
}

export async function fetchExercices(config: ComptawebConfig): Promise<PageExercices> {
  return parseExercicesHtml(await fetchHtml(config, PAGE_PATH));
}

async function posterFormulaire(
  config: ComptawebConfig,
  path: string,
  body: URLSearchParams,
): Promise<void> {
  const res = await fetch(new URL(path, config.baseUrl), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: config.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'baloo-compta/0.1',
      Accept: 'text/html',
    },
    body: body.toString(),
  });
  if (res.status >= 400) {
    throw new Error(`Bascule d'exercice refusée par Comptaweb (HTTP ${res.status}).`);
  }
}

/**
 * Garantit que la session est sur l'exercice `cwId`. Bascule si nécessaire,
 * puis RELIT la page pour confirmer. Sans confirmation, on throw : mieux vaut
 * une sync en échec qu'une écriture créée dans le mauvais exercice.
 */
export async function assurerExercice(
  config: ComptawebConfig,
  cwId: number,
  deps: ExercicesDeps = {},
): Promise<void> {
  const lirePage = deps.lirePage ?? fetchExercices;
  const poster = deps.poster ?? posterFormulaire;

  const page = await lirePage(config);
  if (page.contexteCwId === cwId) return;
  if (!page.options.some((o) => o.cwId === cwId)) {
    throw new Error(`Comptaweb ne propose pas l'exercice ${cwId} pour ce compte.`);
  }

  const body = new URLSearchParams();
  body.set('exercice_change[identifiants_exercices]', String(cwId));
  body.set('exercice_change[_token]', page.csrfToken);
  body.set('exercice_change[submit]', '');
  await poster(config, page.actionPath, body);

  const apres = await lirePage(config);
  if (apres.contexteCwId !== cwId) {
    throw new Error(
      `Bascule non confirmée : Comptaweb est resté sur l'exercice ${apres.contexteCwId} au lieu de l'exercice ${cwId}.`,
    );
  }
}
