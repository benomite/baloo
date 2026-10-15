// Logique de synchronisation des référentiels Comptaweb vers la BDD locale.
// Prend les options renvoyées par fetchReferentielsCreer et applique les upserts :
//   brancheprojet  → unites
//   nature         → categories
//   activite       → activites
//   modetransaction → modes_paiement
//
// Politique : additive uniquement. Match par comptaweb_id en priorité, fallback
// sur name normalisé. Les entrées locales avec un comptaweb_id qui n'existe
// plus côté CW sont signalées comme orphelines mais jamais supprimées.
//
// Unités et activités (ADR-041) : Comptaweb les RENUMÉROTE à chaque exercice
// (« Groupe » = 904730 en 2025-2026, 1001727 en 2026-2027). Leur identité
// locale est donc le NOM, et leurs IDs CW sont tenus par exercice dans
// `referentiels_cw_exercice`. `unites.comptaweb_id` / `activites.comptaweb_id`
// ne gardent que le dernier ID vu : un marqueur « connu de Comptaweb », jamais
// l'ID à envoyer. Natures, modes et cartes ont des IDs stables : inchangés.

import type { DbWrapper } from '../db';
import type { RefOption } from './types';
import type { ScrapedCarte } from './cartes-scrape';
import { inferBrancheSGDF } from '../branches-sgdf';

export interface RefSyncStats {
  ajoutees: number;
  mappees: number;
  inchangees: number;
  orphelines: string[]; // ids locaux avec comptaweb_id introuvable côté CW
}

export interface SyncReferentielsReport {
  unites: RefSyncStats;
  categories: RefSyncStats;
  activites: RefSyncStats;
  modes_paiement: RefSyncStats;
  cartes: RefSyncStats;
}

export interface ReferentielsInput {
  brancheprojet: RefOption[];
  nature: RefOption[];
  activite: RefOption[];
  modetransaction: RefOption[];
  cartes: ScrapedCarte[];
}

