// Classification des tables pour l'export d'archive d'exercice.
//
// La table de complétude ci-dessous (46 tables) est extraite des fichiers
// de schéma (business-schema.ts, auth/schema.ts, et les ensure*Schema des
// services) au 2026-11-08. Elle est codée en dur ici (pas de requête BDD)
// pour que ce test tourne sans DB_URL. Le test « complétude face au schéma
// réel » plus bas, lui, touche la vraie base et est encadré en conséquence.
//
// Liste figée à resynchroniser à chaque migration de schéma (nouvelle
// table, table renommée ou supprimée) : sinon ce test dérive silencieusement
// de la base réelle et ne détecte plus une table oubliée dans
// TABLES_INCLUSES / TABLES_EXCLUES.
import { describe, it, expect } from 'vitest';
import { TABLES_INCLUSES, TABLES_EXCLUES, classifierTables } from '../tables';

const TOUTES_LES_TABLES_REELLES = [
  'abandons_frais', 'activites', 'api_tokens', 'avances_camp', 'budget_lignes', 'budgets',
  'camps', 'cartes', 'categories', 'comptaweb_credentials', 'comptaweb_imports',
  'comptaweb_lignes', 'comptes_bancaires', 'cw_link_suggestions', 'depots_cheques',
  'depots_especes', 'depots_justificatifs', 'ecritures', 'error_log', 'groupes',
  'inbox_suggestion_rejets', 'invite_links', 'justificatifs', 'justificatifs_televersements',
  'login_codes',
  'modes_paiement', 'mouvements_caisse', 'notes', 'oauth_access_tokens',
  'oauth_authorization_codes', 'oauth_clients', 'personnes', 'referentiels_cw_exercice',
  'remboursement_ligne_justificatifs', 'remboursement_lignes', 'remboursements',
  'repartitions_unites', 'sessions', 'signatures', 'signin_attempts', 'sync_runs', 'todos',
  'unites', 'user_unites', 'users', 'verification_tokens',
];

describe('classification des tables', () => {
  it('exclut toutes les tables d’authentification et de secrets', () => {
    for (const t of [
      'comptaweb_credentials', 'api_tokens', 'oauth_clients', 'oauth_access_tokens',
      'oauth_authorization_codes', 'sessions', 'login_codes', 'signin_attempts',
      'verification_tokens', 'invite_links',
    ]) {
      expect(TABLES_EXCLUES).toContain(t);
    }
  });

  it('exclut error_log (log technique global, sans colonne group_id)', () => {
    // error_log n'a pas de group_id (vérifié dans business-schema.ts) : un
    // régime 'group_id' planterait la génération SQL de la tâche 7, et un
    // régime 'global' ferait fuiter les erreurs de TOUS les groupes dans
    // l'archive d'un seul. La seule option sûre est l'exclusion.
    expect(TABLES_EXCLUES).toContain('error_log');
  });

  it('ne déclare jamais une table à la fois incluse et exclue', () => {
    const incluses = TABLES_INCLUSES.map((t) => t.nom);
    expect(incluses.filter((n) => TABLES_EXCLUES.includes(n))).toEqual([]);
  });

  it('traite categories et modes_paiement comme des référentiels globaux', () => {
    // Ces deux tables n'ont PAS de colonne group_id : les filtrer dessus
    // renverrait zéro ligne et viderait les libellés du dossier d'exercice.
    for (const nom of ['categories', 'modes_paiement']) {
      expect(TABLES_INCLUSES.find((t) => t.nom === nom)?.regime).toBe('global');
    }
  });

  it('borne par FK les tables filles sans group_id', () => {
    // signatures, remboursement_lignes et remboursement_ligne_justificatifs
    // n'ont pas de group_id : un SELECT * exporterait les données de tous
    // les groupes une fois le multi-tenant activé (P3).
    for (const nom of ['signatures', 'remboursement_lignes', 'remboursement_ligne_justificatifs']) {
      const t = TABLES_INCLUSES.find((x) => x.nom === nom);
      expect(t?.regime).toBe('par_fk');
      expect(t?.parents).toBeDefined();
      expect(t?.parents?.length).toBeGreaterThan(0);
    }
  });

  it('borne avances_camp directement par sa propre colonne group_id', () => {
    // avances_camp PORTE group_id (vérifié dans camp-avances.ts) : pas
    // besoin de jointure vers camps, contrairement à ce qu'on pourrait
    // supposer par analogie avec budget_lignes/avances_camp.
    const t = TABLES_INCLUSES.find((x) => x.nom === 'avances_camp');
    expect(t?.regime).toBe('group_id');
  });

  it('signatures a DEUX parents possibles (remboursements ET abandons_frais)', () => {
    // document_type vaut 'remboursement' ou 'abandon' : un parent unique
    // perdrait silencieusement la moitié des signatures, alors qu'elles
    // sont la valeur probante des documents.
    const t = TABLES_INCLUSES.find((x) => x.nom === 'signatures');
    const tables = t?.parents?.map((p) => p.table).sort();
    expect(tables).toEqual(['abandons_frais', 'remboursements']);
    for (const p of t?.parents ?? []) {
      expect(p.cleLocale).toBe('document_id');
      expect(p.cleParent).toBe('id');
    }
  });

  it('remboursement_ligne_justificatifs remonte deux crans via remboursement_lignes', () => {
    // Son parent direct (remboursement_lignes) n'a pas de group_id : il
    // faut chaîner jusqu'à remboursements, qui en a un.
    const t = TABLES_INCLUSES.find((x) => x.nom === 'remboursement_ligne_justificatifs');
    expect(t?.parents).toHaveLength(1);
    const [parent] = t!.parents!;
    expect(parent.table).toBe('remboursement_lignes');
    expect(parent.cleLocale).toBe('ligne_id');
    expect(parent.cleParent).toBe('id');
    expect(parent.via).toBeDefined();
    expect(parent.via?.table).toBe('remboursements');
    expect(parent.via?.cleLocale).toBe('remboursement_id');
    expect(parent.via?.cleParent).toBe('id');
  });

  it('signale une table du schéma qui n’est classée nulle part', () => {
    const r = classifierTables(['ecritures', 'table_toute_neuve']);
    expect(r.manquantes).toEqual(['table_toute_neuve']);
  });

  it('signale une table déclarée qui n’existe plus', () => {
    const r = classifierTables(['ecritures']);
    expect(r.inconnues).toContain('justificatifs');
  });

  it('classe les 46 tables réelles du schéma sans manquante ni inconnue', () => {
    // Liste figée à la main depuis les fichiers de schéma (cf. commentaire
    // en tête de fichier) : garde-fou qui ne dépend pas d'une BDD vivante.
    const r = classifierTables(TOUTES_LES_TABLES_REELLES);
    expect(r.manquantes).toEqual([]);
    expect(r.inconnues).toEqual([]);
  });
});

// Touche la vraie base (sqlite_master) : n'a de sens qu'en local avec
// DB_URL positionné, absent en CI. Le test ci-dessus (liste figée) est le
// garde-fou qui tourne partout ; celui-ci n'est qu'une double vérification
// contre le schéma vivant quand on l'a sous la main.
describe.skipIf(!process.env.DB_URL)('complétude face au schéma réel', () => {
  it('classe toutes les tables de la base', async () => {
    const { getDb } = await import('../../../db');
    const rows = await getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all<{ name: string }>();
    const { manquantes } = classifierTables(rows.map((r) => r.name));
    expect(manquantes).toEqual([]);
  });
});
