import { getCurrentContext } from '../context';
import {
  getOverview as getOverviewService,
  getUniteOverview as getUniteOverviewService,
  type OverviewData,
  type OverviewFilters,
  type UniteOverviewData,
} from '../services/overview';

export type { OverviewData, OverviewFilters, UniteOverviewData };

export async function getOverview(filters: OverviewFilters = {}): Promise<OverviewData> {
  const { groupId } = await getCurrentContext();
  return getOverviewService({ groupId }, filters);
}

export async function getUniteOverview(
  uniteId: string,
  filters: OverviewFilters = {},
): Promise<UniteOverviewData | null> {
  const { groupId } = await getCurrentContext();
  return getUniteOverviewService({ groupId }, { uniteId }, filters);
}
