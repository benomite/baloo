// Logger minimal côté serveur. En dev, sortie lisible humain. En
// prod (Vercel), sortie JSON sur stdout/stderr — `vercel logs` et les
// agrégateurs (Logtail, Datadog…) picorent les champs structurés.
//
// `logError` persiste aussi en BDD (table `error_log`) en
// fire-and-forget : page admin `/admin/errors` pour consulter sans
// passer par les logs Vercel. Si la BDD plante, on log juste en
// console et on continue (pas de récursion infinie).
//
// Convention : `mod` = nom court du module appelant ('remboursements',
// 'auth', 'comptaweb-import'…), pour filtrer côté collector.

import { getDb } from './db';

type LogLevel = 'info' | 'warn' | 'error';

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return String(err);
}

function emit(
  level: LogLevel,
  mod: string,
  message: string,
  error?: unknown,
  data?: Record<string, unknown>,
): void {
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (process.env.NODE_ENV === 'production') {
    out(
      JSON.stringify({
        level,
        mod,
        message,
        ts: new Date().toISOString(),
        ...(error !== undefined ? { error: serializeError(error) } : {}),
        ...(data ? { data } : {}),
      }),
    );
    return;
  }
  if (error !== undefined && data) {
    out(`[${mod}] ${message}`, error, data);
  } else if (error !== undefined) {
    out(`[${mod}] ${message}`, error);
  } else if (data) {
    out(`[${mod}] ${message}`, data);
  } else {
    out(`[${mod}] ${message}`);
  }
}

// Persistance fire-and-forget. La promesse retournée n'est PAS attendue
// par les appelants — on ne veut pas bloquer le request lifecycle si
// la BDD est lente, ni propager une exception BDD vers le caller (qui
// est déjà dans un catch typiquement).
async function persistError(
  mod: string,
  message: string,
  error: unknown,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  try {
    const id = `errlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const errorName = error instanceof Error ? error.name : null;
    const stack = error instanceof Error ? (error.stack ?? null) : null;
    // Si pas une Error, on stringify la valeur dans data_json pour
    // garder une trace.
    const finalData =
      error instanceof Error
        ? data
        : { ...(data ?? {}), errorValue: typeof error === 'string' ? error : safeStringify(error) };
    await getDb()
      .prepare(
        `INSERT INTO error_log (id, mod, message, error_name, stack, data_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        mod,
        message,
        errorName,
        stack,
        finalData ? safeStringify(finalData) : null,
      );
  } catch (persistErr) {
    // Pas de logError ici — récursion infinie possible si la BDD est
    // cassée. console.error direct, c'est tout.
    console.error('[log] Persist error_log échouée', persistErr);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logInfo(mod: string, message: string, data?: Record<string, unknown>): void {
  emit('info', mod, message, undefined, data);
}

export function logWarn(
  mod: string,
  message: string,
  error?: unknown,
  data?: Record<string, unknown>,
): void {
  emit('warn', mod, message, error, data);
}

export function logError(
  mod: string,
  message: string,
  error?: unknown,
  data?: Record<string, unknown>,
): void {
  emit('error', mod, message, error, data);
  // Fire-and-forget — pas d'await ici. On capture la promesse pour
  // éviter "unhandled promise rejection" si la persistance plante.
  void persistError(mod, message, error, data).catch(() => {
    // déjà loggé en console dans persistError
  });
}
