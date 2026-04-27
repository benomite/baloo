// Client BDD unifié pour `web/` (chantier 7, ADR-017).
//
// API : imite l'API synchrone de `better-sqlite3` (`prepare/run/get/all`,
// `exec`, `pragma`, `transaction`), mais en async parce qu'on tourne sur
// `@libsql/client`. Les call-sites doivent ajouter `await` mais ne
// changent pas de structure.
//
// - Dev local : `DB_PATH=../data/baloo.db` (libsql en mode `file:`).
// - Prod (Turso) : `DB_URL=libsql://...` + `DB_AUTH_TOKEN=...`.

import { createClient, type Client, type InValue, type Transaction } from '@libsql/client';
import { resolve } from 'path';

let client: Client | null = null;

function getClient(): Client {
  if (client) return client;
  const url = process.env.DB_URL;
  const authToken = process.env.DB_AUTH_TOKEN;
  if (url) {
    client = createClient({ url, authToken });
  } else {
    const path = process.env.DB_PATH || '../data/baloo.db';
    const absolute = resolve(process.cwd(), path);
    client = createClient({ url: `file:${absolute}` });
  }
  return client;
}

function bindArgs(args: unknown[]): InValue[] {
  return args.map((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v;
    if (v instanceof Uint8Array) return v;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }) as InValue[];
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  run(...args: unknown[]): Promise<RunResult>;
  get<T = Record<string, unknown>>(...args: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...args: unknown[]): Promise<T[]>;
}

export interface DbWrapper {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  pragma(stmt: string): Promise<unknown[]>;
  // Exécute `fn` dans une transaction libsql. Le `db` injecté à `fn`
  // route toutes ses opérations sur la transaction (sinon on ne serait
  // pas réellement transactionnel). Rollback automatique en cas
  // d'erreur, commit sinon.
  transaction<T>(fn: (db: DbWrapper) => Promise<T>): Promise<T>;
}

// Type executor : soit le client direct, soit une transaction en cours.
// Les deux exposent `execute`/`executeMultiple` avec la même signature.
type Executor = Pick<Client, 'execute' | 'executeMultiple'>;

function wrap(executor: Executor): DbWrapper {
  return {
    prepare(sql: string): Statement {
      return {
        async run(...args) {
          const r = await executor.execute({ sql, args: bindArgs(args) });
          return { changes: Number(r.rowsAffected), lastInsertRowid: r.lastInsertRowid ?? 0 };
        },
        async get(...args) {
          const r = await executor.execute({ sql, args: bindArgs(args) });
          return r.rows[0] as never;
        },
        async all(...args) {
          const r = await executor.execute({ sql, args: bindArgs(args) });
          return r.rows as never;
        },
      };
    },
    async exec(sql: string) {
      await executor.executeMultiple(sql);
    },
    async pragma(stmt: string): Promise<unknown[]> {
      const r = await executor.execute(`PRAGMA ${stmt}`);
      return r.rows;
    },
    async transaction<T>(fn: (db: DbWrapper) => Promise<T>): Promise<T> {
      // Une transaction libsql ne peut être ouverte que sur le client
      // racine — pas de sub-transactions imbriquées.
      const root = getClient();
      const tx: Transaction = await root.transaction('write');
      try {
        const txDb = wrap(tx);
        const result = await fn(txDb);
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    },
  };
}

export function getDb(): DbWrapper {
  return wrap(getClient());
}
