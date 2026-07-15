/**
 * Applique `fn` à chaque item avec au plus `limit` exécutions concurrentes.
 * Préserve l'ordre (résultat[i] ↔ items[i]) et n'échoue jamais globalement :
 * chaque entrée est un PromiseSettledResult (fulfilled/rejected). Un rejet
 * isolé n'interrompt pas les autres. Pur (aucune dépendance), testable.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  if (items.length === 0) return results;
  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}
