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
