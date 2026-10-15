'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { ensureComptawebEnv } from '../comptaweb/env-loader';
import { ComptawebSessionExpiredError } from '../comptaweb';
import {
  syncReferentielsTousExercices,
  type SyncReferentielsTousExercicesReport,
} from '../services/referentiels-sync';

ensureComptawebEnv();

export interface SyncActionResult {
  ok: boolean;
  report?: SyncReferentielsTousExercicesReport;
  erreur?: string;
}

export async function syncReferentielsFromComptaweb(): Promise<SyncActionResult> {
  try {
    const ctx = await getCurrentContext();
    const report = await syncReferentielsTousExercices(ctx.groupId);
    revalidatePath('/ecritures');
    revalidatePath('/ecritures/[id]', 'page');
    revalidatePath('/ecritures/nouveau');
    revalidatePath('/import');
    return { ok: true, report };
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) {
      return { ok: false, erreur: 'Session Comptaweb expirée.' };
    }
    return { ok: false, erreur: err instanceof Error ? err.message : String(err) };
  }
}
