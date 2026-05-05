// Calcule les totaux depenses/recettes du CSV Comptaweb (lignes Ecriture
// uniquement, pas les ventilations qui sont des décompositions). Sert à
// comparer Baloo BDD vs CSV vs Compte de Résultat Comptaweb.
//
// Usage : pnpm tsx scripts/audit-csv-totals.ts <csv-path>

import { readFileSync } from 'node:fs';

type Row = Record<string, string>;

function parseComptawebCsv(content: string): Row[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map((v) => v.trim().replace(/^"|"$/g, ''));
    if (values.length < headers.length) continue;
    const row: Row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function parseFrenchAmount(text: string): number {
  if (!text || text.trim() === '') return 0;
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

const csvPath = process.argv[2];
if (!csvPath) { console.error('Usage: tsx scripts/audit-csv-totals.ts <csv-path>'); process.exit(1); }

const buffer = readFileSync(csvPath);
const content = new TextDecoder('windows-1252').decode(buffer);
const rows = parseComptawebCsv(content);
console.log(`Lignes CSV: ${rows.length}`);

// === Totaux par lignes "Ecriture" (entêtes de regroupement) ===
let depEcrCents = 0, recEcrCents = 0, ecrCount = 0;
for (const r of rows) {
  if (r['Type'] !== 'Ecriture') continue;
  const dep = parseFrenchAmount(r['Dépense'] || '');
  const rec = parseFrenchAmount(r['Recette'] || '');
  // Skip transferts internes (depV ET recV remplis = même compte vers
  // même compte, ex. dépot espèces en banque)
  if (dep > 0 && rec > 0) continue;
  depEcrCents += dep;
  recEcrCents += rec;
  ecrCount++;
}

// === Totaux par lignes "Ventilation" (ce que Baloo crée comme écritures) ===
let depVentCents = 0, recVentCents = 0, ventCount = 0;
for (const r of rows) {
  if (r['Type'] !== 'Ventilation') continue;
  const dep = parseFrenchAmount(r['Dépense ventilation'] || r['Dépense'] || '');
  const rec = parseFrenchAmount(r['Recette ventilation'] || r['Recette'] || '');
  if (dep > 0 && rec > 0) continue;
  depVentCents += dep;
  recVentCents += rec;
  ventCount++;
}

// Pour les écritures sans ventilation : utiliser le total Ecriture
const piecesWithVent = new Set<string>();
for (const r of rows) {
  if (r['Type'] !== 'Ventilation') continue;
  const piece = (r['N° de pièce'] || '').trim();
  const date = r['Date'] || '';
  const intitule = r['Intitulé'] || r['Intitule'] || '';
  const compte = r['Compte bancaire 1'] || '';
  const key = piece ? `P::${piece}` : `N::${date}::${intitule}::${compte}`;
  piecesWithVent.add(key);
}

let depEcrSansVent = 0, recEcrSansVent = 0, sansVentCount = 0;
for (const r of rows) {
  if (r['Type'] !== 'Ecriture') continue;
  const dep = parseFrenchAmount(r['Dépense'] || '');
  const rec = parseFrenchAmount(r['Recette'] || '');
  if (dep > 0 && rec > 0) continue;
  const piece = (r['N° de pièce'] || '').trim();
  const date = r['Date'] || '';
  const intitule = r['Intitulé'] || r['Intitule'] || '';
  const compte = r['Compte bancaire 1'] || '';
  const key = piece ? `P::${piece}` : `N::${date}::${intitule}::${compte}`;
  if (!piecesWithVent.has(key)) {
    depEcrSansVent += dep;
    recEcrSansVent += rec;
    sansVentCount++;
  }
}

// Le total que Baloo devrait calculer (ventilations + écritures sans ventilation)
const baloDep = depVentCents + depEcrSansVent;
const baloRec = recVentCents + recEcrSansVent;

const fmt = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`;

console.log('\n--- Totaux Ecritures (entête) ---');
console.log(`  Lignes Ecriture (hors transferts): ${ecrCount}`);
console.log(`  Dépenses : ${fmt(depEcrCents)}`);
console.log(`  Recettes : ${fmt(recEcrCents)}`);
console.log(`  Solde    : ${fmt(recEcrCents - depEcrCents)}`);

console.log('\n--- Totaux Ventilations ---');
console.log(`  Lignes Ventilation (hors transferts): ${ventCount}`);
console.log(`  Dépenses : ${fmt(depVentCents)}`);
console.log(`  Recettes : ${fmt(recVentCents)}`);

console.log('\n--- Ecritures sans ventilation ---');
console.log(`  Lignes : ${sansVentCount}`);
console.log(`  Dépenses : ${fmt(depEcrSansVent)}`);
console.log(`  Recettes : ${fmt(recEcrSansVent)}`);

console.log('\n--- Total attendu Baloo (ventilations + écritures sans vent) ---');
console.log(`  Dépenses : ${fmt(baloDep)}`);
console.log(`  Recettes : ${fmt(baloRec)}`);
console.log(`  Solde    : ${fmt(baloRec - baloDep)}`);
