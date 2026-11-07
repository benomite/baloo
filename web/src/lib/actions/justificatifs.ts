'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { marquerJustificatifObsolete } from '../services/justificatifs';
import { attachTeleversement, resolveTeleversementsFromForm } from '../services/justif-televersements';
import { requireAdmin } from '../auth/access';

// Rattache un justificatif DÉJÀ téléversé (navigateur → storage, ticket
// #28) : le formulaire soumet une référence sous `file`, vérifiée côté
// serveur (propriétaire, type, taille) avant de créer la pièce.
export async function uploadJustificatif(formData: FormData) {
  const entityType = formData.get('entity_type') as string;
  const entityId = formData.get('entity_id') as string;
  if (!entityType || !entityId) return;

  const ctx = await getCurrentContext();
  const televersements = await resolveTeleversementsFromForm(ctx, formData, 'file');
  if (televersements.length === 0) return;

  for (const tv of televersements) {
    await attachTeleversement(ctx, tv, { entity_type: entityType, entity_id: entityId });
  }

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
