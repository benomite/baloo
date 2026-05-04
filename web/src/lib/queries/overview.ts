import { getCurrentContext } from '../context';
import {
  getOverview as getOverviewService,
  type OverviewData,
  type OverviewFilters,
} from '../services/overview';

export type { OverviewData, OverviewFilters };

export async function getOverview(filters: OverviewFilters = {}): Promise<OverviewData> {
  const { groupId } = await getCurrentContext();
  return getOverviewService({ groupId }, filters);
}
