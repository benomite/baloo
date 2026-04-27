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
    INSERT INTO ecritures (id, date_ecriture, description, amount_cents, type, unite_id, category_id, mode_paiement_id, activite_id, numero_piece, carte_id, justif_attendu, notes, created_at, updated_at)
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
    formData.get('carte_id') || null,
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
  const db = getDb();
  const now = currentTimestamp();
  const justifAttendu = formData.has('justif_attendu') ? 1 : 0;

  const current = db.prepare('SELECT status FROM ecritures WHERE id = ?').get(id) as { status: string } | undefined;
  if (!current) return;

  if (current.status === 'saisie_comptaweb') {
    // Une fois synchronisée avec Comptaweb, l'écriture devient en lecture seule
    // pour tout ce qui est sync (date, montant, type, unité, nature, etc.) afin
    // d'éviter un décalage silencieux avec Comptaweb. Les champs purement
    // internes à Baloo restent éditables.
    db.prepare(
      'UPDATE ecritures SET justif_attendu = ?, notes = ?, updated_at = ? WHERE id = ?',
    ).run(justifAttendu, formData.get('notes') || null, now, id);
  } else {
    db.prepare(`
      UPDATE ecritures SET
        date_ecriture = ?, description = ?, amount_cents = ?, type = ?,
        unite_id = ?, category_id = ?, mode_paiement_id = ?, activite_id = ?,
        numero_piece = ?, carte_id = ?, justif_attendu = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      formData.get('date_ecriture'),
      formData.get('description'),
      parseAmount(formData.get('montant') as string),
      formData.get('type'),
      formData.get('unite_id') || null,
      formData.get('category_id') || null,
      formData.get('mode_paiement_id') || null,
      formData.get('activite_id') || null,
      formData.get('numero_piece') || null,
      formData.get('carte_id') || null,
      justifAttendu,
      formData.get('notes') || null,
      now,
      id,
    );
  }

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
  redirect(`/ecritures/${id}`);
}

// Mise à jour d'un champ unique — utilisé pour l'édition inline depuis la
// table /ecritures (clic sur une cellule → select → save immédiat). Whitelist
// stricte de champs autorisés pour éviter toute injection. Refuse sur les
// écritures déjà synchronisées Comptaweb (sauf champs internes Baloo).
const INLINE_FIELDS_ALL = ['unite_id', 'category_id', 'activite_id', 'mode_paiement_id', 'carte_id'] as const;
const INLINE_FIELDS_INTERNAL = ['justif_attendu', 'notes'] as const;
type InlineField = (typeof INLINE_FIELDS_ALL)[number] | (typeof INLINE_FIELDS_INTERNAL)[number];

export async function updateEcritureField(
  id: string,
  field: InlineField,
  value: string | number | null,
): Promise<{ ok: boolean; message?: string }> {
  const isInternal = (INLINE_FIELDS_INTERNAL as readonly string[]).includes(field);
  const isSyncField = (INLINE_FIELDS_ALL as readonly string[]).includes(field);
  if (!isInternal && !isSyncField) {
    return { ok: false, message: `Champ ${field} non autorisé.` };
  }

  const db = getDb();
  const current = db.prepare('SELECT status FROM ecritures WHERE id = ?').get(id) as { status: string } | undefined;
  if (!current) return { ok: false, message: `Écriture ${id} introuvable.` };

  if (current.status === 'saisie_comptaweb' && !isInternal) {
    return { ok: false, message: 'Écriture synchronisée Comptaweb — champ non modifiable.' };
  }

  const now = currentTimestamp();
  const normalised = value === '' ? null : value;
  db.prepare(`UPDATE ecritures SET ${field} = ?, updated_at = ? WHERE id = ?`).run(normalised, now, id);

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  return { ok: true };
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

export interface BatchPatch {
  unite_id?: string | null;
  category_id?: string | null;
  activite_id?: string | null;
  mode_paiement_id?: string | null;
  carte_id?: string | null;
  justif_attendu?: 0 | 1;
  description_prefix?: string;
}

export interface BatchResult {
  updated: number;
  skipped: number;
}

// Mise à jour en masse : n'agit que sur les écritures modifiables (brouillon
// ou valide). Les écritures synchronisées Comptaweb sont ignorées pour éviter
// un décalage silencieux avec la prod.
export async function batchUpdateEcritures(ids: string[], patch: BatchPatch): Promise<BatchResult> {
  if (ids.length === 0) return { updated: 0, skipped: 0 };

  const db = getDb();
  const now = currentTimestamp();

  const setClauses: string[] = [];
  const setValues: unknown[] = [];
  if (patch.unite_id !== undefined) { setClauses.push('unite_id = ?'); setValues.push(patch.unite_id); }
  if (patch.category_id !== undefined) { setClauses.push('category_id = ?'); setValues.push(patch.category_id); }
  if (patch.activite_id !== undefined) { setClauses.push('activite_id = ?'); setValues.push(patch.activite_id); }
  if (patch.mode_paiement_id !== undefined) { setClauses.push('mode_paiement_id = ?'); setValues.push(patch.mode_paiement_id); }
  if (patch.carte_id !== undefined) { setClauses.push('carte_id = ?'); setValues.push(patch.carte_id); }
  if (patch.justif_attendu !== undefined) { setClauses.push('justif_attendu = ?'); setValues.push(patch.justif_attendu); }
  const prefix = patch.description_prefix?.trim();
  const hasChanges = setClauses.length > 0 || !!prefix;
  if (!hasChanges) return { updated: 0, skipped: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, status, description FROM ecritures WHERE id IN (${placeholders})`,
  ).all(...ids) as { id: string; status: string; description: string }[];

  const editable = rows.filter((r) => r.status !== 'saisie_comptaweb');
  const skipped = rows.length - editable.length;
  if (editable.length === 0) return { updated: 0, skipped };

  const updateCore = setClauses.length > 0
    ? db.prepare(`UPDATE ecritures SET ${setClauses.join(', ')}, updated_at = ? WHERE id = ?`)
    : null;
  const updateDesc = prefix
    ? db.prepare('UPDATE ecritures SET description = ?, updated_at = ? WHERE id = ?')
    : null;

  const tx = db.transaction(() => {
    for (const row of editable) {
      if (updateCore) updateCore.run(...setValues, now, row.id);
      if (updateDesc) {
        const sep = ' — ';
        const already = row.description.startsWith(prefix + sep);
        const next = already ? row.description : `${prefix}${sep}${row.description}`;
        updateDesc.run(next, now, row.id);
      }
    }
  });
  tx();

  revalidatePath('/ecritures');
  revalidatePath('/');
  for (const row of editable) revalidatePath(`/ecritures/${row.id}`);

  return { updated: editable.length, skipped };
}
