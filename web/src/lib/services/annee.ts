import { getDb, type DbWrapper } from '../db';
import { formatAmount } from '../format';
import { CATEGORIES_HORS_RESULTAT, currentExercice, exerciceBounds } from './overview';

// Vue « Année » : le réalisé d'un exercice par unité, hors camps.
//
// Pendant de la page Camps, mais calculée — pas d'entité à créer. Un camp est
// un objet du monde réel (il a un nom, des dates, un budget propre) ; « l'année
// d'une unité », non : c'est tout ce qui n'est pas un camp sur l'exercice. Donc
// rien à saisir, la vue se déduit des écritures. Cf. issue #19, dont le design
// initial passait par des entités `camps.type='annee'` — écarté pour ça.
//
// L'exclusion est PARAMÉTRIQUE (liste d'activite_id), jamais codée sur un nom :
// chaque groupe nomme ses activités comme il veut. `defaultActivitesExcluesIds`
// ne fournit qu'une amorce raisonnable, que l'UI laisse ajuster.

export interface AnneeContext {
  groupId: string;
}

export interface Bornes {
  start: string;
  end: string;
}

export interface AnneeUniteRow {
  /** null = écritures non imputées à une unité. */
  unite_id: string | null;
  code: string | null;
  name: string;
  couleur: string | null;
  recettes: number;
  depenses: number;
  solde: number;
  nb: number;
  /** Sous-ensemble de `nb` encore en brouillon → chiffre non définitif. */
  nb_drafts: number;
}

export interface AnneeActiviteRow {
  activite_id: string | null;
  activite_name: string;
  recettes: number;
  depenses: number;
  nb: number;
}

export interface AnneeData {
  exercice: string;
  bornes: Bornes;
  activitesExclues: { id: string; name: string }[];
  parUnite: AnneeUniteRow[];
  totalRecettes: number;
  totalDepenses: number;
  solde: number;
  totalRecettesFormatted: string;
  totalDepensesFormatted: string;
  soldeFormatted: string;
  /** Brouillons dans le périmètre : le total n'est pas définitif tant qu'ils traînent. */
  nbDrafts: number;
  /** Dernier import CSV Comptaweb — dit jusqu'où les données vont réellement. */
  dernierImport: { date: string; fichier: string } | null;
  /** Date de la dernière écriture du périmètre : borne haute réelle des données. */
  derniereEcriture: string | null;
}

/**
 * Amorce d'exclusion : les activités qui évoquent un camp. Heuristique de
 * confort uniquement — l'UI reste maîtresse de la liste finale.
 */
export function defaultActivitesExcluesIds(
  activites: { id: string; name: string | null }[],
): string[] {
  return activites.filter((a) => /camp/i.test(a.name ?? '')).map((a) => a.id);
}

/**
 * Clause SQL commune : périmètre « année » (exercice, hors camps, hors
 * transferts). À appeler avec `perimetreValues` — même ordre de paramètres.
 */
function perimetreSql(excludeActiviteIds: string[]): string {
  // Une écriture SANS activité reste dans le périmètre : c'est typiquement un
  // draft bancaire pas encore imputé, et le masquer donnerait un total faux
  // sans que rien ne le signale.
  const horsActivites = excludeActiviteIds.length
    ? ` AND (e.activite_id IS NULL OR e.activite_id NOT IN (${excludeActiviteIds.map(() => '?').join(',')}))`
    : '';
  const horsResultat = ` AND (e.category_id IS NULL OR e.category_id NOT IN (${CATEGORIES_HORS_RESULTAT.map(() => '?').join(',')}))`;
  return ` AND e.date_ecriture >= ? AND e.date_ecriture <= ?${horsActivites}${horsResultat}`;
}

function perimetreValues(bornes: Bornes, excludeActiviteIds: string[]): unknown[] {
  return [bornes.start, bornes.end, ...excludeActiviteIds, ...CATEGORIES_HORS_RESULTAT];
}