function normalise(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Couleurs officielles SGDF par branche — permet d'auto-assigner la couleur
// à la création d'une unité pour l'affichage graphique.
const UNITE_COULEURS: Array<[RegExp, string]> = [
  [/farfadets?/i, '#E8485F'],
  [/louveteaux.jeannettes?/i, '#F39200'],
  [/scouts.guides?/i, '#0082BE'],
  [/pionniers.caravelles?/i, '#7D1C2F'],
  [/compagnons?/i, '#00934D'],
  [/impeesas?/i, '#9B4A97'],
  [/^groupe$/i, '#4A4A4A'],
  [/ajustements?/i, '#B0B0B0'],
];

function inferCouleurUnite(label: string): string | null {
  for (const [re, color] of UNITE_COULEURS) {
    if (re.test(label)) return color;
  }
  return null;
}

// Code court pour une nouvelle unité : initiales des mots majusculées, sinon
// 2 premières lettres. Collision résolue par un suffixe numérique.
function deriveUniteCode(label: string, existingCodes: Set<string>): string {
  const clean = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
  const words = clean.split(/[\s\-']+/).filter(Boolean);
  let base: string;
  if (words.length >= 2) {
    base = words
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 3)
      .toUpperCase();
  } else {
    base = (words[0] ?? '').slice(0, 2).toUpperCase() || 'X';
  }
  if (!existingCodes.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`;
    if (!existingCodes.has(candidate)) return candidate;
  }
  return `${base}${Date.now().toString().slice(-3)}`;
}

async function uniqueId(db: DbWrapper, table: string, wanted: string): Promise<string> {
  let id = wanted;
  const check = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
  for (let i = 2; await check.get(id); i++) {
    id = `${wanted}-${i}`;
    if (i > 100) throw new Error(`Impossible de générer un id unique pour ${wanted} dans ${table}`);
  }
  return id;
}

// Collecte les orphelines : local rows avec comptaweb_id NOT NULL absent de cwIds.
async function findOrphelines(
  db: DbWrapper,
  table: string,
  cwIds: Set<number>,
): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT id, comptaweb_id FROM ${table} WHERE comptaweb_id IS NOT NULL`)
    .all<{ id: string; comptaweb_id: number }>();
  return rows.filter((r) => !cwIds.has(r.comptaweb_id)).map((r) => r.id);
}

export type ReferentielKind = 'unite' | 'activite';

/** ID Comptaweb d'une unité/activité locale pour un exercice, ou null si non mappée. */
export async function lookupReferentielCwId(
  db: DbWrapper,
  kind: ReferentielKind,
  localId: string | null | undefined,
  exercice: string,
): Promise<number | null> {
  if (!localId) return null;
  const row = await db
    .prepare('SELECT comptaweb_id FROM referentiels_cw_exercice WHERE kind = ? AND local_id = ? AND exercice = ?')
    .get<{ comptaweb_id: number }>(kind, localId, exercice);
  return row?.comptaweb_id ?? null;
}

// Mapping d'une option CW (unité ou activité) vers sa ligne locale, pour un
// exercice : 1) mapping déjà tenu pour cet exercice, 2) colonne historique
// comptaweb_id, 3) nom normalisé — quel que soit le comptaweb_id porté, puisque
// celui-ci peut être l'ID d'un autre exercice. Une ligne locale ne reçoit
// qu'une option par exercice : deux options homonymes restent deux lignes.
async function resoudreLigneLocale(
  db: DbWrapper,
  table: 'unites' | 'activites',
  kind: ReferentielKind,
  groupId: string,
  exercice: string,
  cwId: number,
  label: string,
  dejaPrises: Set<string>,
  nomsEquivalents: (a: string, b: string) => boolean,
): Promise<{ id: string; via: 'mapping' | 'colonne' | 'nom' } | null> {
  const parMapping = await db
    .prepare(
      'SELECT local_id FROM referentiels_cw_exercice WHERE kind = ? AND group_id = ? AND exercice = ? AND comptaweb_id = ? LIMIT 1',
    )
    .get<{ local_id: string }>(kind, groupId, exercice, cwId);
  if (parMapping && !dejaPrises.has(parMapping.local_id)) return { id: parMapping.local_id, via: 'mapping' };

  const parColonne = await db
    .prepare(`SELECT id FROM ${table} WHERE group_id = ? AND comptaweb_id = ? ORDER BY created_at, id`)
    .all<{ id: string }>(groupId, cwId);
  const libreColonne = parColonne.find((r) => !dejaPrises.has(r.id));
  if (libreColonne) return { id: libreColonne.id, via: 'colonne' };

  const target = normalise(label);
  const candidats = await db
    .prepare(`SELECT id, name FROM ${table} WHERE group_id = ? ORDER BY created_at, id`)
    .all<{ id: string; name: string }>(groupId);
  const parNom = candidats.find((c) => !dejaPrises.has(c.id) && nomsEquivalents(normalise(c.name), target));
  if (parNom) return { id: parNom.id, via: 'nom' };
  return null;
}

async function enregistrerMapping(
  db: DbWrapper,
  kind: ReferentielKind,
  localId: string,
  groupId: string,
  exercice: string,
  cwId: number,
  now: string,
): Promise<boolean> {
  const actuel = await lookupReferentielCwId(db, kind, localId, exercice);
  if (actuel === cwId) return false;
  await db
    .prepare(
      `INSERT INTO referentiels_cw_exercice (kind, local_id, exercice, group_id, comptaweb_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, local_id, exercice) DO UPDATE SET comptaweb_id = excluded.comptaweb_id, updated_at = excluded.updated_at`,
    )
    .run(kind, localId, exercice, groupId, cwId, now);
  return true;
}

// Lignes du groupe connues de Comptaweb mais absentes de cet exercice.
async function orphelinesExercice(
  db: DbWrapper,
  table: 'unites' | 'activites',
  groupId: string,
  vues: Set<string>,
): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT id FROM ${table} WHERE group_id = ? AND comptaweb_id IS NOT NULL`)
    .all<{ id: string }>(groupId);
  return rows.filter((r) => !vues.has(r.id)).map((r) => r.id);
}

const unitesEquivalentes = (n: string, target: string) => n === target || n + 's' === target || n === target + 's';
const activitesEquivalentes = (n: string, target: string) => n === target;

async function syncUnites(
  db: DbWrapper,
  groupId: string,
  options: RefOption[],
  now: string,
  exercice: string,
): Promise<RefSyncStats> {
  const stats: RefSyncStats = { ajoutees: 0, mappees: 0, inchangees: 0, orphelines: [] };
  const vues = new Set<string>();
  const existingCodesRows = await db.prepare('SELECT code FROM unites WHERE group_id = ?').all<{ code: string }>(groupId);
  const existingCodes = new Set(existingCodesRows.map((r) => r.code));

  const getUnite = db.prepare('SELECT branche, couleur FROM unites WHERE id = ?');
  const updateCwId = db.prepare('UPDATE unites SET comptaweb_id = ? WHERE id = ?');
  const updateBrancheCouleur = db.prepare(
    'UPDATE unites SET branche = ?, couleur = ? WHERE id = ?',
  );
  const insertUnite = db.prepare(
    'INSERT INTO unites (id, group_id, code, name, comptaweb_id, couleur, branche, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );

  for (const opt of options) {
    const cwId = Number(opt.value);
    if (!Number.isFinite(cwId) || !opt.label) continue;

    // Détection de la branche SGDF (Farfadets, LJ, SG…) à partir du
    // label de l'unité Comptaweb. Plusieurs unités peuvent partager la
    // même branche (couleur).
    const brancheSpec = inferBrancheSGDF(opt.label);

    const local = await resoudreLigneLocale(
      db, 'unites', 'unite', groupId, exercice, cwId, opt.label, vues, unitesEquivalentes,
    );
    if (local) {
      vues.add(local.id);
      const change = await enregistrerMapping(db, 'unite', local.id, groupId, exercice, cwId, now);
      await updateCwId.run(cwId, local.id);
      // Rétro-fix : si l'unité avait été créée sans branche (legacy) ou
      // avec une couleur stale, on la met à jour.
      const existing = await getUnite.get<{ branche: string | null; couleur: string | null }>(local.id);
      if (brancheSpec && (existing?.branche !== brancheSpec.code || !existing?.couleur)) {
        await updateBrancheCouleur.run(brancheSpec.code, brancheSpec.couleur, local.id);
      }
      if (change) stats.mappees++;
      else stats.inchangees++;
      continue;
    }

    const code = deriveUniteCode(opt.label, existingCodes);
    existingCodes.add(code);
    const id = await uniqueId(db, 'unites', `u-${groupId}-${slugify(opt.label)}`);
    await insertUnite.run(
      id,
      groupId,
      code,
      opt.label,
      cwId,
      brancheSpec?.couleur ?? inferCouleurUnite(opt.label),
      brancheSpec?.code ?? null,
      now,
    );
    await enregistrerMapping(db, 'unite', id, groupId, exercice, cwId, now);
    vues.add(id);
    stats.ajoutees++;
  }

  stats.orphelines = await orphelinesExercice(db, 'unites', groupId, vues);
  return stats;
}

async function syncCategories(db: DbWrapper, options: RefOption[], now: string): Promise<RefSyncStats> {
  const stats: RefSyncStats = { ajoutees: 0, mappees: 0, inchangees: 0, orphelines: [] };
  const cwIds = new Set<number>();

  const getByCwId = db.prepare('SELECT id FROM categories WHERE comptaweb_id = ? LIMIT 1');
  const getByLabel = db.prepare(
    'SELECT id, name, comptaweb_nature FROM categories WHERE comptaweb_id IS NULL',
  );
  const updateCwId = db.prepare('UPDATE categories SET comptaweb_id = ?, comptaweb_nature = ? WHERE id = ?');
  const insertCat = db.prepare(
    "INSERT INTO categories (id, name, type, comptaweb_nature, comptaweb_id, created_at) VALUES (?, ?, 'les_deux', ?, ?, ?)",
  );

  for (const opt of options) {
    const cwId = Number(opt.value);
    if (!Number.isFinite(cwId) || !opt.label) continue;
    cwIds.add(cwId);

    if (await getByCwId.get(cwId)) {
      stats.inchangees++;
      continue;
    }

    const target = normalise(opt.label);
    const candidates = await getByLabel.all<{ id: string; name: string; comptaweb_nature: string | null }>();
    const matched = candidates.find(
      (c) => normalise(c.comptaweb_nature) === target || normalise(c.name) === target,
    );
    if (matched) {
      await updateCwId.run(cwId, opt.label, matched.id);
      stats.mappees++;
      continue;
    }

    const id = await uniqueId(db, 'categories', `cat-${slugify(opt.label)}`);
    await insertCat.run(id, opt.label, opt.label, cwId, now);
    stats.ajoutees++;
  }

  stats.orphelines = await findOrphelines(db, 'categories', cwIds);
  return stats;
}

async function syncActivites(
  db: DbWrapper,
  groupId: string,
  options: RefOption[],
  now: string,
  exercice: string,
): Promise<RefSyncStats> {
  const stats: RefSyncStats = { ajoutees: 0, mappees: 0, inchangees: 0, orphelines: [] };
  const vues = new Set<string>();

  const updateCwId = db.prepare('UPDATE activites SET comptaweb_id = ? WHERE id = ?');
  const insertAct = db.prepare(
    'INSERT INTO activites (id, group_id, name, comptaweb_id, created_at) VALUES (?, ?, ?, ?, ?)',
  );

  for (const opt of options) {
    const cwId = Number(opt.value);
    if (!Number.isFinite(cwId) || !opt.label) continue;

    const local = await resoudreLigneLocale(
      db, 'activites', 'activite', groupId, exercice, cwId, opt.label, vues, activitesEquivalentes,
    );
    if (local) {
      vues.add(local.id);
      const change = await enregistrerMapping(db, 'activite', local.id, groupId, exercice, cwId, now);
      await updateCwId.run(cwId, local.id);
      if (change) stats.mappees++;
      else stats.inchangees++;
      continue;
    }

    const id = await uniqueId(db, 'activites', `act-${groupId}-${slugify(opt.label)}`);
    await insertAct.run(id, groupId, opt.label, cwId, now);
    await enregistrerMapping(db, 'activite', id, groupId, exercice, cwId, now);
    vues.add(id);
    stats.ajoutees++;
  }

  stats.orphelines = await orphelinesExercice(db, 'activites', groupId, vues);
  return stats;
}

async function syncModes(db: DbWrapper, options: RefOption[], now: string): Promise<RefSyncStats> {
  const stats: RefSyncStats = { ajoutees: 0, mappees: 0, inchangees: 0, orphelines: [] };
  const cwIds = new Set<number>();

  const getByCwId = db.prepare('SELECT id FROM modes_paiement WHERE comptaweb_id = ? LIMIT 1');
  const getByName = db.prepare(
    'SELECT id, name FROM modes_paiement WHERE comptaweb_id IS NULL',
  );
  const updateCwId = db.prepare('UPDATE modes_paiement SET comptaweb_id = ? WHERE id = ?');
  const insertMode = db.prepare(
    'INSERT INTO modes_paiement (id, name, comptaweb_id, created_at) VALUES (?, ?, ?, ?)',
  );

  for (const opt of options) {
    const cwId = Number(opt.value);
    if (!Number.isFinite(cwId) || !opt.label) continue;
    cwIds.add(cwId);

    if (await getByCwId.get(cwId)) {
      stats.inchangees++;
      continue;
    }

    const target = normalise(opt.label);
    const candidates = await getByName.all<{ id: string; name: string }>();
    const matched = candidates.find((c) => normalise(c.name) === target);
    if (matched) {
      await updateCwId.run(cwId, matched.id);
      stats.mappees++;
      continue;
    }

    const id = await uniqueId(db, 'modes_paiement', `mp-${slugify(opt.label)}`);
    await insertMode.run(id, opt.label, cwId, now);
    stats.ajoutees++;
  }

  stats.orphelines = await findOrphelines(db, 'modes_paiement', cwIds);
  return stats;
}

async function syncCartes(
  db: DbWrapper,
  groupId: string,
  cartes: ScrapedCarte[],
  now: string,
): Promise<RefSyncStats> {
  const stats: RefSyncStats = { ajoutees: 0, mappees: 0, inchangees: 0, orphelines: [] };
  const cwIds = new Set<number>();

  const getByCwId = db.prepare(
    'SELECT id, type, porteur, code_externe, statut FROM cartes WHERE comptaweb_id = ? AND group_id = ? LIMIT 1',
  );
  const insertCarte = db.prepare(
    `INSERT INTO cartes (id, group_id, type, porteur, comptaweb_id, code_externe, statut, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateCarte = db.prepare(
    `UPDATE cartes SET porteur = ?, code_externe = ?, statut = ?, updated_at = ? WHERE id = ?`,
  );

  for (const c of cartes) {
    cwIds.add(c.comptawebId);

    const existing = await getByCwId.get<{ id: string; type: string; porteur: string; code_externe: string | null; statut: string }>(c.comptawebId, groupId);

    if (existing) {
      if (
        existing.porteur !== c.porteur
        || (existing.code_externe ?? null) !== (c.codeExterne ?? null)
        || existing.statut !== c.statut
      ) {
        await updateCarte.run(c.porteur, c.codeExterne, c.statut, now, existing.id);
        stats.mappees++;
      } else {
        stats.inchangees++;
      }
      continue;
    }

    const base = `carte-${c.type === 'procurement' ? 'proc' : 'cb'}-${slugify(c.porteur)}`;
    const id = await uniqueId(db, 'cartes', base);
    await insertCarte.run(id, groupId, c.type, c.porteur, c.comptawebId, c.codeExterne, c.statut, now, now);
    stats.ajoutees++;
  }

  const orphelinesAll = await findOrphelines(db, 'cartes', cwIds);
  const filteredOrphelines: string[] = [];
  for (const id of orphelinesAll) {
    const row = await db.prepare('SELECT group_id FROM cartes WHERE id = ?').get<{ group_id: string }>(id);
    if (row?.group_id === groupId) filteredOrphelines.push(id);
  }
  stats.orphelines = filteredOrphelines;
  return stats;
}

/**
 * Applique les référentiels lus dans la session Comptaweb de `exercice`
 * ('2026-2027'). Les IDs d'unités et d'activités sont enregistrés pour CET
 * exercice : les référentiels d'une session ne disent rien des autres.
 */
export async function applyReferentielsSync(
  db: DbWrapper,
  groupId: string,
  refs: ReferentielsInput,
  now: string,
  exercice: string,
): Promise<SyncReferentielsReport> {
  return await db.transaction(async (txDb) => ({
    unites: await syncUnites(txDb, groupId, refs.brancheprojet, now, exercice),
    categories: await syncCategories(txDb, refs.nature, now),
    activites: await syncActivites(txDb, groupId, refs.activite, now, exercice),
    modes_paiement: await syncModes(txDb, refs.modetransaction, now),
    cartes: await syncCartes(txDb, groupId, refs.cartes, now),
  }));
}

export interface FusionReport {
  /** 'table:id' des doublons retirés. */
  fusionnees: string[];
  /** 'table:id' des doublons gardés faute de pouvoir tout rattacher sans perte. */
  bloquees: string[];
}

// Colonnes qui pointent vers `table` (FK déclarées), découvertes dans le schéma
// réel : couvre aussi les tables créées en lazy-init par leur service.
async function colonnesReferencant(db: DbWrapper, table: string): Promise<Array<{ table: string; col: string }>> {
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all<{ name: string }>();
  const out: Array<{ table: string; col: string }> = [];
  for (const t of tables) {
    const fks = await db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all<{ table: string; from: string }>();
    for (const fk of fks) if (fk.table === table) out.push({ table: t.name, col: fk.from });
  }
  return out;
}

async function rattacher(
  db: DbWrapper,
  refs: Array<{ table: string; col: string }>,
  doublon: string,
  garde: string,
): Promise<boolean> {
  for (const { table, col } of refs) {
    await db.prepare(`UPDATE OR IGNORE "${table}" SET "${col}" = ? WHERE "${col}" = ?`).run(garde, doublon);
    // Une ligne restée sur le doublon a heurté une contrainte d'unicité. Elle
    // n'est retirée que si elle est l'exacte copie d'une ligne déjà rattachée
    // (ex. user_unites : l'utilisateur avait les deux exemplaires) — sinon on
    // garde tout et le doublon reste en place.
    const cols = await db.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
    const autres = cols.map((c) => c.name).filter((n) => n !== col);
    const identique = autres.map((n) => `t2."${n}" IS t."${n}"`).join(' AND ');
    await db
      .prepare(
        `DELETE FROM "${table}" AS t WHERE t."${col}" = ? AND EXISTS (
           SELECT 1 FROM "${table}" t2 WHERE t2."${col}" = ?${identique ? ` AND ${identique}` : ''})`,
      )
      .run(doublon, garde);
    const reste = await db
      .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${col}" = ?`)
      .get<{ n: number }>(doublon);
    if ((reste?.n ?? 0) > 0) return false;
  }
  return true;
}

/**
 * Répare les unités/activités dupliquées par l'ancienne sync des référentiels
 * au passage d'exercice (ADR-041). Pour chaque groupe, les lignes connues de
 * Comptaweb (comptaweb_id renseigné) de même nom normalisé sont fusionnées dans
 * la plus ancienne : toutes les références y sont rattachées, puis le doublon,
 * devenu vide, est retiré. Les IDs CW par exercice seront reposés par la
 * prochaine sync des référentiels. Les lignes purement locales ne sont jamais
 * touchées. Idempotent.
 */
export async function fusionnerDoublonsReferentiels(db: DbWrapper): Promise<FusionReport> {
  const report: FusionReport = { fusionnees: [], bloquees: [] };
  for (const table of ['unites', 'activites'] as const) {
    const rows = await db
      .prepare(`SELECT id, group_id, name FROM ${table} WHERE comptaweb_id IS NOT NULL ORDER BY created_at, id`)
      .all<{ id: string; group_id: string; name: string }>();
    const parCle = new Map<string, string[]>();
    for (const r of rows) {
      const cle = `${r.group_id}|${normalise(r.name)}`;
      parCle.set(cle, [...(parCle.get(cle) ?? []), r.id]);
    }
    const groupes = [...parCle.values()].filter((ids) => ids.length > 1);
    if (groupes.length === 0) continue;

    const refs = await colonnesReferencant(db, table);
    const kind: ReferentielKind = table === 'unites' ? 'unite' : 'activite';
    for (const [garde, ...doublons] of groupes) {
      for (const doublon of doublons) {
        const ok = await db.transaction(async (tx) => {
          if (!(await rattacher(tx, refs, doublon, garde))) return false;
          // Les mappings par exercice du doublon ne sont pas transférés : la
          // prochaine sync les repose sur la ligne gardée.
          await tx.prepare('DELETE FROM referentiels_cw_exercice WHERE kind = ? AND local_id = ?').run(kind, doublon);
          await tx.prepare(`DELETE FROM ${table} WHERE id = ?`).run(doublon);
          return true;
        });
        (ok ? report.fusionnees : report.bloquees).push(`${table}:${doublon}`);
      }
    }
  }
  return report;
}
