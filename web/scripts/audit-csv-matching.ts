// Simulation du parser CSV Comptaweb : pour debug du matching cascade.
// Trace pour les 3 lignes problématiques (mestre 568€, LeRest 24€, calendrier 20€)
// si elles seraient INSERT ou UPDATE selon la logique actuelle.
//
// Usage : pnpm tsx scripts/audit-csv-matching.ts <chemin-csv>

import { readFileSync } from 'node:fs';

type Row = Record<string, string>;

function parseComptawebCsv(content: string): { rows: Row[]; errors: string[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: ['Fichier vide ou invalide'] };

  const headers = lines[0].split(';').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Row[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map((v) => v.trim().replace(/^"|"$/g, ''));
    if (values.length < headers.length) {
      errors.push(`Ligne ${i + 1}: nombre de colonnes insuffisant`);
      continue;
    }
    const row: Row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return { rows, errors };
}

function parseFrenchAmount(text: string): number {
  if (!text || text.trim() === '') return 0;
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function parseFrenchDate(text: string): string | null {
  if (!text || text.trim() === '') return null;
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

type LineGroup = { ecriture: Row | null; ventilations: Row[]; piece: string | null };

function groupRows(rows: Row[]): Map<string, LineGroup> {
  const groups = new Map<string, LineGroup>();
  for (const row of rows) {
    const pieceRaw = (row['N° de pièce'] || '').trim();
    const piece = pieceRaw ? pieceRaw.toUpperCase() : null;
    const typeLigne = row['Type'] || '';

    let key: string;
    if (piece) {
      key = `PIECE::${piece}`;
    } else {
      const date = row['Date'] || '';
      const intitule = row['Intitulé'] || row['Intitule'] || '';
      const compte = row['Compte bancaire 1'] || '';
      key = `NOPIECE::${date}::${intitule}::${compte}`;
    }

    let g = groups.get(key);
    if (!g) {
      g = { ecriture: null, ventilations: [], piece };
      groups.set(key, g);
    }
    if (typeLigne === 'Ecriture') {
      g.ecriture = row;
    } else if (typeLigne === 'Ventilation') {
      g.ventilations.push(row);
    } else if (!g.ecriture) {
      g.ecriture = row;
    }
  }
  return groups;
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: tsx scripts/audit-csv-matching.ts <csv-path>');
  process.exit(1);
}

// Décode Windows-1252 (export Excel français)
const buffer = readFileSync(csvPath);
const decoder = new TextDecoder('windows-1252');
const content = decoder.decode(buffer);

const { rows, errors } = parseComptawebCsv(content);
console.log(`Lignes parsées: ${rows.length}`);
console.log(`Erreurs parse: ${errors.length}`);

const groups = groupRows(rows);
console.log(`Groupes total: ${groups.size}`);

// Recherche les 3 cas problématiques
const targets = [
  { description: 'mestre 568€ Participation', match: (k: string, g: LineGroup) => g.piece === '10' },
  { description: 'LeRest 24€ Cotisations', match: (k: string, g: LineGroup) => g.piece === '*' },
  { description: 'calendrier 2026 20€ Dons', match: (k: string, g: LineGroup) => k.includes('calendrier 2026') },
];

for (const t of targets) {
  console.log(`\n=== ${t.description} ===`);
  let found = false;
  for (const [key, g] of groups) {
    if (!t.match(key, g)) continue;
    found = true;
    const ecr = g.ecriture;
    console.log(`KEY: ${key}`);
    console.log(`Ecriture: ${ecr?.['Intitulé']} | piece=${g.piece} | dep=${ecr?.['Dépense']} rec=${ecr?.['Recette']}`);
    console.log(`Ventilations (${g.ventilations.length}):`);
    g.ventilations.forEach((v, i) => {
      console.log(`  [${i}] nature="${v['Nature']}" amount=${v['Recette ventilation'] || v['Dépense ventilation']} branche=${v['Branche/Pôle']} activite=${v['Activité']}`);
    });
  }
  if (!found) console.log('NON TROUVÉ DANS LES GROUPES');
}

// Vérification spéciale : combien de groupes avec piece="*" ?
let starGroups = 0;
for (const [key, g] of groups) {
  if (g.piece === '*') {
    starGroups++;
    if (starGroups <= 5) {
      console.log(`\n[* group] ${key}: ${g.ecriture?.['Intitulé']} (${g.ventilations.length} vents)`);
    }
  }
}
console.log(`\nTotal groupes avec piece='*': ${starGroups}`);

// Stats globales par cas piece
let withPiece = 0, withoutPiece = 0;
for (const [, g] of groups) {
  if (g.piece) withPiece++;
  else withoutPiece++;
}
console.log(`Groupes avec piece: ${withPiece}, sans: ${withoutPiece}`);