const AGG = `
  COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) AS recettes,
  COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) AS depenses,
  COUNT(*) AS nb,
  COALESCE(SUM(CASE WHEN e.status = 'draft' THEN 1 ELSE 0 END), 0) AS nb_drafts
`;

/**
 * Agrégats par unité, directement depuis les écritures — donc les non imputées
 * (unite_id NULL) ressortent sous `unite_id: null` au lieu de disparaître.
 * Les unités sans écriture ne sont PAS ici : cf. `buildAnneeRows`.
 */
export async function selectAnneeParUnite(
  db: DbWrapper,
  groupId: string,
  bornes: Bornes,
  excludeActiviteIds: string[],
): Promise<Omit<AnneeUniteRow, 'code' | 'name' | 'couleur'>[]> {
  const sql = perimetreSql(excludeActiviteIds);
  const rows = await db.prepare(`
    SELECT e.unite_id, ${AGG}
    FROM ecritures e
    WHERE e.group_id = ?${sql}
    GROUP BY e.unite_id
  `).all<{ unite_id: string | null; recettes: number; depenses: number; nb: number; nb_drafts: number }>(
    groupId,
    ...perimetreValues(bornes, excludeActiviteIds),
  );
  return rows.map((r) => ({ ...r, solde: r.recettes - r.depenses }));
}

/** Détail d'une unité par activité. `uniteId === null` → les non imputées. */
export async function selectAnneeParActivite(
  db: DbWrapper,
  groupId: string,
  bornes: Bornes,
  excludeActiviteIds: string[],
  uniteId: string | null,
): Promise<AnneeActiviteRow[]> {
  const sql = perimetreSql(excludeActiviteIds);
  const uniteClause = uniteId === null ? 'e.unite_id IS NULL' : 'e.unite_id = ?';
  const uniteValues = uniteId === null ? [] : [uniteId];
  const rows = await db.prepare(`
    SELECT e.activite_id, a.name AS activite_name, ${AGG}
    FROM ecritures e
    LEFT JOIN activites a ON a.id = e.activite_id
    WHERE e.group_id = ? AND ${uniteClause}${sql}
    GROUP BY e.activite_id
    ORDER BY (recettes + depenses) DESC
  `).all<{ activite_id: string | null; activite_name: string | null; recettes: number; depenses: number; nb: number; nb_drafts: number }>(
    groupId,
    ...uniteValues,
    ...perimetreValues(bornes, excludeActiviteIds),
  );
  return rows.map((r) => ({
    activite_id: r.activite_id,
    activite_name: r.activite_name ?? '(sans activité)',
    recettes: r.recettes,
    depenses: r.depenses,
    nb: r.nb,
  }));
}

export interface AnneeEcritureRow {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  status: string;
  activite_name: string | null;
  category_name: string | null;
}

/** Écritures du périmètre pour une unité, plus récentes d'abord. */
export async function selectAnneeEcritures(
  db: DbWrapper,
  groupId: string,
  bornes: Bornes,
  excludeActiviteIds: string[],
  uniteId: string | null,
): Promise<AnneeEcritureRow[]> {
  const sql = perimetreSql(excludeActiviteIds);
  const uniteClause = uniteId === null ? 'e.unite_id IS NULL' : 'e.unite_id = ?';
  const uniteValues = uniteId === null ? [] : [uniteId];
  return db.prepare(`
    SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type, e.status,
           a.name AS activite_name, c.name AS category_name
    FROM ecritures e
    LEFT JOIN activites a ON a.id = e.activite_id
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.group_id = ? AND ${uniteClause}${sql}
    ORDER BY e.date_ecriture DESC, e.id
  `).all<AnneeEcritureRow>(groupId, ...uniteValues, ...perimetreValues(bornes, excludeActiviteIds));
}

/**
 * Lignes prêtes à afficher : toutes les unités du groupe (même à zéro — une
 * unité qui n'a rien dépensé est une information), puis les non imputées.
 */
