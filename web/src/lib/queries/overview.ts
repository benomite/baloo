import { getCurrentContext } from '../context';
import { getOverview as getOverviewService, type OverviewData } from '../services/overview';

export type { OverviewData };

export async function getOverview(): Promise<OverviewData> {
  const { groupId } = await getCurrentContext();
  return getOverviewService({ groupId });
}
