// Scrape des pages listant les cartes côté Comptaweb :
//   /carteprocurement?m=1 → CP (cartes procurement) avec leur "Card Id" externe
//   /cartebancaire?m=1    → CB classiques (pas de code_externe exploitable)

import * as cheerio from 'cheerio';
import type { ComptawebConfig } from './types';
import { fetchHtml } from './http';

export type CarteType = 'cb' | 'procurement';

export interface ScrapedCarte {
  type: CarteType;
  comptawebId: number;
  libelle: string;
  porteur: string;
  codeExterne: string | null;
  statut: 'active' | 'ancienne';
}

function derivePorteur(libelle: string): string {
  const cleaned = libelle.replace(/^CP\s+RG\s+/i, '').replace(/^Carte\s+/i, '').trim();
  return cleaned || libelle.trim();
}

function parseRows(html: string, type: CarteType): ScrapedCarte[] {
  const $ = cheerio.load(html);
  const out: ScrapedCarte[] = [];

  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('> td');
    if (cells.length < 5) return;

    const libelle = $(cells.get(0)).text().trim();
    const cardIdCell = type === 'procurement' ? $(cells.get(4)).text().trim() : null;

    const showLink = $(row).find('a[href*="/show"]').attr('href') ?? '';
    const idMatch = showLink.match(/\/carte(?:procurement|bancaire)\/(\d+)\/show/);
    if (!idMatch) return;
    const comptawebId = Number(idMatch[1]);

    const statutText = $(row).find('td').filter((_, td) => /active|inactive/i.test($(td).text())).first().text().trim().toLowerCase();
    const statut = /inactive/.test(statutText) ? 'ancienne' : 'active';

    out.push({
      type,
      comptawebId,
      libelle,
      porteur: derivePorteur(libelle),
      codeExterne: cardIdCell && cardIdCell.length >= 4 ? cardIdCell : null,
      statut,
    });
  });

  return out;
}

export async function fetchCartesProcurement(config: ComptawebConfig): Promise<ScrapedCarte[]> {
  const html = await fetchHtml(config, '/carteprocurement?m=1');
  return parseRows(html, 'procurement');
}

export async function fetchCartesBancaires(config: ComptawebConfig): Promise<ScrapedCarte[]> {
  const html = await fetchHtml(config, '/cartebancaire?m=1');
  return parseRows(html, 'cb');
}

export async function fetchAllCartes(config: ComptawebConfig): Promise<ScrapedCarte[]> {
  const [proc, cb] = await Promise.all([fetchCartesProcurement(config), fetchCartesBancaires(config)]);
  return [...proc, ...cb];
}
