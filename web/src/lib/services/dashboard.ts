// Couche données du dashboard trésorier (Phase 4 pivot miroir).
// Réutilise getOverview (trésorerie, rembs en attente, alertes justif/sync)
// + getSyncStatus + 3 compteurs dédiés. Lecture seule, une passe parallèle.
import { getDb } from '../db';
import { logError } from '../log';
import { getOverview } from './overview';
import { getSyncStatus } from './sync-cycle';
import { ensureDepotsSchema } from './depots';
import {
  countDepotsATraiter,
  countAbandonsATraiter,
  countDraftsBancaires,
} from './dashboard-counts';

export interface DashboardData {
  aTraiter: {
    rembs: { count: number; totalCents: number };
    depotsARapprocher: number;
    depensesSansJustif: number;
    abandonsATraiter: number;
    draftsBancaires: number;
  };
  sante: {
    soldeCents: number;
    engagementRembsCents: number;
    nonSyncComptaweb: number;
    parUnite: Awaited<ReturnType<typeof getOverview>>['parUnite'];
    sync: { stale: boolean; isRunning: boolean; lastRunAt: string | null };
  };
}

export function isAllClear(aTraiter: DashboardData['aTraiter']): boolean {
  return (
    aTraiter.rembs.count === 0 &&
    aTraiter.depotsARapprocher === 0 &&
    aTraiter.depensesSansJustif === 0 &&
    aTraiter.abandonsATraiter === 0 &&
    aTraiter.draftsBancaires === 0
  );
}

export async function getDashboardData(ctx: { groupId: string }): Promise<DashboardData> {
  const db = getDb();
  await ensureDepotsSchema(); // table lazy-init — cf. web/AGENTS.md

  // getOverview est le cœur trésorerie/budgets : s'il échoue, la page
  // peut légitimement tomber sur l'error boundary. Les agrégats secondaires
  // sont rendus résilients : repli sur valeur neutre + log.
  const [overview, sync, depots, abandons, drafts] = await Promise.all([
    getOverview({ groupId: ctx.groupId }),
    getSyncStatus(db, ctx.groupId).catch((err) => {
      logError('dashboard', 'getSyncStatus échoué', err);
      return { stale: true, is_running: false, last_run: null };
    }),
    countDepotsATraiter(db, ctx.groupId).catch((err) => {
      logError('dashboard', 'countDepotsATraiter échoué', err);
      return 0;
    }),
    countAbandonsATraiter(db, ctx.groupId).catch((err) => {
      logError('dashboard', 'countAbandonsATraiter échoué', err);
      return 0;
    }),
    countDraftsBancaires(db, ctx.groupId).catch((err) => {
      logError('dashboard', 'countDraftsBancaires échoué', err);
      return 0;
    }),
  ]);

  return {
    aTraiter: {
      rembs: {
        count: overview.remboursementsEnAttente.count,
        totalCents: overview.remboursementsEnAttente.total,
      },
      depotsARapprocher: depots,
      depensesSansJustif: overview.alertes.depensesSansJustificatif,
      abandonsATraiter: abandons,
      draftsBancaires: drafts,
    },
    sante: {
      soldeCents: overview.solde,
      engagementRembsCents: overview.remboursementsEnAttente.total,
      nonSyncComptaweb: overview.alertes.nonSyncComptaweb,
      parUnite: overview.parUnite,
      sync: {
        stale: sync.stale,
        isRunning: sync.is_running,
        lastRunAt: sync.last_run?.started_at ?? null,
      },
    },
  };
}
