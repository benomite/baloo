import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { currentTimestamp } from '../ids';

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

export async function signDocument(input: SignDocumentInput): Promise<Signature> {
  const db = getDb();
  const id = randomUUID();
  const serverTimestamp = currentTimestamp();

  // Récupère la dernière signature du document pour le chaînage.
  const previous = await db
    .prepare(
      `SELECT id, chain_hash FROM signatures
       WHERE document_type = ? AND document_id = ?
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
    input.signer_user_id ?? null,
    input.signer_email,
    input.signer_name ?? null,
    input.data_hash,
    previous?.id ?? null,
    chain_hash,
    input.ip ?? null,
    input.user_agent ?? null,
    serverTimestamp,
    serverTimestamp,
  );

  return (await db.prepare('SELECT * FROM signatures WHERE id = ?').get<Signature>(id))!;
}

export async function listSignatures(
  document_type: string,
  document_id: string,
): Promise<Signature[]> {
  return await getDb()
    .prepare(
      `SELECT * FROM signatures
       WHERE document_type = ? AND document_id = ?
       ORDER BY server_timestamp ASC, created_at ASC`,
    )
    .all<Signature>(document_type, document_id);
}

// Vérifie l'intégrité de la chaîne : recalcule chain_hash de chaque
// signature et compare. Retourne `true` si toutes les signatures sont
// cohérentes, `false` si une modification est détectée.
export async function verifyChain(
  document_type: string,
  document_id: string,
): Promise<{ ok: boolean; brokenAt?: string }> {
  const sigs = await listSignatures(document_type, document_id);
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
