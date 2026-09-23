export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Échappement RFC 4180 : si le champ contient virgule, guillemet ou
  // saut de ligne, on entoure de guillemets et on double les guillemets
  // internes.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatAmountCsv(cents: number): string {
  // Format français pour Excel FR : virgule décimale, pas de séparateur
  // milliers (Excel l'ajoute lui-même selon la locale du poste).
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Assemble un CSV prêt pour Excel FR : BOM UTF-8 en tête (sinon les accents
 * partent en charabia à l'ouverture) et lignes jointes en CRLF (RFC 4180).
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lignes = [headers.join(','), ...rows.map((r) => r.map(escapeCsv).join(','))];
  return '﻿' + lignes.join('\r\n');
}
