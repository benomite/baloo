'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { attachJustificatif } from '../services/justificatifs';

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
