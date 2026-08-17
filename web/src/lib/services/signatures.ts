import { createHash, randomUUID } from 'node:crypto';
import { getDb, type DbWrapper } from '../db';
import { currentTimestamp } from '../ids';
import { nullIfEmpty } from '../utils/form';

// Service de signature électronique simple (ADR-023).
//
// Stocke un audit trail immuable : qui a signé quoi, quand, depuis où,
// avec un hash des données signées et un chaînage type mini-blockchain
// (chaque signature embarque le hash de la précédente). Pas de TSA
// externe au MVP : champs `tsa_response`/`tsa_timestamp` restent NULL,
// prévus pour une évolution RFC 3161 ultérieure.
//
// La preuve juridique vit dans cette table, pas dans le PDF (qui est
// régénéré à chaque signature et n'est qu'un rendu lisible).

export type SignerRole = 'demandeur' | 'tresorier' | 'RG' | 'cotresorier';

export interface Signature {
  id: string;
  document_type: string;
  document_id: string;
  signer_role: SignerRole;
  signer_user_id: string | null;
  signer_email: string;
  signer_name: string | null;
  data_hash: string;
  previous_signature_id: string | null;
  chain_hash: string;
  ip: string | null;
  user_agent: string | null;
  server_timestamp: string;
  tsa_response: string | null;
  tsa_timestamp: string | null;
  // Signature rendue caduque par une édition du document (le contenu signé a
  // changé). On la GARDE — c'est une preuve d'audit — mais elle sort de la
  // chaîne courante. Cf. `supersedeSignatures`.
  superseded_at: string | null;
  created_at: string;
}

export interface SignDocumentInput {
  document_type: string;
  document_id: string;
  signer_role: SignerRole;
  signer_user_id?: string | null;
  signer_email: string;
  signer_name?: string | null;
  data_hash: string;
  ip?: string | null;
  user_agent?: string | null;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function signDocument(
  input: SignDocumentInput,
  db: DbWrapper = getDb(),
): Promise<Signature> {
  const id = randomUUID();
  const serverTimestamp = currentTimestamp();

  // Récupère la dernière signature ACTIVE du document pour le chaînage : une
  // signature périmée ne doit pas être chaînée (sinon la nouvelle chaîne
  // hérite d'un maillon qui ne correspond plus au contenu).
  const previous = await db
    .prepare(
      `SELECT id, chain_hash FROM signatures
       WHERE document_type = ? AND document_id = ? AND superseded_at IS NULL
       ORDER BY server_timestamp DESC, created_at DESC LIMIT 1`,
    )
    .get<{ id: string; chain_hash: string }>(input.document_type, input.document_id);

  const previousChainHash = previous?.chain_hash ?? '';

  // chain_hash = SHA-256 de la concaténation : hash précédent + données +
  // identité signataire + timestamp serveur. Toute modification a
  // posteriori d'une ligne casse la chaîne suivante.
  const chainPayload = [
    previousChainHash,
    input.data_hash,
    input.signer_role,
    input.signer_email,
    serverTimestamp,
  ].join('|');
  const chain_hash = sha256(chainPayload);

  await db.prepare(
    `INSERT INTO signatures (
       id, document_type, document_id, signer_role, signer_user_id,
       signer_email, signer_name, data_hash, previous_signature_id,
       chain_hash, ip, user_agent, server_timestamp, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.document_type,
    input.document_id,
    input.signer_role,
    nullIfEmpty(input.signer_user_id),
    input.signer_email,
    nullIfEmpty(input.signer_name),
    input.data_hash,
    previous?.id ?? null,
    chain_hash,
    nullIfEmpty(input.ip),
    nullIfEmpty(input.user_agent),
    serverTimestamp,
    serverTimestamp,
  );

  return (await db.prepare('SELECT * FROM signatures WHERE id = ?').get<Signature>(id))!;
}

// Par défaut : la chaîne COURANTE seulement. `includeSuperseded` sert à
// l'audit (retracer les validations d'une version antérieure du document).
export async function listSignatures(
  document_type: string,
  document_id: string,
  db: DbWrapper = getDb(),
  opts: { includeSuperseded?: boolean } = {},
): Promise<Signature[]> {
  const filtreActives = opts.includeSuperseded ? '' : ' AND superseded_at IS NULL';
  return await db
    .prepare(
      `SELECT * FROM signatures
       WHERE document_type = ? AND document_id = ?${filtreActives}
       ORDER BY server_timestamp ASC, created_at ASC`,
    )
    .all<Signature>(document_type, document_id);
}

// Marque périmées les signatures actives d'un document, sans rien supprimer.
// Appelé quand une édition change le contenu signé : les validations portaient
// sur une autre version, elles ne valent plus — mais elles restent traçables.
// Idempotent : une date déjà posée n'est pas réécrite.
export async function supersedeSignatures(
  document_type: string,
  document_id: string,
  db: DbWrapper = getDb(),
): Promise<number> {
  const actives = await listSignatures(document_type, document_id, db);
  if (actives.length === 0) return 0;
  await db
    .prepare(
      `UPDATE signatures SET superseded_at = ?
        WHERE document_type = ? AND document_id = ? AND superseded_at IS NULL`,
    )
    .run(currentTimestamp(), document_type, document_id);
  return actives.length;
}

// Vérifie l'intégrité de la chaîne : recalcule chain_hash de chaque
// signature et compare. Retourne `true` si toutes les signatures sont
// cohérentes, `false` si une modification est détectée.
export async function verifyChain(
  document_type: string,
  document_id: string,
  db: DbWrapper = getDb(),
): Promise<{ ok: boolean; brokenAt?: string }> {
  const sigs = await listSignatures(document_type, document_id, db);
  let prev = '';
  for (const s of sigs) {
    const expected = sha256([
      prev,
      s.data_hash,
      s.signer_role,
      s.signer_email,
      s.server_timestamp,
    ].join('|'));
    if (expected !== s.chain_hash) {
      return { ok: false, brokenAt: s.id };
    }
    prev = s.chain_hash;
  }
  return { ok: true };
}
