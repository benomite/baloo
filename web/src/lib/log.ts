// Logger minimal côté serveur. En dev, sortie lisible humain. En
// prod (Vercel), sortie JSON sur stdout/stderr — `vercel logs` et les
// agrégateurs (Logtail, Datadog…) picorent les champs structurés.
//
// Convention : `mod` = nom court du module appelant ('remboursements',
// 'auth', 'comptaweb-import'…), pour filtrer côté collector.

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
}
