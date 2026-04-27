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

import type Database from 'better-sqlite3';
import type { RefOption } from './types';
import type { ScrapedCarte } from './cartes-scrape';

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
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
    .replace(/[\u0300-\u036f]/g, '')
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

function uniqueId(db: Database.Database, table: string, wanted: string): string {
  let id = wanted;
  const check = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
  for (let i = 2; check.get(id); i++) {
    id = `${wanted}-${i}`;
    if (i > 100) throw new Error(`Impossible de générer un id unique pour ${wanted} dans ${table}`);
  }
  return id;
}

// Collecte les orphelines : local rows avec comptaweb_id NOT NULL absent de cwIds.
function findOrphelines(
  db: Database.Database,
  table: string,
  cwIds: Set<number>,
): string[] {
  const rows = db
    .prepare(`SELECT id, comptaweb_id FROM ${table} WHERE comptaweb_id IS NOT NULL`)
    .all() as Array<{ id: string; comptaweb_id: number }>;
  return rows.filter((r) => !cwIds.has(r.comptaweb_id)).map((r) => r.id);
}

function syncUnites(
  db: Database.Database,
  groupId: string,
  options: RefOption[],
  now: string,
): RefSyncStats {
  const stats: RefSyncStats = { ajoutees: 0, mappees: 0, inchangees: 0, orphelines: [] };
  const cwIds = new Set<number>();
  const existingCodes = new Set(
    (db.prepare('SELECT code FROM unites WHERE group_id = ?').all(groupId) as Array<{ code: string }>).map(
      (r) => r.code,
    ),
  );

  const getByCwId = db.prepare('SELECT id FROM unites WHERE comptaweb_id = ? AND group_id = ? LIMIT 1');
  const getByName = db.prepare(
    'SELECT id, name FROM unites WHERE group_id = ? AND comptaweb_id IS NULL',
  );
  const updateCwId = db.prepare('UPDATE unites SET comptaweb_id = ? WHERE id = ?');
  const insertUnite = db.prepare(
    'INSERT INTO unites (id, group_id, code, name, comptaweb_id, couleur, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  for (const opt of options) {
    const cwId = Number(opt.value);
    if (!Number.isFinite(cwId) || !opt.label) continue;
    cwIds.add(cwId);

    if (getByCwId.get(cwId, groupId)) {
      stats.inchangees++;
      continue;
    }

    // Fallback : match par name normalisé (avec tolérance s/singulier).
    const target = normalise(opt.label);
    const candidates = getByName.all(groupId) as Array<{ id: string; name: string }>;
    const matched = candidates.find((c) => {
      const n = normalise(c.name);
      return n === target || n + 's' === target || n === target + 's';
    });
    if (matched) {
      updateCwId.run(cwId, matched.id);
      stats.mappees++;
      continue;
    }

    const code = deriveUniteCode(opt.label, existingCodes);
    existingCodes.add(code);
    const id = uniqueId(db, 'unites', `u-${groupId}-${slugify(opt.label)}`);
    insertUnite.run(id, groupId, code, opt.label, cwId, inferCouleurUnite(opt.label), now);
    stats.ajoutees++;
  }

  stats.orphelines = findOrphelines(db, 'unites', cwIds).filter((id) => {
    // On ne remonte comme orphelines que les unités de CE groupe.
    const row = db.prepare('SELECT group_id FROM unites WHERE id = ?').get(id) as
      | { group_id: string }
      | undefined;
    return row?.group_id === groupId;
  });
  return stats;
}

function syncCategories(db: Database.Database, options: RefOption[], now: string): RefSyncStats {
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

    if (getByCwId.get(cwId)) {
      stats.inchangees++;
      continue;
    }

    const target = normalise(opt.label);
    const candidates = getByLabel.all() as Array<{
      id: string;
      name: string;
      comptaweb_nature: string | null;
    }>;
    const matched = candidates.find(
      (c) => normalise(c.comptaweb_nature) === target || normalise(c.name) === target,
    );
    if (matched) {
      updateCwId.run(cwId, opt.label, matched.id);
      stats.mappees++;
      continue;
    }

    const id = uniqueId(db, 'categories', `cat-${slugify(opt.label)}`);
    insertCat.run(id, opt.label, opt.label, cwId, now);
    stats.ajoutees++;
  }

  stats.orphelines = findOrphelines(db, 'categories', cwIds);
  return stats;
}

