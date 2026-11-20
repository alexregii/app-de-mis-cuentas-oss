import {compactEuro, compactEuroNumber, todayInputValue} from "../../format";
import type {StatisticsCategoryFamily, StatisticsDateRange} from "./types";

const shortMonthFormatter = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
});

const percentFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 1,
});

const categoryChartTokens = Array.from({length: 16}, (_, index) => `--stats-category-${String(index + 1).padStart(2, "0")}`);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export const dateInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const defaultStatisticsRange = (): StatisticsDateRange => {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  return {from: dateInputValue(start), to: todayInputValue()};
};

export const shortMonthLabel = (value: string) => {
  if (!value) return "";
  return shortMonthFormatter.format(new Date(`${value.slice(0, 7)}-01T00:00:00`)).replace(".", "");
};

export const shortDayLabel = (value: string) => {
  if (!value) return "";
  return dayFormatter.format(new Date(`${value}T00:00:00`)).replace(".", "");
};

export const formatPercent = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "No disponible";
  return `${percentFormatter.format(value)} %`;
};

export const formatPercentagePoints = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Sin base comparable";
  const sign = value > 0 ? "+" : "";
  return `${sign}${percentFormatter.format(value)} pp`;
};

type CategoryColorItem = Pick<StatisticsCategoryFamily, "family_id" | "family_name">;
export type StatisticsCategoryColorMap = ReadonlyMap<string, string>;

export const categoryColorKey = (item: CategoryColorItem) => item.family_id === null
  ? `name:${item.family_name}`
  : `id:${item.family_id}`;

const stableHash = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

const chartColor = (token: string) => {
  if (typeof document === "undefined") return `var(${token})`;
  const owner = document.querySelector(".app-frame") || document.documentElement;
  return getComputedStyle(owner).getPropertyValue(token).trim() || `var(${token})`;
};

export const categoryChartColorMap = (items: CategoryColorItem[]): StatisticsCategoryColorMap => {
  const keys = [...new Set(items.map(categoryColorKey))].sort((left, right) => left.localeCompare(right));
  const colors = new Map<string, string>();
  const used = new Set<string>();
  keys.forEach((key, index) => {
    const start = stableHash(key) % categoryChartTokens.length;
    let color = "";
    for (let offset = 0; offset < categoryChartTokens.length; offset += 1) {
      const candidate = chartColor(categoryChartTokens[(start + offset) % categoryChartTokens.length]);
      if (!used.has(candidate)) {
        color = candidate;
        break;
      }
    }
    if (!color) color = chartColor(categoryChartTokens[index % categoryChartTokens.length]);
    used.add(color);
    colors.set(key, color);
  });
  return colors;
};

export const categoryChartColor = (item: CategoryColorItem, colors?: StatisticsCategoryColorMap) => {
  const key = categoryColorKey(item);
  if (colors?.has(key)) return colors.get(key)!;
  const token = categoryChartTokens[stableHash(key) % categoryChartTokens.length];
  return chartColor(token);
};

export const categoryChartColors = (items: CategoryColorItem[], colors?: StatisticsCategoryColorMap) =>
  items.map((item) => categoryChartColor(item, colors));

export const chartTickValue = (value: number) => compactEuroNumber(value);

export const isIsoDate = (value: string) => {
  if (!isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) && dateInputValue(parsed) === value;
};

export const validateStatisticsRange = (range: StatisticsDateRange, today = todayInputValue()): string => {
  if (!range.from || !range.to) return "Completa las fechas de inicio y fin.";
  if (!isIsoDate(range.from) || !isIsoDate(range.to)) return "Introduce fechas completas y válidas.";
  if (range.from > range.to) return "La fecha de inicio no puede ser posterior a la fecha de fin.";
  if (range.to > today) return "La fecha de fin no puede estar en el futuro.";

  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  const firstInvalidDay = new Date(start.getFullYear(), start.getMonth() + 120, 1);
  if (end >= firstInvalidDay) return "El rango no puede superar 120 meses.";
  return "";
};

export const signedCompactEuro = (value: number) => `${value > 0 ? "+" : ""}${compactEuro(value)}`;
