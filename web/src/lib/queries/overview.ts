import { getCurrentContext } from '../context';
import { getOverview as getOverviewService, type OverviewData } from '../services/overview';

export type { OverviewData };

export function getOverview(): OverviewData {
  const { groupId } = getCurrentContext();
  return getOverviewService({ groupId });
}
