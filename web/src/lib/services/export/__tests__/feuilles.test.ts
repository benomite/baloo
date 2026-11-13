// Ticket #43 : la feuille de remboursement du dossier d'exercice est la
// feuille courante régénérée avec l'IBAN / BIC masqués, et seulement pour
// les demandes qui ont eu une feuille générée.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { contenuLisiblePdf, sansEspaces } from '../../../pdf/__tests__/texte-pdf';

let db: DbWrapper;
vi.mock('../../../db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../db')>()),
  getDb: () => db,
}));

import { feuilleArchiveMasquee } from '../feuilles';
import { renderFeuilleRemboursementCourante } from '../../remboursement-signing';

const IBAN = 'FR76 3000 6000 0112 3456 7890 189';
const BIC = 'AGRIFRPP882';

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  db = wrapClient(client);
  await db.exec(`
    CREATE TABLE groupes (id TEXT PRIMARY KEY, nom TEXT);
    CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT);
    CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, prenom TEXT, nom TEXT, email TEXT,
      rib_texte TEXT, rib_file_path TEXT, unite_id TEXT, mode_paiement_id TEXT,
      submitted_by_user_id TEXT
    );
    CREATE TABLE remboursement_lignes (
      id TEXT PRIMARY KEY, remboursement_id TEXT, date_depense TEXT, amount_cents INTEGER,
      nature TEXT, notes TEXT, type TEXT, distance_km_dixiemes INTEGER,
      taux_km_millicents INTEGER, created_at TEXT
    );
    CREATE TABLE signatures (
      id TEXT PRIMARY KEY, document_type TEXT, document_id TEXT, signer_role TEXT,
      signer_user_id TEXT, signer_email TEXT, signer_name TEXT, data_hash TEXT,
      previous_signature_id TEXT, chain_hash TEXT, ip TEXT, user_agent TEXT,
      server_timestamp TEXT, tsa_response TEXT, tsa_timestamp TEXT, superseded_at TEXT,
      created_at TEXT
    );
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, file_path TEXT, original_filename TEXT,
      entity_type TEXT, entity_id TEXT, obsolete_at TEXT, uploaded_at TEXT
    );
    INSERT INTO groupes VALUES ('g', 'Groupe Test');
    INSERT INTO remboursements (id, group_id, demandeur, prenom, nom, email, rib_texte)
      VALUES ('RBT-1', 'g', 'Jean Test', 'Jean', 'Test', 'jean@ex.org', '${IBAN} / ${BIC}');
    INSERT INTO remboursement_lignes VALUES
      ('L1', 'RBT-1', '2026-07-12', 4250, 'Métro', NULL, 'depense', NULL, NULL, '2026-07-12T10:00:00Z');
    INSERT INTO signatures VALUES
      ('S1', 'remboursement', 'RBT-1', 'demandeur', NULL, 'jean@ex.org', 'Jean Test',
       '${'a'.repeat(64)}', NULL, '${'b'.repeat(64)}', '203.0.113.7', NULL,
       '2026-07-12T10:00:00Z', NULL, NULL, NULL, '2026-07-12T10:00:00Z'),
      ('S0', 'remboursement', 'RBT-1', 'tresorier', NULL, 'perime@ex.org', 'Signataire Périmé',
       '${'c'.repeat(64)}', NULL, '${'d'.repeat(64)}', NULL, NULL,
       '2026-07-11T10:00:00Z', NULL, NULL, '2026-07-12T09:00:00Z', '2026-07-11T10:00:00Z');
  `);
});

async function ajouterFeuille(id: string, uploadedAt: string, obsolete: string | null = null) {
  await db
    .prepare(
      `INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id, obsolete_at, uploaded_at)
       VALUES (?, 'g', 'remboursement_feuille/RBT-1/f.pdf', 'feuille-RBT-1.pdf', 'remboursement_feuille', 'RBT-1', ?, ?)`,
    )
    .run(id, obsolete, uploadedAt);
}

describe('feuilleArchiveMasquee', () => {
  it('régénère la feuille courante : même contenu et mêmes signatures, sans IBAN ni BIC', async () => {
    await ajouterFeuille('JUS-OLD', '2026-07-12T10:00:01Z');
    await ajouterFeuille('JUS-NEW', '2026-07-15T08:00:00Z');
    const buf = await feuilleArchiveMasquee('g', 'RBT-1');
    expect(buf).not.toBeNull();
    const contenu = contenuLisiblePdf(buf!);

    expect(contenu).not.toContain(sansEspaces(IBAN));
    expect(contenu).not.toContain('34567890189');
    expect(contenu).not.toContain(BIC);
    expect(contenu).toContain('masquédanscettecopie');

    expect(contenu).toContain('RBT-1');
    expect(contenu).toContain('JeanTest');
    expect(contenu).toContain('Métro');
    expect(contenu).toContain('Demandeur:JeanTest');
    expect(contenu).toContain('IP203.0.113.7');
    expect(contenu).toContain('a'.repeat(32));
    // Chaîne COURANTE seulement, comme la feuille stockée.
    expect(contenu).not.toContain('SignatairePérimé');
    // Date de la dernière génération de la feuille stockée.
    expect(contenu).toContain('DocumentgénéréparBaloole2026-07-15');
  });

  it('la feuille de l’app (rendu par défaut) imprime toujours l’IBAN et le BIC', async () => {
    const contenu = contenuLisiblePdf(
      await renderFeuilleRemboursementCourante({ groupId: 'g', rbtId: 'RBT-1', submittedAt: '2026-07-15' }),
    );
    expect(contenu).toContain(sansEspaces(IBAN));
    expect(contenu).toContain(BIC);
  });

  it('aucune feuille générée : pas de feuille dans l’archive', async () => {
    expect(await feuilleArchiveMasquee('g', 'RBT-1')).toBeNull();
  });

  it('seulement des feuilles obsolètes : pas de feuille, comme `feuille_signee`', async () => {
    await ajouterFeuille('JUS-OBS', '2026-07-12T10:00:01Z', '2026-08-01T00:00:00Z');
    expect(await feuilleArchiveMasquee('g', 'RBT-1')).toBeNull();
  });

  it('ne lit pas la feuille d’un autre groupe', async () => {
    await db
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id, uploaded_at)
         VALUES ('JUS-X', 'autre', 'x.pdf', 'x.pdf', 'remboursement_feuille', 'RBT-1', '2026-07-15T08:00:00Z')`,
      )
      .run();
    expect(await feuilleArchiveMasquee('g', 'RBT-1')).toBeNull();
  });
});
