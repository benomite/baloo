// Lecture des lignes d'une table selon son régime de sélection (tâche 6 :
// `RegimeSelection`, `Jointure`, `TableExport`).
//
// Les noms de table et de colonne viennent de TABLES_INCLUSES (constante du
// code, jamais d'une entrée utilisateur) : ils sont interpolés dans le SQL,
// ce que le driver ne permet pas de paramétrer. Le groupId, lui, est
// toujours un paramètre lié.
import type { DbWrapper } from '../../db';
import type { Jointure, TableExport } from './tables';
import { caviarder } from './caviardage';

// Construit la clause EXISTS d'une jointure, en remontant récursivement la
// chaîne `via` jusqu'au parent qui porte réellement group_id — c'est là,
// et seulement là, qu'un `?` est posé. `callerAlias` est l'alias de la
// table qui référence ce parent (la table courante `c` au premier niveau,
// puis l'alias du parent précédent à chaque cran de `via`) : `cleLocale`
// désigne une colonne de CETTE table référençante, pas du parent lui-même.
function clauseJointure(j: Jointure, callerAlias: string, profondeur: number): string {
  const alias = `p${profondeur}`;
  const condition = `${alias}.${j.cleParent} = ${callerAlias}.${j.cleLocale}`;
  const suite = j.via ? clauseJointure(j.via, alias, profondeur + 1) : `${alias}.group_id = ?`;
  return `EXISTS (SELECT 1 FROM ${j.table} ${alias} WHERE ${condition} AND ${suite})`;
}

export function sqlPourTable(t: TableExport): { sql: string; args: (groupId: string) => string[] } {
  switch (t.regime) {
    case 'racine':
      return { sql: `SELECT * FROM ${t.nom} WHERE id = ?`, args: (g) => [g] };
    case 'global':
      return { sql: `SELECT * FROM ${t.nom}`, args: () => [] };
    case 'group_id':
      return { sql: `SELECT * FROM ${t.nom} WHERE group_id = ?`, args: (g) => [g] };
    case 'par_fk': {
      if (!t.parents || t.parents.length === 0) {
        throw new Error(`Table ${t.nom} en régime 'par_fk' sans parent déclaré`);
      }
      const parents = t.parents;
      // Union : la ligne est retenue si AU MOINS UNE jointure la rattache
      // au groupe. Chaque branche repart d'un alias `p0` propre — les
      // branches sont des sous-requêtes indépendantes, pas de collision.
      const clauses = parents.map((p) => clauseJointure(p, 'c', 0));
      return {
        sql: `SELECT c.* FROM ${t.nom} c WHERE ${clauses.join(' OR ')}`,
        // Une jointure = un `?` (posé au niveau qui porte group_id), quel
        // que soit son nombre de crans `via`.
        args: (g) => parents.map(() => g),
      };
    }
  }
}

export async function collecterTable(
  db: DbWrapper,
  groupId: string,
  t: TableExport,
  options: { caviarder?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const { sql, args } = sqlPourTable(t);
  const rows = await db.prepare(sql).all<Record<string, unknown>>(...args(groupId));
  return options.caviarder ? rows.map((r) => caviarder(t.nom, r)) : rows;
}
