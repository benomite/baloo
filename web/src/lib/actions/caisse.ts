'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { parseAmount } from '../format';

export async function createMouvementCaisse(formData: FormData) {
  const id = nextId('CAI');
  const now = currentTimestamp();
  const cents = parseAmount(formData.get('montant') as string);

  const soldeBefore = getDb().prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse').get() as { total: number };
  const soldeAfter = soldeBefore.total + cents;

  getDb().prepare(`
    INSERT INTO mouvements_caisse (id, date_mouvement, description, amount_cents, solde_apres_cents, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, formData.get('date_mouvement'), formData.get('description'), cents, soldeAfter, formData.get('notes') || null, now);

  revalidatePath('/caisse');
  revalidatePath('/');
}
