'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { parseAmount } from '../format';

export async function createRemboursement(formData: FormData) {
  const id = nextId('RBT');
  const now = currentTimestamp();

  getDb().prepare(`
    INSERT INTO remboursements (id, demandeur, amount_cents, date_depense, nature, unite_id, justificatif_status, mode_paiement_id, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    formData.get('demandeur'),
    parseAmount(formData.get('montant') as string),
    formData.get('date_depense'),
    formData.get('nature'),
    formData.get('unite_id') || null,
    formData.get('justificatif_status') || 'en_attente',
    formData.get('mode_paiement_id') || null,
    formData.get('notes') || null,
    now,
    now,
  );

  revalidatePath('/remboursements');
  revalidatePath('/');
  redirect(`/remboursements/${id}`);
}

export async function updateRemboursementStatus(id: string, status: string) {
  const now = currentTimestamp();
  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const values: unknown[] = [status, now];

  if (status === 'paye') {
    updates.push('date_paiement = ?');
    values.push(now.split('T')[0]);
  }

  values.push(id);
  getDb().prepare(`UPDATE remboursements SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  revalidatePath('/remboursements');
  revalidatePath(`/remboursements/${id}`);
  revalidatePath('/');
}
