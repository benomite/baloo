import { getDb } from './db';

export function nextId(prefix: string, year?: number): string {
  const y = year ?? new Date().getFullYear();
  const pattern = `${prefix}-${y}-%`;
  const tables = ['ecritures', 'remboursements', 'abandons_frais', 'mouvements_caisse', 'depots_cheques', 'justificatifs', 'comptaweb_imports'];
  const union = tables.map(t => `SELECT id FROM ${t} WHERE id LIKE ?`).join(' UNION ALL ');

  const row = getDb()
    .prepare(`SELECT id FROM (${union}) ORDER BY id DESC LIMIT 1`)
    .get(...tables.map(() => pattern)) as { id: string } | undefined;

  if (!row) return `${prefix}-${y}-001`;

  const lastNum = parseInt(row.id.split('-').pop()!, 10);
  return `${prefix}-${y}-${String(lastNum + 1).padStart(3, '0')}`;
}

export function currentTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
