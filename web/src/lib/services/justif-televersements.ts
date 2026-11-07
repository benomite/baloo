// Téléversement direct navigateur → Vercel Blob (ticket #28).
//
// Avant : le fichier traversait la server action, donc la fonction
// serverless, dont le body est plafonné à ~4,5 Mo AU NIVEAU EDGE (413
// opaque). Maintenant le navigateur envoie le fichier lui-même au store
// Blob avec un token à courte durée signé par
// `/api/justificatifs/televersement`, et le formulaire ne soumet plus que
// des RÉFÉRENCES (`{ pathname, filename }`).
//
// Cycle de vie :
// 1. Signature (`buildUploadTokenOptions`) : le serveur valide extension,
//    MIME, taille et appartenance (pathname sous
//    `televersements/<group>/<user>/`) avant de délivrer le token.
//    `justif-allowed.ts` est la seule autorité.
// 2. Inscription dans `justificatifs_televersements` :
//    - en prod, par le callback `onUploadCompleted`
//      (`recordUploadCompleted`) : appelé par Vercel, signé, non
//      falsifiable par le client ;
//    - hors prod (dev local : le callback exige une URL publique et ne
//      part jamais), par le serveur au submit, après avoir constaté le
//      fichier dans le storage (`resolveTeleversements`). Ce repli
//      n'existe pas en prod.
// 3. Rattachement (`attachTeleversement`) au submit du formulaire : la
//    ligne `justificatifs` pointe sur le blob déjà stocké, rien n'est
//    recopié. Un téléversement ne sert qu'une fois.
//
// Accès : les blobs restent PRIVÉS (`access: 'private'` côté client, cf.
// `lib/justif-upload-client.ts`). Un blob public n'est jamais inscrit :
// tout accès doit continuer de passer par `GET /api/justificatifs/...`
// qui contrôle le `group_id`.

import { getDb, type DbWrapper } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { getStorage, type StoredFileInfo } from '../storage';
import type { Justificatif } from '../types';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  checkJustifMeta,
  extOf,
  type UploadRef,
} from '../justif-allowed';
import { JustificatifValidationError } from './justificatifs';

export const TELEVERSEMENTS_ROOT = 'televersements';

export interface TeleversementOwner {
  groupId: string;
  userId: string;
}

export interface Televersement {
  pathname: string;
  group_id: string;
  user_id: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  source: string;
  created_at: string;
  justificatif_id: string | null;
  claimed_at: string | null;
  // Cible du premier rattachement, figée (cf. `depotFilesSql`).
  entity_type: string | null;
  entity_id: string | null;
}

// Préfixe imposé à tout téléversement : le groupe ET l'utilisateur. Un
// user ne peut ni signer un upload hors de son préfixe, ni rattacher un
// fichier téléversé par quelqu'un d'autre (même groupe compris).
export function televersementPrefix(owner: TeleversementOwner): string {
  return `${TELEVERSEMENTS_ROOT}/${owner.groupId}/${owner.userId}/`;
}

// Un blob public serait lisible par quiconque devine son URL : on refuse
// de l'inscrire. Les URLs Vercel Blob portent l'accès dans le host
// (`<store>.public.blob.vercel-storage.com`).
export function isPublicBlobUrl(url: string | null | undefined): boolean {
  return !!url && /\.public\.blob\.vercel-storage\.com/i.test(url);
}

