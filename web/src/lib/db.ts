import Database from 'better-sqlite3';
import { resolve } from 'path';

let db: Database.Database;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolve(process.cwd(), process.env.DB_PATH || '../data/baloo.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return db;
}
