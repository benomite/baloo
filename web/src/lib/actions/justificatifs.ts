'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { attachJustificatif, marquerJustificatifObsolete } from '../services/justificatifs';
import { requireAdmin } from '../auth/access';

export async function uploadJustificatif(formData: FormData) {
  const file = formData.get('file') as File;
  const entityType = formData.get('entity_type') as string;
  const entityId = formData.get('entity_id') as string;

  if (!file || !entityType || !entityId) return;

  await attachJustificatif(
    { groupId: (await getCurrentContext()).groupId },
    {
      entity_type: entityType,
      entity_id: entityId,
      filename: file.name,
      content: Buffer.from(await file.arrayBuffer()),
    },
  );

  revalidatePath(`/ecritures/${entityId}`);
  revalidatePath(`/remboursements/${entityId}`);
}

// Retire un justificatif des pièces actives (remplacé / erroné). Le fichier et
// la ligne restent en base — cf. `marquerJustificatifObsolete`. Réservé aux
// admins : c'est une pièce comptable, pas au demandeur d'en retirer une.
export async function retirerJustificatif(formData: FormData): Promise<void> {
  const justificatifId = formData.get('justificatif_id') as string | null;
  const entityId = formData.get('entity_id') as string | null;
  if (!justificatifId || !entityId) return;

  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  await marquerJustificatifObsolete({ groupId: ctx.groupId }, justificatifId);

  revalidatePath(`/remboursements/${entityId}`);
  revalidatePath(`/ecritures/${entityId}`);
  revalidatePath('/inbox');
}