function syncActivites(
  db: Database.Database,
  groupId: string,
  options: RefOption[],
  now: string,
): RefSyncStats {
  const stats: RefSyncStats = { ajoutees: 0, mappees: 0, inchangees: 0, orphelines: [] };
  const cwIds = new Set<number>();

  const getByCwId = db.prepare(
    'SELECT id FROM activites WHERE comptaweb_id = ? AND group_id = ? LIMIT 1',
  );
  const getByName = db.prepare(
    'SELECT id, name FROM activites WHERE group_id = ? AND comptaweb_id IS NULL',
  );
  const updateCwId = db.prepare('UPDATE activites SET comptaweb_id = ? WHERE id = ?');
  const insertAct = db.prepare(
    'INSERT INTO activites (id, group_id, name, comptaweb_id, created_at) VALUES (?, ?, ?, ?, ?)',
  );

  for (const opt of options) {
    const cwId = Number(opt.value);
    if (!Number.isFinite(cwId) || !opt.label) continue;
    cwIds.add(cwId);

    if (getByCwId.get(cwId, groupId)) {
      stats.inchangees++;
      continue;
    }

    const target = normalise(opt.label);
    const candidates = getByName.all(groupId) as Array<{ id: string; name: string }>;
    const matched = candidates.find((c) => normalise(c.name) === target);
    if (matched) {
      updateCwId.run(cwId, matched.id);
      stats.mappees++;
      continue;
    }

    const id = uniqueId(db, 'activites', `act-${groupId}-${slugify(opt.label)}`);
    insertAct.run(id, groupId, opt.label, cwId, now);
    stats.ajoutees++;
  }

  stats.orphelines = findOrphelines(db, 'activites', cwIds).filter((id) => {
    const row = db.prepare('SELECT group_id FROM activites WHERE id = ?').get(id) as
      | { group_id: string }
      | undefined;
    return row?.group_id === groupId;
  });
  return stats;
}

function syncModes(db: Database.Database, options: RefOption[], now: string): RefSyncStats {
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

    if (getByCwId.get(cwId)) {
      stats.inchangees++;
      continue;
    }

    const target = normalise(opt.label);
    const candidates = getByName.all() as Array<{ id: string; name: string }>;
    const matched = candidates.find((c) => normalise(c.name) === target);
    if (matched) {
      updateCwId.run(cwId, matched.id);
      stats.mappees++;
      continue;
    }

    const id = uniqueId(db, 'modes_paiement', `mp-${slugify(opt.label)}`);
    insertMode.run(id, opt.label, cwId, now);
    stats.ajoutees++;
  }

  stats.orphelines = findOrphelines(db, 'modes_paiement', cwIds);
  return stats;
}

function syncCartes(
  db: Database.Database,
  groupId: string,
  cartes: ScrapedCarte[],
  now: string,
): RefSyncStats {
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

    const existing = getByCwId.get(c.comptawebId, groupId) as
      | { id: string; type: string; porteur: string; code_externe: string | null; statut: string }
      | undefined;

    if (existing) {
      if (
        existing.porteur !== c.porteur
        || (existing.code_externe ?? null) !== (c.codeExterne ?? null)
        || existing.statut !== c.statut
      ) {
        updateCarte.run(c.porteur, c.codeExterne, c.statut, now, existing.id);
        stats.mappees++;
      } else {
        stats.inchangees++;
      }
      continue;
    }

    const base = `carte-${c.type === 'procurement' ? 'proc' : 'cb'}-${slugify(c.porteur)}`;
    const id = uniqueId(db, 'cartes', base);
    insertCarte.run(id, groupId, c.type, c.porteur, c.comptawebId, c.codeExterne, c.statut, now, now);
    stats.ajoutees++;
  }

  stats.orphelines = findOrphelines(db, 'cartes', cwIds).filter((id) => {
    const row = db.prepare('SELECT group_id FROM cartes WHERE id = ?').get(id) as
      | { group_id: string }
      | undefined;
    return row?.group_id === groupId;
  });
  return stats;
}

export function applyReferentielsSync(
  db: Database.Database,
  groupId: string,
  refs: ReferentielsInput,
  now: string,
): SyncReferentielsReport {
  return db.transaction(() => ({
    unites: syncUnites(db, groupId, refs.brancheprojet, now),
    categories: syncCategories(db, refs.nature, now),
    activites: syncActivites(db, groupId, refs.activite, now),
    modes_paiement: syncModes(db, refs.modetransaction, now),
    cartes: syncCartes(db, groupId, refs.cartes, now),
  }))();
}
