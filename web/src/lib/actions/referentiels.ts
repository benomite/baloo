'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import { getCurrentContext } from '../context';
import { ensureComptawebEnv } from '../comptaweb/env-loader';
import {
  applyReferentielsSync,
  fetchReferentielsCreer,
  withAutoReLogin,
  ComptawebSessionExpiredError,
} from '../comptaweb';
import type { SyncReferentielsReport } from '../comptaweb';

ensureComptawebEnv();

export interface SyncActionResult {
  ok: boolean;
  report?: SyncReferentielsReport;
  erreur?: string;
}

export async function syncReferentielsFromComptaweb(): Promise<SyncActionResult> {
  try {
    const ctx = getCurrentContext();
    const refs = await withAutoReLogin((cfg) => fetchReferentielsCreer(cfg));
    const report = applyReferentielsSync(
      getDb(),
      ctx.groupId,
      {
        brancheprojet: refs.brancheprojet,
        nature: refs.nature,
        activite: refs.activite,
        modetransaction: refs.modetransaction,
      },
      currentTimestamp(),
    );
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
