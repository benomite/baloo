'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentContext } from '../context';
import {
  createRepartition,
  updateRepartition,
  deleteRepartition,
  RepartitionValidationError,
} from '../services/repartitions';
import { parseAmount } from '../format';

const ADMIN_ROLES = ['tresorier', 'RG'];

async function assertAdmin() {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    throw new Error('Accès refusé');
  }
  return ctx;
}

function nullIfEmpty(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
}

const createSchema = z.object({
  date_repartition: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  saison: z.string().regex(/^\d{4}-\d{4}$/),
  amount: z.string().min(1),
  unite_source_id: z.string().nullable(),
  unite_cible_id: z.string().nullable(),
  libelle: z.string().min(1),
  notes: z.string().nullable(),
});

// Pattern useFormState compatible : la page client peut afficher le message.
export interface RepartitionFormState { error: string | null }

export async function createRepartitionAction(
  _prev: RepartitionFormState,
  formData: FormData,
): Promise<RepartitionFormState> {
  const ctx = await assertAdmin();
  let parsed;
  try {
    parsed = createSchema.parse({
      date_repartition: formData.get('date_repartition'),
      saison: formData.get('saison'),
      amount: formData.get('amount'),
      unite_source_id: nullIfEmpty(formData.get('unite_source_id')),
      unite_cible_id: nullIfEmpty(formData.get('unite_cible_id')),
      libelle: formData.get('libelle'),
      notes: nullIfEmpty(formData.get('notes')),
    });
  } catch {
    return { error: 'Champs invalides — vérifie date, saison, montant et libellé.' };
  }
  try {
    await createRepartition(
      { groupId: ctx.groupId },
      {
        date_repartition: parsed.date_repartition,
        saison: parsed.saison,
        montant_cents: parseAmount(parsed.amount),
        unite_source_id: parsed.unite_source_id,
        unite_cible_id: parsed.unite_cible_id,
        libelle: parsed.libelle,
        notes: parsed.notes,
      },
    );
  } catch (e) {
    if (e instanceof RepartitionValidationError) {
      return { error: e.message };
    }
    throw e;
  }
  revalidatePath('/synthese');
  revalidatePath('/synthese/unite/[id]', 'page');
  return { error: null };
}

const updateFieldSchema = z.object({
  id: z.string().min(1),
  field: z.enum(['date_repartition', 'amount', 'libelle', 'notes']),
  value: z.string().nullable(),
});

export async function updateRepartitionAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = updateFieldSchema.parse({
    id: formData.get('id'),
    field: formData.get('field'),
    value: formData.get('value'),
  });
  const v = parsed.value;
  let patch: Parameters<typeof updateRepartition>[2];
  switch (parsed.field) {
    case 'date_repartition': patch = { date_repartition: v ?? '' }; break;
    case 'amount': patch = { montant_cents: v ? parseAmount(v) : 0 }; break;
    case 'libelle': patch = { libelle: v ?? '' }; break;
    case 'notes': patch = { notes: v && v.trim() !== '' ? v : null }; break;
  }
  try {
    await updateRepartition({ groupId: ctx.groupId }, parsed.id, patch);
  } catch (e) {
    if (e instanceof RepartitionValidationError) {
      // Edition inline : on swallow l'erreur pour ne pas casser l'UI.
      // L'utilisateur verra que le champ n'a pas changé en rechargeant.
      return;
    }
    throw e;
  }
  revalidatePath('/synthese');
  revalidatePath('/synthese/unite/[id]', 'page');
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function deleteRepartitionAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = deleteSchema.parse({ id: formData.get('id') });
  await deleteRepartition({ groupId: ctx.groupId }, parsed.id);
  revalidatePath('/synthese');
  revalidatePath('/synthese/unite/[id]', 'page');
}
