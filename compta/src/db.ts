import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = join(__dirname, '..', '..', 'data', 'baloo.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  const seed = readFileSync(join(__dirname, '..', 'seed.sql'), 'utf-8');
  db.exec(seed);

  return db;
}

export function nextId(prefix: string, year?: number): string {
  const y = year ?? new Date().getFullYear();
  const pattern = `${prefix}-${y}-%`;
  const row = getDb()
    .prepare(`SELECT id FROM (
      SELECT id FROM ecritures WHERE id LIKE ?
      UNION ALL SELECT id FROM remboursements WHERE id LIKE ?
      UNION ALL SELECT id FROM abandons_frais WHERE id LIKE ?
      UNION ALL SELECT id FROM mouvements_caisse WHERE id LIKE ?
      UNION ALL SELECT id FROM depots_cheques WHERE id LIKE ?
      UNION ALL SELECT id FROM justificatifs WHERE id LIKE ?
      UNION ALL SELECT id FROM comptaweb_imports WHERE id LIKE ?
    ) ORDER BY id DESC LIMIT 1`)
    .get(pattern, pattern, pattern, pattern, pattern, pattern, pattern) as { id: string } | undefined;

  if (!row) return `${prefix}-${y}-001`;

  const lastNum = parseInt(row.id.split('-').pop()!, 10);
  return `${prefix}-${y}-${String(lastNum + 1).padStart(3, '0')}`;
}

export function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const cts = String(abs % 100).padStart(2, '0');
  return `${sign}${euros},${cts} €`;
}

export function parseAmount(text: string): number {
  const cleaned = text.replace(/\s*€\s*/, '').replace(/\s/g, '').trim();
  const negative = cleaned.startsWith('-');
  const abs = cleaned.replace('-', '').replace('+', '');

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

export function currentTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
