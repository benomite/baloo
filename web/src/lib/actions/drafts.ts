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
  const result = await scanDraftsService({ groupId: getCurrentContext().groupId });
  revalidatePath('/ecritures');
  return result;
}

export async function syncDraftToComptaweb(
  ecritureId: string,
  opts: { dryRun?: boolean } = {},
): Promise<SyncDraftResult> {
  const result = await syncDraftService(
    { groupId: getCurrentContext().groupId },
    ecritureId,
    opts,
  );
  if (result.ok && !result.dryRun) {
    revalidatePath('/ecritures');
    revalidatePath(`/ecritures/${ecritureId}`);
  }
  return result;
}
