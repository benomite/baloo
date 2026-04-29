// Orchestration : signer une demande de remboursement et régénérer le
// PDF feuille avec l'encart Signatures à jour. Centralisé ici pour
// éviter de dupliquer la logique entre la création (signature
// demandeur) et les transitions (signatures trésorier / RG).

import { getDb } from '../db';
import {
  computeRemboursementHash,
  getRemboursement,
  listLignes,
} from './remboursements';
import { signDocument, listSignatures, type SignerRole } from './signatures';
import { attachJustificatif } from './justificatifs';
import { renderFeuilleRemboursementPdf } from '../pdf/feuille-remboursement';

interface SignAndRefreshInput {
  groupId: string;
  rbtId: string;
  signerRole: SignerRole;
  signerUserId: string | null;
  signerEmail: string;
  signerName: string | null;
  ip: string | null;
  userAgent: string | null;
}

export async function signAndRefreshRemboursementPdf(input: SignAndRefreshInput): Promise<void> {
  const rbt = await getRemboursement({ groupId: input.groupId }, input.rbtId);
  if (!rbt) throw new Error(`Remboursement ${input.rbtId} introuvable.`);

  const lignes = await listLignes(input.rbtId);
  const dataHash = computeRemboursementHash(rbt, lignes);

  await signDocument({
    document_type: 'remboursement',
    document_id: input.rbtId,
    signer_role: input.signerRole,
    signer_user_id: input.signerUserId,
    signer_email: input.signerEmail,
    signer_name: input.signerName,
    data_hash: dataHash,
    ip: input.ip,
    user_agent: input.userAgent,
  });

  // Régénère le PDF avec l'encart Signatures à jour.
  const groupRow = await getDb()
    .prepare('SELECT nom FROM groupes WHERE id = ?')
    .get<{ nom: string }>(input.groupId);
  const allSigs = await listSignatures('remboursement', input.rbtId);
  const pdfBuffer = await renderFeuilleRemboursementPdf({
    rbt,
    lignes,
    groupName: groupRow?.nom ?? 'le groupe',
    submittedAt: new Date().toISOString().slice(0, 10),
    signatures: allSigs,
  });
  await attachJustificatif(
    { groupId: input.groupId },
    {
      entity_type: 'remboursement_feuille',
      entity_id: input.rbtId,
      filename: `feuille-${input.rbtId}.pdf`,
      content: pdfBuffer,
      mime_type: 'application/pdf',
    },
  );
}
