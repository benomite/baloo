'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../context';
import { importComptawebCsv } from '../services/comptaweb-import';
import {
  findCsvDuplicates as findCsvDuplicatesService,
  deleteCsvDuplicates as deleteCsvDuplicatesService,
  findOrphansWithoutCategory as findOrphansService,
  deleteOrphansWithoutCategory as deleteOrphansService,
  type DedupReport,
  type OrphanReport,
} from '../services/dedup-ecritures';
import {
  findInternalTransfers as findTransfertsService,
  deleteInternalTransfers as deleteTransfertsService,
  type CleanupReport,
} from '../services/cleanup-transferts';
import { logError } from '../log';

const ADMIN_ROLES = ['tresorier', 'RG'];

// Limite raisonnable pour un export Comptaweb : ~1 an de écritures.
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function uploadComptawebCsv(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect('/import?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }

  const file = formData.get('csv');
  if (!(file instanceof File) || file.size === 0) {
    redirect('/import?error=' + encodeURIComponent('Sélectionne un fichier CSV.'));
  }
  if (file.size > MAX_FILE_SIZE) {
    redirect(
      '/import?error=' +
        encodeURIComponent(
          `Fichier trop volumineux (${Math.round(file.size / 1024 / 1024)} MB > 5 MB). Filtre la période côté Comptaweb avant export.`,
        ),
    );
  }

  const filename = file.name || 'export.csv';
  if (!/\.csv$/i.test(filename)) {
    redirect('/import?error=' + encodeURIComponent('Le fichier doit être un .csv.'));
  }

  // Comptaweb exporte le CSV en Windows-1252 (encodage Excel français).
  // file.text() le décode en UTF-8 par défaut → les caractères accentués
  // se cassent ("D�pense" au lieu de "Dépense"), et les colonnes avec
  // accent (Dépense, Catégorie, Activité, Branche/Pôle) ne matchent
  // plus → données importées partielles. On force Windows-1252.
  // Fallback UTF-8 si jamais l'export devient UTF-8 plus tard.
  const buffer = await file.arrayBuffer();
  const utf8Try = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const content = utf8Try.includes('Dépense') || utf8Try.includes('Catégorie')
    ? utf8Try
    : new TextDecoder('windows-1252').decode(buffer);

  let result;
  try {
    result = await importComptawebCsv({ groupId: ctx.groupId }, { filename, content });
  } catch (err) {
    logError('comptaweb-import', 'Import CSV échoué', err, { filename });
    const message = err instanceof Error ? err.message : String(err);
    redirect('/import?error=' + encodeURIComponent(message));
  }

  if (!result.ok) {
    redirect(
      '/import?error=' +
        encodeURIComponent(result.message ?? 'Import échoué (raison inconnue).'),
    );
  }

  revalidatePath('/import');
  revalidatePath('/ecritures');
  redirect(
    '/import?imported=' +
      encodeURIComponent(`${result.ecritures_creees ?? 0}|${result.fichier ?? filename}`),
  );
}

// Détecte les doublons d'écritures saisie_comptaweb dans le groupe
// (générés par d'anciens imports CSV qui ne matchaient pas correctement
// les enregistrements existants). Dry-run par défaut : ne supprime rien,
// retourne juste le rapport.
export async function detectEcritureDuplicates(): Promise<DedupReport & { ok: boolean; error?: string }> {
  try {
    const ctx = await getCurrentContext();
    if (!ADMIN_ROLES.includes(ctx.role)) {
      return { ok: false, error: 'Action réservée aux trésoriers / RG.', groups: [], totalDuplicates: 0, totalDeletable: 0, totalKeptDespite: 0 };
    }
    const report = await findCsvDuplicatesService({ groupId: ctx.groupId });
    return { ok: true, ...report };
  } catch (err) {
    logError('dedup-ecritures', 'Détection doublons échouée', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      groups: [], totalDuplicates: 0, totalDeletable: 0, totalKeptDespite: 0,
    };
  }
}

// Supprime les doublons identifiés. Re-vérifie l'absence de liens
// externes au moment du DELETE (race condition). Le user a explicitement
// validé cette opération qui est une exception ciblée à la règle
// "JAMAIS de DELETE" (cf. CLAUDE.md) : on ne supprime QUE des écritures
// générées automatiquement par un import et qui n'ont reçu aucune
// donnée enrichie de l'utilisateur.
export async function deleteEcritureDuplicates(
  ids: string[],
): Promise<{ ok: boolean; deleted?: number; skipped?: number; error?: string }> {
  try {
    const ctx = await getCurrentContext();
    if (!ADMIN_ROLES.includes(ctx.role)) {
      return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
    }
    const result = await deleteCsvDuplicatesService({ groupId: ctx.groupId }, ids);
    revalidatePath('/import');
    revalidatePath('/ecritures');
    revalidatePath('/synthese');
    return { ok: true, ...result };
  } catch (err) {
    logError('dedup-ecritures', 'Suppression doublons échouée', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Détecte les écritures saisie_comptaweb sans catégorie qui ont une
// "twin" (mêmes date, amount, type, piece, description) avec catégorie
// définie. Ces orphelins sont des doublons générés par d'anciens imports
// avant le fix mapping comptaweb_nature. Dry-run.
export async function detectOrphansWithoutCategory(): Promise<OrphanReport & { ok: boolean; error?: string }> {
  try {
    const ctx = await getCurrentContext();
    if (!ADMIN_ROLES.includes(ctx.role)) {
      return { ok: false, error: 'Action réservée aux trésoriers / RG.', withTwin: [], withoutTwin: [], totalDeletable: 0, totalNeedsCompletion: 0 };
    }
    const report = await findOrphansService({ groupId: ctx.groupId });
    return { ok: true, ...report };
  } catch (err) {
    logError('orphans-no-category', 'Détection orphelins échouée', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      withTwin: [], withoutTwin: [], totalDeletable: 0, totalNeedsCompletion: 0,
    };
  }
}

export async function deleteOrphansWithoutCategory(
  ids: string[],
): Promise<{ ok: boolean; deleted?: number; skipped?: number; error?: string }> {
  try {
    const ctx = await getCurrentContext();
    if (!ADMIN_ROLES.includes(ctx.role)) {
      return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
    }
    const result = await deleteOrphansService({ groupId: ctx.groupId }, ids);
    revalidatePath('/import');
    revalidatePath('/ecritures');
    revalidatePath('/synthese');
    return { ok: true, ...result };
  } catch (err) {
    logError('orphans-no-category', 'Suppression orphelins échouée', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Détecte les transferts internes faussement importés en recettes/dépenses
// (cf. doc cleanup-transferts.ts). Dry-run par défaut.
export async function detectInternalTransfers(): Promise<CleanupReport & { ok: boolean; error?: string }> {
  try {
    const ctx = await getCurrentContext();
    if (!ADMIN_ROLES.includes(ctx.role)) {
      return { ok: false, error: 'Action réservée aux trésoriers / RG.', candidates: [], totalDeletable: 0, totalKeptDespite: 0, totalAmount: 0 };
    }
    const report = await findTransfertsService({ groupId: ctx.groupId });
    return { ok: true, ...report };
  } catch (err) {
    logError('cleanup-transferts', 'Détection transferts échouée', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      candidates: [], totalDeletable: 0, totalKeptDespite: 0, totalAmount: 0,
    };
  }
}

export async function deleteInternalTransfers(
  ids: string[],
): Promise<{ ok: boolean; deleted?: number; skipped?: number; error?: string }> {
  try {
    const ctx = await getCurrentContext();
    if (!ADMIN_ROLES.includes(ctx.role)) {
      return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
    }
    const result = await deleteTransfertsService({ groupId: ctx.groupId }, ids);
    revalidatePath('/import');
    revalidatePath('/ecritures');
    revalidatePath('/synthese');
    return { ok: true, ...result };
  } catch (err) {
    logError('cleanup-transferts', 'Suppression transferts échouée', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
