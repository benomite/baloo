'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentContext } from '../context';
import {
  createBudget,
  createBudgetLigne,
  updateBudgetLigne,
  deleteBudgetLigne,
  updateBudgetStatut,
  listBudgets,
  type BudgetStatut,
} from '../services/budgets';
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

// Garantit qu'un budget existe pour la saison ; le crée en 'projet' sinon.
export async function ensureBudgetForSaisonAction(saison: string): Promise<string> {
  z.string().min(9).parse(saison); // 'YYYY-YYYY' minimum
  const ctx = await assertAdmin();
  const existing = await listBudgets({ groupId: ctx.groupId }, { saison });
  if (existing.length > 0) return existing[0].id;
  const created = await createBudget({ groupId: ctx.groupId }, { saison });
  revalidatePath('/budgets');
  return created.id;
}

const createLigneSchema = z.object({
  budget_id: z.string().min(1),
  libelle: z.string().min(1),
  type: z.enum(['depense', 'recette']),
  amount: z.string().min(1), // format français "12,50"
  unite_id: z.string().optional().nullable(),
  category_id: z.string().optional().nullable(),
  activite_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function createBudgetLigneAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = createLigneSchema.parse({
    budget_id: formData.get('budget_id'),
    libelle: formData.get('libelle'),
    type: formData.get('type'),
    amount: formData.get('amount'),
    unite_id: nullIfEmpty(formData.get('unite_id')),
    category_id: nullIfEmpty(formData.get('category_id')),
    activite_id: nullIfEmpty(formData.get('activite_id')),
    notes: nullIfEmpty(formData.get('notes')),
  });
  await createBudgetLigne(
    { groupId: ctx.groupId },
    {
      budget_id: parsed.budget_id,
      libelle: parsed.libelle,
      type: parsed.type,
      amount_cents: parseAmount(parsed.amount),
      unite_id: parsed.unite_id,
      category_id: parsed.category_id,
      activite_id: parsed.activite_id,
      notes: parsed.notes,
    },
  );
  revalidatePath('/budgets');
}

const updateLigneSchema = z.object({
  ligne_id: z.string().min(1),
  field: z.enum(['libelle', 'type', 'amount', 'unite_id', 'category_id', 'activite_id', 'notes']),
  value: z.string().nullable(),
});

export async function updateBudgetLigneAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const rawValue = formData.get('value');
  const parsed = updateLigneSchema.parse({
    ligne_id: formData.get('ligne_id'),
    field: formData.get('field'),
    value: rawValue === null ? null : String(rawValue),
  });
  const v = parsed.value;
  let patch: Parameters<typeof updateBudgetLigne>[2];
  switch (parsed.field) {
    case 'libelle':
      patch = { libelle: v ?? '' };
      break;
    case 'type':
      patch = { type: v as 'depense' | 'recette' };
      break;
    case 'amount':
      patch = { amount_cents: v ? parseAmount(v) : 0 };
      break;
    case 'unite_id':
      patch = { unite_id: v && v.trim() !== '' ? v : null };
      break;
    case 'category_id':
      patch = { category_id: v && v.trim() !== '' ? v : null };
      break;
    case 'activite_id':
      patch = { activite_id: v && v.trim() !== '' ? v : null };
      break;
    case 'notes':
      patch = { notes: v && v.trim() !== '' ? v : null };
      break;
  }
  await updateBudgetLigne({ groupId: ctx.groupId }, parsed.ligne_id, patch);
  revalidatePath('/budgets');
}

const deleteSchema = z.object({ ligne_id: z.string().min(1) });

export async function deleteBudgetLigneAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = deleteSchema.parse({ ligne_id: formData.get('ligne_id') });
  await deleteBudgetLigne({ groupId: ctx.groupId }, parsed.ligne_id);
  revalidatePath('/budgets');
}

const statutSchema = z.object({
  budget_id: z.string().min(1),
  statut: z.enum(['projet', 'vote', 'cloture']),
});

export async function updateBudgetStatutAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = statutSchema.parse({
    budget_id: formData.get('budget_id'),
    statut: formData.get('statut'),
  });
  await updateBudgetStatut(
    { groupId: ctx.groupId },
    parsed.budget_id,
    parsed.statut as BudgetStatut,
  );
  revalidatePath('/budgets');
}
