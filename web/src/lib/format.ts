// Format / parse de montants en centimes <-> texte FR.
//
// IMPORTANT : ce fichier doit rester strictement identique à
// `compta/src/utils.ts`. Tant qu'on n'a pas mis en place le
// monorepo / package partagé (cf. TODO dans web/src/lib/comptaweb/
// env-loader.ts), toute modif ici doit être portée à l'identique
// dans compta/src/utils.ts.

export function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const cts = String(abs % 100).padStart(2, '0');
  return `${sign}${euros},${cts} €`;
}

export function parseAmount(text: string): number {
  const cleaned = text.replace(/\s*€\s*/, '').replace(/\s/g, '').trim();
  const negative = cleaned.startsWith('-');
  const abs = cleaned.replace(/^[+-]/, '');

  let euros: number, cts: number;
  if (abs.includes(',')) {
    const [e, c] = abs.split(',');
    euros = parseInt(e || '0', 10);
    cts = parseInt((c || '0').padEnd(2, '0').slice(0, 2), 10);
  } else if (abs.includes('.')) {
    const [e, c] = abs.split('.');
    euros = parseInt(e || '0', 10);
    cts = parseInt((c || '0').padEnd(2, '0').slice(0, 2), 10);
  } else {
    euros = parseInt(abs, 10);
    cts = 0;
  }

  const total = euros * 100 + cts;
  return negative ? -total : total;
}