export async function buildAnneeRows(
  db: DbWrapper,
  groupId: string,
  bornes: Bornes,
  excludeActiviteIds: string[],
): Promise<AnneeUniteRow[]> {
  const [agg, unites] = await Promise.all([
    selectAnneeParUnite(db, groupId, bornes, excludeActiviteIds),
    db.prepare('SELECT id, code, name, couleur FROM unites WHERE group_id = ? ORDER BY code')
      .all<{ id: string; code: string; name: string; couleur: string | null }>(groupId),
  ]);

  const byUnite = new Map(agg.filter((a) => a.unite_id !== null).map((a) => [a.unite_id as string, a]));
  const vide = { recettes: 0, depenses: 0, solde: 0, nb: 0, nb_drafts: 0 };

  const rows: AnneeUniteRow[] = unites.map((u) => {
    const a = byUnite.get(u.id);
    return {
      unite_id: u.id,
      code: u.code,
      name: u.name,
      couleur: u.couleur,
      recettes: a?.recettes ?? vide.recettes,
      depenses: a?.depenses ?? vide.depenses,
      solde: a?.solde ?? vide.solde,
      nb: a?.nb ?? vide.nb,
      nb_drafts: a?.nb_drafts ?? vide.nb_drafts,
    };
  });

  const orphelines = agg.find((a) => a.unite_id === null);
  if (orphelines && orphelines.nb > 0) {
    rows.push({
      unite_id: null,
      code: null,
      name: 'Non imputé',
      couleur: null,
      recettes: orphelines.recettes,
      depenses: orphelines.depenses,
      solde: orphelines.solde,
      nb: orphelines.nb,
      nb_drafts: orphelines.nb_drafts,
    });
  }
  return rows;
}

export async function getAnneeOverview(
  { groupId }: AnneeContext,
  filters: { exercice?: string | null; excludeActiviteIds?: string[] } = {},
): Promise<AnneeData> {
  const db = getDb();
  const exercice = filters.exercice ?? currentExercice();
  const bornes = exerciceBounds(exercice);
  const excludeActiviteIds = filters.excludeActiviteIds ?? [];

  const [parUnite, exclues, dernierImport, derniere] = await Promise.all([
    buildAnneeRows(db, groupId, bornes, excludeActiviteIds),
    excludeActiviteIds.length
      ? db.prepare(
          `SELECT id, name FROM activites WHERE id IN (${excludeActiviteIds.map(() => '?').join(',')})`,
        ).all<{ id: string; name: string }>(...excludeActiviteIds)
      : Promise.resolve([]),
    db.prepare(
      'SELECT import_date AS date, source_file AS fichier FROM comptaweb_imports WHERE group_id = ? ORDER BY import_date DESC LIMIT 1',
    ).get<{ date: string; fichier: string }>(groupId),
    db.prepare(
      'SELECT MAX(date_ecriture) AS d FROM ecritures WHERE group_id = ? AND date_ecriture >= ? AND date_ecriture <= ?',
    ).get<{ d: string | null }>(groupId, bornes.start, bornes.end),
  ]);

  const totalRecettes = parUnite.reduce((s, r) => s + r.recettes, 0);
  const totalDepenses = parUnite.reduce((s, r) => s + r.depenses, 0);
  const solde = totalRecettes - totalDepenses;

  return {
    exercice,
    bornes,
    activitesExclues: exclues,
    parUnite,
    totalRecettes,
    totalDepenses,
    solde,
    totalRecettesFormatted: formatAmount(totalRecettes),
    totalDepensesFormatted: formatAmount(totalDepenses),
    soldeFormatted: formatAmount(solde),
    nbDrafts: parUnite.reduce((s, r) => s + r.nb_drafts, 0),
    dernierImport: dernierImport ?? null,
    derniereEcriture: derniere?.d ?? null,
  };
}
