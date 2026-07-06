// Périmètre unité d'un utilisateur (chef multi-unités). `scopeUniteIds` est la
// liste des unités auxquelles le user a accès : VIDE = aucune restriction
// (tresorier/RG, vue globale). Sinon, il ne voit/gère QUE ces unités.

// Construit la clause SQL de restriction pour une colonne `unite_id`.
// Vide → pas de clause (accès global). Sinon `col IN (?, ?, …)`.
// Le filtre restreint TOUJOURS : un chef ne peut jamais élargir son périmètre.
export function uniteScopeSql(
  scopeUniteIds: string[],
  column: string,
): { sql: string; params: string[] } {
  if (scopeUniteIds.length === 0) return { sql: '', params: [] };
  const placeholders = scopeUniteIds.map(() => '?').join(', ');
  return { sql: `${column} IN (${placeholders})`, params: [...scopeUniteIds] };
}

// Résout l'unité à POSER sur une écriture créée par le user :
//  - global (aucun scope) → l'unité choisie (peut être null) ;
//  - scope à 1 unité → cette unité, imposée (le choix user est ignoré) ;
//  - scope à N unités → le choix doit être l'une des siennes, sinon erreur.
export function resolveScopedUnite(scopeUniteIds: string[], chosen: string | null): string | null {
  if (scopeUniteIds.length === 0) return chosen;
  if (scopeUniteIds.length === 1) return scopeUniteIds[0];
  if (chosen && scopeUniteIds.includes(chosen)) return chosen;
  throw new ScopeUniteError('Choisis une unité parmi les tiennes.');
}

export class ScopeUniteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeUniteError';
  }
}
