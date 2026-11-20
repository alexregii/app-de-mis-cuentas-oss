import type {StatisticsActivityStatus, StatisticsCategoryFamily} from "../types";
import type {StatisticsCategoryColorMap} from "../statisticsFormatting";

export interface FinanceChartPoint {
  date: string;
  income: number | null;
  netExpense: number | null;
  netResult?: number | null;
  activityStatus?: StatisticsActivityStatus;
  isPartial?: boolean;
}

export interface FinanceChartProps {
  points: FinanceChartPoint[];
  title: string;
  height?: number;
  granularity?: "month" | "day";
  selectedDate?: string;
  onSelectPoint?: (date: string) => void;
  theme?: string;
}

export interface CategoryChartProps {
  items: StatisticsCategoryFamily[];
  label: string;
  detail: string;
  categoryColors: StatisticsCategoryColorMap;
}
