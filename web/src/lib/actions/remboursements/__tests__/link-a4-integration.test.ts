import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';

// Test d'intégration A4 : contrairement à `link-guard.test.ts` (garde pure),
// on exerce ici les VRAIES server actions (`linkRemboursementToEcriture`,
// `unlinkRemboursementFromEcriture`) au-dessus d'une BDD libsql en mémoire,
// pour vérifier le statut réellement écrit — pas un mock qui répond "ok".
//
// Patterns repris de l'existant :
//  - mock de `../../../db` avec `importOriginal` + `getDb: () => testDb`
//    (cf. `services/__tests__/remboursement-ecriture-link.test.ts`).
//  - mock de `next/navigation` avec `redirect` qui throw un marqueur
//    repérable (cf. `auth/access.test.ts`) : les deux actions terminent
//    TOUJOURS par un `redirect()`, y compris en cas de succès.

let testDb: DbWrapper;

vi.mock('../../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../db')>();
  return { ...actual, getDb: () => testDb };
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../../../log', () => ({
  logError: vi.fn(),
}));

vi.mock('../_helpers', () => ({
  captureClientMeta: vi.fn(async () => ({ ip: null, userAgent: null })),
  deriveAppUrl: vi.fn(async () => 'https://test.local'),
}));

const CTX = {
  groupId: 'g-test',
  role: 'tresorier',
  // Égal à `submitted_by_user_id` des demandes de test : évite de solliciter
  // la notif email du soumetteur dans `applyRemboursementTransition`
  // (branche réelle non mockée, non pertinente ici).
  userId: 'u-treso',
  email: 'treso@test.fr',
  name: 'Trésorier Test',
  scopeUniteIds: [] as string[],
};

vi.mock('../../../context', () => ({
  getCurrentContext: vi.fn(async () => CTX),
}));

import { linkRemboursementToEcriture, unlinkRemboursementFromEcriture } from '../link';
import { logError } from '../../../log';

const SETUP = `
  CREATE TABLE remboursements (
    id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, prenom TEXT, nom TEXT, email TEXT,
    rib_texte TEXT, rib_file_path TEXT, amount_cents INTEGER, total_cents INTEGER,
    date_depense TEXT, nature TEXT, unite_id TEXT, justificatif_status TEXT, status TEXT,
    motif_refus TEXT, date_paiement TEXT, mode_paiement_id TEXT, comptaweb_synced INTEGER,
    ecriture_id TEXT, notes TEXT, submitted_by_user_id TEXT, edit_token TEXT, validate_token TEXT,
    created_at TEXT, updated_at TEXT
  );
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT, type TEXT, amount_cents INTEGER,
    date_ecriture TEXT, description TEXT, unite_id TEXT, status TEXT,
    ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
    category_id TEXT, activite_id TEXT, mode_paiement_id TEXT, numero_piece TEXT,
    carte_id TEXT, justif_attendu INTEGER, notes TEXT, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, libelle_origine TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT);
`;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP);
  return db;
}

async function insertRbt(
  db: DbWrapper,
  id: string,
  status: string,
  ecritureId: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO remboursements
         (id, group_id, demandeur, amount_cents, total_cents, status, ecriture_id, submitted_by_user_id)
       VALUES (?, 'g-test', 'Test Demandeur', 3200, 3200, ?, ?, 'u-treso')`,
    )
    .run(id, status, ecritureId);
}

async function insertEcriture(db: DbWrapper, id: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status)
       VALUES (?, 'g-test', 'depense', 3200, '2026-07-01', 'Virement Florence', 'mirror')`,
    )
    .run(id);
}

async function getStatusAndEcriture(
  db: DbWrapper,
  id: string,
): Promise<{ status: string; ecriture_id: string | null }> {
  const row = await db
    .prepare('SELECT status, ecriture_id FROM remboursements WHERE id = ?')
    .get<{ status: string; ecriture_id: string | null }>(id);
  if (!row) throw new Error(`RBT ${id} introuvable`);
  return row;
}

// Les deux actions terminent toujours par un redirect() (succès ou erreur) —
// on l'attend et on l'avale pour pouvoir observer l'état BDD après coup.
async function runAndCatchRedirect(fn: () => Promise<void>): Promise<string> {
  try {
    await fn();
    throw new Error('attendu : redirect() aurait dû throw');
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('REDIRECT:')) return err.message;
    throw err;
  }
}

describe('linkRemboursementToEcriture — A4 (lien → terminé auto, intégration réelle)', () => {
  beforeEach(async () => {
    testDb = await setupDb();
    vi.clearAllMocks();
  });

  it('un lien réussi depuis virement_effectue passe la demande en termine', async () => {
    await insertRbt(testDb, 'RBT-1', 'virement_effectue', null);
    await insertEcriture(testDb, 'ECR-1');

    const fd = new FormData();
    fd.set('ecriture_id', 'ECR-1');

    const redirectUrl = await runAndCatchRedirect(() => linkRemboursementToEcriture('RBT-1', fd));

    expect(redirectUrl).toContain('linked=ECR-1');
    const after = await getStatusAndEcriture(testDb, 'RBT-1');
    expect(after.ecriture_id).toBe('ECR-1');
    expect(after.status).toBe('termine');
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('unlinkRemboursementFromEcriture — A4 (délien → repli, intégration réelle)', () => {
  beforeEach(async () => {
    testDb = await setupDb();
    vi.clearAllMocks();
  });

  it('délier une demande termine la replie en virement_effectue', async () => {
    await insertRbt(testDb, 'RBT-2', 'termine', 'ECR-2');
    await insertEcriture(testDb, 'ECR-2');

    const redirectUrl = await runAndCatchRedirect(() => unlinkRemboursementFromEcriture('RBT-2'));

    expect(redirectUrl).toContain('unlinked=1');
    const after = await getStatusAndEcriture(testDb, 'RBT-2');
    expect(after.ecriture_id).toBeNull();
    expect(after.status).toBe('virement_effectue');
  });

  it('délier une demande PAS terminée délie sans toucher au statut', async () => {
    await insertRbt(testDb, 'RBT-3', 'virement_effectue', 'ECR-3');
    await insertEcriture(testDb, 'ECR-3');

    await runAndCatchRedirect(() => unlinkRemboursementFromEcriture('RBT-3'));

    const after = await getStatusAndEcriture(testDb, 'RBT-3');
    expect(after.ecriture_id).toBeNull();
    expect(after.status).toBe('virement_effectue'); // inchangé, pas de repli déclenché
  });
});
