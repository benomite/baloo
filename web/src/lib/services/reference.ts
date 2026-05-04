import { getDb } from '../db';
import type { Category, Unite, ModePaiement, Activite } from '../types';

export interface ReferenceContext {
  groupId: string;
}

// categories et modes_paiement sont des référentiels SGDF nationaux : pas de
// group_id, mêmes valeurs pour tous les groupes.

export async function listCategories(): Promise<Category[]> {
  return await getDb()
    .prepare('SELECT id, name, type, comptaweb_nature, comptaweb_id FROM categories ORDER BY name')
    .all<Category>();
}

export async function listModesPaiement(): Promise<ModePaiement[]> {
  return await getDb()
    .prepare('SELECT id, name, comptaweb_id FROM modes_paiement ORDER BY name')
    .all<ModePaiement>();
}

// unites et activites sont spécifiques au groupe (group_id NOT NULL).

export async function listUnites({ groupId }: ReferenceContext): Promise<Unite[]> {
  return await getDb()
    .prepare('SELECT id, code, name, couleur, comptaweb_id FROM unites WHERE group_id = ? ORDER BY code')
    .all<Unite>(groupId);
}

export async function listActivites({ groupId }: ReferenceContext): Promise<Activite[]> {
  return await getDb()
    .prepare('SELECT id, name, comptaweb_id FROM activites WHERE group_id = ? ORDER BY name')
    .all<Activite>(groupId);
}

// Compteurs de référentiels actuellement en BDD pour un groupe.
// Utilisé par la page d'import Comptaweb pour donner de la visibilité
// sur ce qui est synchronisé vs ce qui est local pur (sans comptaweb_id).
export interface ReferentielCount {
  total: number;
  mapped: number; // ayant un comptaweb_id défini
}

export interface ReferentielsCounts {
  categories: ReferentielCount;
  modes_paiement: ReferentielCount;
  unites: ReferentielCount;
  activites: ReferentielCount;
  cartes: ReferentielCount;
}

export async function getReferentielsCounts(
  { groupId }: ReferenceContext,
): Promise<ReferentielsCounts> {
  const db = getDb();
  // categories et modes_paiement sont des référentiels nationaux (pas
  // de group_id), on compte sur l'ensemble. Les autres sont scopés au
  // groupe courant.
  const [cats, modes, unites, activites, cartes] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN comptaweb_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped
       FROM categories`,
    ).get<{ total: number; mapped: number | null }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN comptaweb_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped
       FROM modes_paiement`,
    ).get<{ total: number; mapped: number | null }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN comptaweb_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped
       FROM unites WHERE group_id = ?`,
    ).get<{ total: number; mapped: number | null }>(groupId),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN comptaweb_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped
       FROM activites WHERE group_id = ?`,
    ).get<{ total: number; mapped: number | null }>(groupId),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN comptaweb_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped
       FROM cartes WHERE group_id = ?`,
    ).get<{ total: number; mapped: number | null }>(groupId),
  ]);
  const norm = (r: { total: number; mapped: number | null } | undefined): ReferentielCount => ({
    total: r?.total ?? 0,
    mapped: r?.mapped ?? 0,
  });
  return {
    categories: norm(cats),
    modes_paiement: norm(modes),
    unites: norm(unites),
    activites: norm(activites),
    cartes: norm(cartes),
  };
}

// Détail des référentiels pour la page d'inspection /import.
// Chaque entrée contient comptaweb_id pour distinguer les entrées
// synchronisées des locales pures.
export interface RefDetailRow {
  id: string;
  label: string;
  sublabel?: string | null;
  comptaweb_id: number | null;
  badge?: string | null;
}

export interface ReferentielsDetails {
  categories: RefDetailRow[];
  modes_paiement: RefDetailRow[];
  unites: RefDetailRow[];
  activites: RefDetailRow[];
  cartes: RefDetailRow[];
}

export async function getReferentielsDetails(
  { groupId }: ReferenceContext,
): Promise<ReferentielsDetails> {
  const db = getDb();
  const [cats, modes, unites, activites, cartes] = await Promise.all([
    db.prepare(
      `SELECT id, name, type, comptaweb_nature, comptaweb_id
       FROM categories ORDER BY name`,
    ).all<{
      id: string;
      name: string;
      type: string;
      comptaweb_nature: string | null;
      comptaweb_id: number | null;
    }>(),
    db.prepare(
      `SELECT id, name, comptaweb_id FROM modes_paiement ORDER BY name`,
    ).all<{ id: string; name: string; comptaweb_id: number | null }>(),
    db.prepare(
      `SELECT id, code, name, comptaweb_id, couleur
       FROM unites WHERE group_id = ? ORDER BY code`,
    ).all<{
      id: string;
      code: string;
      name: string;
      comptaweb_id: number | null;
      couleur: string | null;
    }>(groupId),
    db.prepare(
      `SELECT id, name, comptaweb_id
       FROM activites WHERE group_id = ? ORDER BY name`,
    ).all<{ id: string; name: string; comptaweb_id: number | null }>(groupId),
    db.prepare(
      `SELECT id, type, porteur, code_externe, statut, comptaweb_id
       FROM cartes WHERE group_id = ? ORDER BY statut, porteur`,
    ).all<{
      id: string;
      type: string;
      porteur: string;
      code_externe: string | null;
      statut: string;
      comptaweb_id: number | null;
    }>(groupId),
  ]);
  return {
    categories: cats.map((c) => ({
      id: c.id,
      label: c.name,
      sublabel: c.comptaweb_nature,
      comptaweb_id: c.comptaweb_id,
      badge: c.type !== 'les_deux' ? c.type : null,
    })),
    modes_paiement: modes.map((m) => ({
      id: m.id,
      label: m.name,
      comptaweb_id: m.comptaweb_id,
    })),
    unites: unites.map((u) => ({
      id: u.id,
      label: `${u.code} — ${u.name}`,
      sublabel: u.couleur,
      comptaweb_id: u.comptaweb_id,
    })),
    activites: activites.map((a) => ({
      id: a.id,
      label: a.name,
      comptaweb_id: a.comptaweb_id,
    })),
    cartes: cartes.map((c) => ({
      id: c.id,
      label: `${c.type === 'cb' ? 'CB' : 'Procurement'} · ${c.porteur}`,
      sublabel: c.code_externe,
      comptaweb_id: c.comptaweb_id,
      badge: c.statut === 'ancienne' ? 'ancienne' : null,
    })),
  };
}

// Top N catégories les plus utilisées par un groupe (basé sur les
// écritures existantes). Sert à alimenter un sélecteur "favoris" dans
// les formulaires : les 4-5 catégories les plus fréquentes en chips
// rapides, le reste en select déroulant.
//
// Si le groupe est vierge (aucune écriture), retourne []. Le composant
// dégrade alors vers un select complet.
export async function getTopCategoryIdsForGroup(
  { groupId }: ReferenceContext,
  limit = 5,
): Promise<string[]> {
  const rows = await getDb()
    .prepare(
      `SELECT category_id, COUNT(*) AS n
       FROM ecritures
       WHERE group_id = ? AND category_id IS NOT NULL
       GROUP BY category_id
       ORDER BY n DESC
       LIMIT ?`,
    )
    .all<{ category_id: string; n: number }>(groupId, limit);
  return rows.map((r) => r.category_id);
}
