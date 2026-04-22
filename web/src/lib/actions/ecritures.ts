'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { parseAmount } from '../format';

export async function createEcriture(formData: FormData) {
  const type = formData.get('type') as string;
  const prefix = type === 'depense' ? 'DEP' : 'REC';
  const id = nextId(prefix);
  const now = currentTimestamp();
  // Checkbox HTML : présente (cochée) = 'on', absente = null. Défaut = attendu.
  const justifAttendu = formData.has('justif_attendu') ? 1 : 0;

  getDb().prepare(`
    INSERT INTO ecritures (id, date_ecriture, description, amount_cents, type, unite_id, category_id, mode_paiement_id, activite_id, numero_piece, justif_attendu, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    formData.get('date_ecriture'),
    formData.get('description'),
    parseAmount(formData.get('montant') as string),
    type,
    formData.get('unite_id') || null,
    formData.get('category_id') || null,
    formData.get('mode_paiement_id') || null,
    formData.get('activite_id') || null,
    formData.get('numero_piece') || null,
    justifAttendu,
    formData.get('notes') || null,
    now,
    now,
  );

  revalidatePath('/ecritures');
  revalidatePath('/');
  redirect(`/ecritures/${id}`);
}

export async function updateEcriture(id: string, formData: FormData) {
  const now = currentTimestamp();
  const montant = formData.get('montant');
  // Checkbox HTML : présente (cochée) = 'on', absente = null. Défaut = attendu.
  const justifAttendu = formData.has('justif_attendu') ? 1 : 0;

  getDb().prepare(`
    UPDATE ecritures SET
      date_ecriture = ?, description = ?, amount_cents = ?, type = ?,
      unite_id = ?, category_id = ?, mode_paiement_id = ?, activite_id = ?,
      numero_piece = ?, justif_attendu = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    formData.get('date_ecriture'),
    formData.get('description'),
    parseAmount(montant as string),
    formData.get('type'),
    formData.get('unite_id') || null,
    formData.get('category_id') || null,
    formData.get('mode_paiement_id') || null,
    formData.get('activite_id') || null,
    formData.get('numero_piece') || null,
    justifAttendu,
    formData.get('notes') || null,
    now,
    id,
  );

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
  redirect(`/ecritures/${id}`);
}

export async function updateEcritureStatus(id: string, status: string) {
  const now = currentTimestamp();
  const comptaweb = status === 'saisie_comptaweb' ? 1 : undefined;

  if (comptaweb !== undefined) {
    getDb().prepare('UPDATE ecritures SET status = ?, comptaweb_synced = ?, updated_at = ? WHERE id = ?').run(status, comptaweb, now, id);
  } else {
    getDb().prepare('UPDATE ecritures SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
}
