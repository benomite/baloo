import type { FetchResult } from './storage';

// Récupération d'un justificatif avec garde de délai. La route GET
// `/api/justificatifs/[...]` streame un blob Vercel privé : si le `get()`
// du storage traîne (blob injoignable, réseau qui pend), la requête
// chargeait à l'INFINI côté client — assez pour wedger le service worker
// PWA. Ce helper borne l'attente et distingue trois issues, testables sans
// storage réel (fetchFn injecté).
export type JustifFetchOutcome =
  | { status: 'ok'; result: FetchResult | null } // résolu (result null = blob absent → 404)
  | { status: 'timeout' }                         // délai dépassé → 502 + log
  | { status: 'error'; error: unknown };          // le storage a levé → 502 + log

export async function fetchJustifWithTimeout(
  fetchFn: (relPath: string) => Promise<FetchResult | null>,
  relPath: string,
  timeoutMs: number,
): Promise<JustifFetchOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<JustifFetchOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
  });
  const run: Promise<JustifFetchOutcome> = fetchFn(relPath)
    .then((result) => ({ status: 'ok' as const, result }))
    .catch((error) => ({ status: 'error' as const, error }));
  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// `fetchJustifWithTimeout` ne borne que la RÉSOLUTION du `get()` : pour un
// blob Vercel, `get()` résout vite avec un `ReadableStream` dont le TRANSFERT
// (lambda↔blob) reste ensuite non gardé. Si ce transfert cale, la réponse
// pend à l'infini SANS lever d'erreur (le hang « charge indéfiniment » observé
// sur DEP-2026-029 le 2026-07-24, root cause : seul maillon serveur non borné).
// Ce helper draine le corps sous garde de délai, et surtout `cancel()` le
// reader au timeout pour LIBÉRER la connexion sous-jacente (sans quoi la
// lambda reste bloquée sur le socket ouvert). Un `Uint8Array` (backend FS,
// déjà bufferisé) est passé-plat. Pur → testable sans storage réel.
export type BodyReadOutcome =
  | { status: 'ok'; bytes: Uint8Array }
  | { status: 'timeout' }
  | { status: 'error'; error: unknown };

export async function readBodyWithTimeout(
  body: Uint8Array | ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<BodyReadOutcome> {
  if (body instanceof Uint8Array) return { status: 'ok', bytes: body };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BodyReadOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
  });
  const reader = body.getReader();
  const drain: Promise<BodyReadOutcome> = (async () => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    return { status: 'ok' as const, bytes };
  })().catch((error) => ({ status: 'error' as const, error }));

  try {
    const outcome = await Promise.race([drain, timeout]);
    if (outcome.status === 'timeout') {
      // Annule la lecture : libère le socket lambda↔blob resté ouvert, sinon
      // la lambda continue de pendre après notre 502.
      reader.cancel().catch(() => {});
    }
    return outcome;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
