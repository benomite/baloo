'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  scanDraftsFromComptaweb as scanDraftsService,
  syncDraftToComptaweb as syncDraftService,
  type ScanDraftsResult,
  type SyncDraftResult,
} from '../services/drafts';

export async function scanDraftsFromComptaweb(): Promise<ScanDraftsResult> {
  const result = await scanDraftsService({ groupId: (await getCurrentContext()).groupId });
  revalidatePath('/ecritures');
  return result;
}

export async function syncDraftToComptaweb(
  ecritureId: string,
  opts: { dryRun?: boolean } = {},
): Promise<SyncDraftResult> {
  const result = await syncDraftService(
    { groupId: (await getCurrentContext()).groupId },
    ecritureId,
    opts,
  );
  if (result.ok && !result.dryRun) {
    revalidatePath('/ecritures');
    revalidatePath(`/ecritures/${ecritureId}`);
  }
  return result;
}

export interface BatchSyncResult {
  succeeded: number;
  incomplete: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
  sessionExpired: boolean;
}

// Sync séquentielle : Comptaweb est lent et fragile côté session/CSRF, on
// évite la parallélisation. On s'arrête dès qu'on détecte une session expirée
// pour ne pas spammer le login.
export async function batchSyncDraftsToComptaweb(ids: string[]): Promise<BatchSyncResult> {
  const { groupId } = await getCurrentContext();
  const out: BatchSyncResult = { succeeded: 0, incomplete: 0, failed: 0, errors: [], sessionExpired: false };
  for (const id of ids) {
    const r = await syncDraftService({ groupId }, id, { dryRun: false });
    if (r.ok) {
      out.succeeded++;
    } else if (r.missingFields && r.missingFields.length > 0) {
      out.incomplete++;
      out.errors.push({ id, message: r.message });
    } else if (r.message === 'Session Comptaweb expirée.') {
      out.sessionExpired = true;
      out.errors.push({ id, message: r.message });
      break;
    } else {
      out.failed++;
      out.errors.push({ id, message: r.message });
    }
  }
  if (out.succeeded > 0) {
    revalidatePath('/ecritures');
  }
  return out;
}
