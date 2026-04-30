import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { getStorage, guessMime } from '../storage';
import type { Justificatif } from '../types';

// Whitelist double (extension + MIME) sur les justificatifs uploadés.
// Un attaquant peut renommer un fichier (extension) OU mentir sur le
// Content-Type (MIME) — on contrôle les deux. La taille max double
// celle de bodySizeLimit Next (10 MB) pour matcher.
//
// HEIC ajouté pour les photos iOS prises directement depuis l'app.
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif',
  'csv', 'xlsx', 'xls',
]);

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Erreur dédiée pour que les call-sites puissent distinguer une
// validation refusée d'une vraie panne (storage HS, BDD KO, etc.) et
// remonter le bon message à l'utilisateur.
export class JustificatifValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JustificatifValidationError';
  }
}

export interface JustificatifContext {
  groupId: string;
}

export interface ListJustificatifsOptions {
  entity_type?: string;
  entity_id?: string;
  limit?: number;
}

export async function listJustificatifs(
  { groupId }: JustificatifContext,
  options: ListJustificatifsOptions = {},
): Promise<Justificatif[]> {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.entity_type) { conditions.push('entity_type = ?'); values.push(options.entity_type); }
  if (options.entity_id) { conditions.push('entity_id = ?'); values.push(options.entity_id); }

  return await getDb()
    .prepare(`SELECT * FROM justificatifs WHERE ${conditions.join(' AND ')} ORDER BY uploaded_at DESC LIMIT ?`)
    .all<Justificatif>(...values, options.limit ?? 50);
}

export interface EcritureJustifsBundle {
  /** Justifs attachés directement à l'écriture (par le trésorier). */
  direct: Justificatif[];
  /** Pour chaque demande de remboursement liée à l'écriture, les
   *  justifs et le RIB déposés côté demande — ils s'affichent côté
   *  écriture sans qu'on les duplique en BDD. */
  viaRemboursement: {
    remboursementId: string;
    demandeur: string | null;
    justifs: Justificatif[];
    rib: Justificatif[];
  }[];
}

// Liste les justifs visibles depuis la page détail d'une écriture :
// ceux qui lui sont attachés directement + ceux des demandes de
// remboursement qui pointent sur cette écriture (via
// `remboursements.ecriture_id`). Pas de duplication : la source de
// vérité reste côté demande, l'écriture est un miroir.
export async function listJustificatifsForEcriture(
  { groupId }: JustificatifContext,
  ecritureId: string,
): Promise<EcritureJustifsBundle> {
  const db = getDb();

  const direct = await db
    .prepare(
      `SELECT * FROM justificatifs
       WHERE group_id = ? AND entity_type = 'ecriture' AND entity_id = ?
       ORDER BY uploaded_at DESC`,
    )
    .all<Justificatif>(groupId, ecritureId);

  const linkedRembs = await db
    .prepare(
      `SELECT id, demandeur FROM remboursements
       WHERE group_id = ? AND ecriture_id = ?
       ORDER BY id`,
    )
    .all<{ id: string; demandeur: string | null }>(groupId, ecritureId);

  const viaRemboursement = await Promise.all(
    linkedRembs.map(async (r) => {
      const all = await db
        .prepare(
          `SELECT * FROM justificatifs
           WHERE group_id = ? AND entity_id = ?
             AND entity_type IN ('remboursement', 'remboursement_rib')
           ORDER BY uploaded_at DESC`,
        )
        .all<Justificatif>(groupId, r.id);
      return {
        remboursementId: r.id,
        demandeur: r.demandeur,
        justifs: all.filter((j) => j.entity_type === 'remboursement'),
        rib: all.filter((j) => j.entity_type === 'remboursement_rib'),
      };
    }),
  );

  return { direct, viaRemboursement };
}

export interface AttachJustificatifInput {
  entity_type: string;
  entity_id: string;
  filename: string;
  content: Buffer;
  mime_type?: string | null;
}

// Exporté pour pré-check côté action (rembs, depots, abandons) avant
// de créer la demande en BDD : on échoue tôt sans laisser d'état
// orphelin si un fichier est invalide.
export function validateJustifAttachment(opts: {
  filename: string;
  size: number;
  mime_type?: string | null;
}): void {
  if (opts.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = Math.round((opts.size / 1024 / 1024) * 10) / 10;
    throw new JustificatifValidationError(
      `Fichier trop volumineux (${sizeMb} MB). Limite : 10 MB.`,
    );
  }

  const ext = opts.filename.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new JustificatifValidationError(
      `Type de fichier non autorisé : .${ext || '(sans extension)'}. ` +
        `Autorisés : PDF, JPG, PNG, GIF, WEBP, HEIC, CSV, XLS(X).`,
    );
  }

  if (opts.mime_type && !ALLOWED_MIME_TYPES.has(opts.mime_type)) {
    throw new JustificatifValidationError(
      `Type MIME non autorisé : ${opts.mime_type}.`,
    );
  }
}

export async function attachJustificatif(
  { groupId }: JustificatifContext,
  input: AttachJustificatifInput,
): Promise<Justificatif> {
  validateJustifAttachment({
    filename: input.filename,
    size: input.content.length,
    mime_type: input.mime_type,
  });

  const relativePath = `${input.entity_type}/${input.entity_id}/${input.filename}`;
  const mime = input.mime_type ?? guessMime(input.filename);

  await getStorage().put({ path: relativePath, content: input.content, contentType: mime });

  const id = await nextId('JUS');

  await getDb().prepare(
    `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, groupId, relativePath, input.filename, mime, input.entity_type, input.entity_id, currentTimestamp());

  return (await getDb().prepare('SELECT * FROM justificatifs WHERE id = ?').get<Justificatif>(id))!;
}
