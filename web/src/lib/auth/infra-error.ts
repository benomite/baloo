// Distingue une panne d'infrastructure (BDD, migration de schéma) d'une
// erreur « normale » du login. Auth.js enveloppe les erreurs de l'adapter
// (AdapterError, avec `cause`) : on remonte la chaîne des causes.
const INFRA_ERROR_NAMES = new Set(['LibsqlError', 'AdapterError', 'SqliteError']);

export function isInfraError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (INFRA_ERROR_NAMES.has(current.name)) return true;
    current = current.cause;
  }
  return false;
}