// Le fichier est-il bien sous le préfixe de son propriétaire, sans
// sous-dossier ni remontée ? `addRandomSuffix` de Blob ajoute un suffixe
// au nom, d'où la comparaison sur le préfixe seulement.
function isUnderPrefix(pathname: string, owner: TeleversementOwner): boolean {
  const prefix = televersementPrefix(owner);
  if (!pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  return rest.length > 0 && !rest.includes('/') && !rest.includes('\\') && !rest.includes('..');
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

// ---------------------------------------------------------------------------
// 1. Signature du token d'upload
// ---------------------------------------------------------------------------

export interface UploadClientPayload {
  filename: string;
  size: number;
  contentType: string;
}

interface TokenPayload {
  groupId: string;
  userId: string;
  filename: string;
}

function parseClientPayload(raw: string | null | undefined): UploadClientPayload {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const p = parsed as Partial<UploadClientPayload> | null;
  if (
    !p ||
    typeof p.filename !== 'string' ||
    typeof p.size !== 'number' ||
    !Number.isFinite(p.size) ||
    p.size < 0 ||
    typeof p.contentType !== 'string'
  ) {
    throw new JustificatifValidationError('Demande d’envoi invalide.');
  }
  return { filename: p.filename, size: p.size, contentType: p.contentType };
}

// Options du token client délivré par `handleUpload` : tout ce que le
// navigateur pourra envoyer est décidé ICI, côté serveur. Lève
// `JustificatifValidationError` si la demande est refusée (le token n'est
// alors jamais émis).
export function buildUploadTokenOptions(
  owner: TeleversementOwner,
  pathname: string,
  clientPayloadRaw: string | null | undefined,
): {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  addRandomSuffix: boolean;
  allowOverwrite: boolean;
  tokenPayload: string;
} {
  if (!isUnderPrefix(pathname, owner)) {
    throw new JustificatifValidationError('Emplacement d’envoi non autorisé.');
  }
  const payload = parseClientPayload(clientPayloadRaw);
  if (extOf(pathname) !== extOf(payload.filename)) {
    throw new JustificatifValidationError('Nom de fichier incohérent.');
  }
  if (!ALLOWED_MIME_TYPES.has(payload.contentType)) {
    throw new JustificatifValidationError(`Type MIME non autorisé : ${payload.contentType || '(vide)'}.`);
  }
  const err = checkJustifMeta({
    filename: payload.filename,
    size: payload.size,
    mime_type: payload.contentType,
  });
  if (err) throw new JustificatifValidationError(err);

  const tokenPayload: TokenPayload = {
    groupId: owner.groupId,
    userId: owner.userId,
    filename: payload.filename,
  };
  return {
    // Imposés par Vercel Blob à l'upload, indépendamment de ce que
    // déclare le client : type hors whitelist ou fichier trop gros → rejet.
    allowedContentTypes: [...ALLOWED_MIME_TYPES],
    maximumSizeInBytes: MAX_FILE_SIZE_BYTES,
    addRandomSuffix: true,
    allowOverwrite: false,
    tokenPayload: JSON.stringify(tokenPayload),
  };
}

// ---------------------------------------------------------------------------
// 2. Inscription
// ---------------------------------------------------------------------------

async function insertTeleversement(
  row: Omit<Televersement, 'justificatif_id' | 'claimed_at' | 'created_at' | 'entity_type' | 'entity_id'>,
  db: DbWrapper,
): Promise<void> {
  // Idempotent : callback rejoué, ou callback + repli serveur sur un
  // déploiement de preview → une seule ligne.
  await db
    .prepare(
      `INSERT INTO justificatifs_televersements
         (pathname, group_id, user_id, original_filename, mime_type, size_bytes, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pathname) DO NOTHING`,
    )
    .run(
      row.pathname,
      row.group_id,
      row.user_id,
      row.original_filename,
      row.mime_type,
      row.size_bytes,
      row.source,
      currentTimestamp(),
    );
}

// Callback `onUploadCompleted` (prod). `tokenPayload` vient du token signé
// à l'étape 1 : le propriétaire n'est pas déclaré par le client.
export async function recordUploadCompleted(
  blob: { pathname: string; contentType?: string | null; url?: string | null },
  tokenPayloadRaw: string | null | undefined,
  db: DbWrapper = getDb(),
): Promise<void> {
  let payload: TokenPayload;
  try {
    payload = JSON.parse(tokenPayloadRaw ?? '') as TokenPayload;
  } catch {
    throw new JustificatifValidationError('Callback d’upload sans propriétaire.');
  }
  if (!payload?.groupId || !payload?.userId || !payload?.filename) {
    throw new JustificatifValidationError('Callback d’upload sans propriétaire.');
  }
  const owner = { groupId: payload.groupId, userId: payload.userId };
  if (!isUnderPrefix(blob.pathname, owner)) {
    throw new JustificatifValidationError('Callback d’upload hors du préfixe du propriétaire.');
  }
  if (isPublicBlobUrl(blob.url)) {
    throw new JustificatifValidationError('Blob public refusé : les justificatifs doivent rester privés.');
  }
  const err = checkJustifMeta({ filename: payload.filename, size: null, mime_type: blob.contentType ?? null });
  if (err) throw new JustificatifValidationError(err);

  await insertTeleversement(
    {
      pathname: blob.pathname,
      group_id: owner.groupId,
      user_id: owner.userId,
      original_filename: payload.filename,
      mime_type: blob.contentType ?? null,
      size_bytes: null,
      source: 'callback',
    },
    db,
  );
}

// Envoi en mode `local` (pas de Blob configuré) : le serveur reçoit le
// fichier lui-même, l'écrit et l'inscrit directement.
export async function recordLocalUpload(
  owner: TeleversementOwner,
  input: { pathname: string; filename: string; size: number; mime_type: string | null },
  db: DbWrapper = getDb(),
): Promise<void> {
  await insertTeleversement(
    {
      pathname: input.pathname,
      group_id: owner.groupId,
      user_id: owner.userId,
      original_filename: input.filename,
      mime_type: input.mime_type,
      size_bytes: input.size,
      source: 'local',
    },
    db,
  );
}

// ---------------------------------------------------------------------------
// 3. Soumission du formulaire : résolution puis rattachement
// ---------------------------------------------------------------------------

// Lit les références soumises sous un nom de champ. Les valeurs non
// textuelles (anciens `<input type="file">`) et vides sont ignorées.
export function parseUploadRefs(values: FormDataEntryValue[]): UploadRef[] {
  const refs: UploadRef[] = [];
  for (const v of values) {
    if (typeof v !== 'string' || v.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      throw new JustificatifValidationError('Pièce jointe illisible, renvoie le fichier.');
    }
    const r = parsed as Partial<UploadRef> | null;
    if (!r || typeof r.pathname !== 'string' || typeof r.filename !== 'string') {
      throw new JustificatifValidationError('Pièce jointe illisible, renvoie le fichier.');
    }
    refs.push({ pathname: r.pathname, filename: r.filename });
  }
  return refs;
}

export interface ResolveDeps {
  db?: DbWrapper;
  head?: (pathname: string) => Promise<StoredFileInfo | null>;
  isProduction?: boolean;
  // Attente du callback en prod (il arrive normalement dans la seconde).
  callbackWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const CALLBACK_POLL_MS = 500;
const DEFAULT_CALLBACK_WAIT_MS = 6_000;

async function getTeleversement(db: DbWrapper, pathname: string): Promise<Televersement | null> {
  return (
    (await db
      .prepare('SELECT * FROM justificatifs_televersements WHERE pathname = ?')
      .get<Televersement>(pathname)) ?? null
  );
}

// Vérifie chaque référence et renvoie les téléversements correspondants,
// prêts à rattacher. Échoue (JustificatifValidationError) AVANT toute
// écriture métier si une référence est invalide, étrangère, déjà utilisée
// ou introuvable.
export async function resolveTeleversements(
  owner: TeleversementOwner,
  refs: UploadRef[],
  deps: ResolveDeps = {},
): Promise<Televersement[]> {
  const db = deps.db ?? getDb();
  const prod = deps.isProduction ?? isProduction();
  const head = deps.head ?? ((p: string) => getStorage().head(p));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = deps.callbackWaitMs ?? DEFAULT_CALLBACK_WAIT_MS;

  const out: Televersement[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.pathname)) continue;
    seen.add(ref.pathname);

    if (!isUnderPrefix(ref.pathname, owner)) {
      throw new JustificatifValidationError(`${ref.filename} : fichier introuvable pour ton compte.`);
    }

    let row = await getTeleversement(db, ref.pathname);

    if (!row && prod) {
      // Le navigateur a fini l'upload ; le callback Vercel peut avoir
      // quelques centaines de ms de retard sur le submit.
      for (let waited = 0; !row && waited < waitMs; waited += CALLBACK_POLL_MS) {
        await sleep(CALLBACK_POLL_MS);
        row = await getTeleversement(db, ref.pathname);
      }
      if (!row) {
        throw new JustificatifValidationError(
          `${ref.filename} : envoi pas encore confirmé par le stockage. Réessaie dans quelques secondes.`,
        );
      }
    }

    if (!row) {
      // Repli HORS PROD : le callback ne part pas en dev local. Le serveur
      // constate lui-même le fichier dans le storage avant de l'inscrire.
      const info = await head(ref.pathname);
      if (!info) {
        throw new JustificatifValidationError(`${ref.filename} : fichier introuvable dans le stockage.`);
      }
      if (isPublicBlobUrl(info.url)) {
        throw new JustificatifValidationError(`${ref.filename} : fichier public refusé.`);
      }
      const err = checkJustifMeta({ filename: ref.filename, size: info.size, mime_type: info.contentType });
      if (err) throw new JustificatifValidationError(`${ref.filename} : ${err}`);
      if (extOf(ref.filename) !== extOf(ref.pathname)) {
        throw new JustificatifValidationError(`${ref.filename} : nom de fichier incohérent.`);
      }
      await insertTeleversement(
        {
          pathname: ref.pathname,
          group_id: owner.groupId,
          user_id: owner.userId,
          original_filename: ref.filename,
          mime_type: info.contentType,
          size_bytes: info.size,
          source: 'serveur',
        },
        db,
      );
      row = await getTeleversement(db, ref.pathname);
      if (!row) throw new Error(`Téléversement ${ref.pathname} non inscrit.`);
    }

    if (row.group_id !== owner.groupId || row.user_id !== owner.userId) {
      throw new JustificatifValidationError(`${ref.filename} : fichier introuvable pour ton compte.`);
    }
    if (row.justificatif_id) {
      throw new JustificatifValidationError(`${row.original_filename} : fichier déjà rattaché à une autre pièce.`);
    }
    const err = checkJustifMeta({
      filename: row.original_filename,
      size: row.size_bytes,
      mime_type: row.mime_type,
    });
    if (err) throw new JustificatifValidationError(`${row.original_filename} : ${err}`);

    out.push(row);
  }
  return out;
}

// Raccourci des server actions : lit le champ `field` du formulaire et
// résout ses références.
export async function resolveTeleversementsFromForm(
  owner: TeleversementOwner,
  formData: FormData,
  field: string,
  deps: ResolveDeps = {},
): Promise<Televersement[]> {
  return resolveTeleversements(owner, parseUploadRefs(formData.getAll(field)), deps);
}

// Condition SQL « fichier appartenant au dépôt `depotIdExpr` », sur la
// colonne `file_path` de `justificatifs`. L'appartenance est figée à la
// création du dépôt, indépendamment de l'entité vers laquelle la ligne
// pointe aujourd'hui (le rattachement la re-pointe vers l'écriture) :
// - fichier envoyé par le serveur → chemin `depot/<id>/…` ;
// - téléversement direct → chemin `televersements/…`, dont le premier
//   rattachement est noté dans `justificatifs_televersements`.
// `depotIdExpr` est une expression SQL (`d.id`, ou `?` : passer alors
// l'id DEUX fois dans les paramètres).
export function depotFilesSql(depotIdExpr: string): string {
  return `(file_path LIKE 'depot/' || ${depotIdExpr} || '/%' OR file_path IN (
    SELECT t.pathname FROM justificatifs_televersements t
    WHERE t.entity_type = 'depot' AND t.entity_id = ${depotIdExpr}))`;
}

// Crée la ligne `justificatifs` d'un téléversement résolu. Le fichier est
// déjà dans le storage, au chemin `pathname` : rien n'est recopié. Le
// claim (UPDATE … WHERE justificatif_id IS NULL) passe en premier pour
// qu'un même téléversement ne produise jamais deux pièces, même en cas de
// double soumission concurrente.
export async function attachTeleversement(
  owner: TeleversementOwner,
  tv: Televersement,
  target: { entity_type: string; entity_id: string },
  db: DbWrapper = getDb(),
): Promise<Justificatif> {
  const id = await nextId('JUS');
  const now = currentTimestamp();
  const claim = await db
    .prepare(
      `UPDATE justificatifs_televersements
       SET justificatif_id = ?, claimed_at = ?, entity_type = ?, entity_id = ?
       WHERE pathname = ? AND group_id = ? AND user_id = ? AND justificatif_id IS NULL`,
    )
    .run(id, now, target.entity_type, target.entity_id, tv.pathname, owner.groupId, owner.userId);
  if (claim.changes === 0) {
    throw new JustificatifValidationError(`${tv.original_filename} : fichier déjà rattaché à une autre pièce.`);
  }

  await db
    .prepare(
      `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, owner.groupId, tv.pathname, tv.original_filename, tv.mime_type, target.entity_type, target.entity_id, now);

  return (await db.prepare('SELECT * FROM justificatifs WHERE id = ?').get<Justificatif>(id))!;
}
