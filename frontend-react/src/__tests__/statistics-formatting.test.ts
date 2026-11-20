// @vitest-environment node
import {afterEach, describe, expect, it, vi} from "vitest";
import {
  categoryChartColors,
  categoryChartColorMap,
  chartTickValue,
  dateInputValue,
  defaultStatisticsRange,
  formatPercentagePoints,
  formatPercent,
  isIsoDate,
  shortDayLabel,
  shortMonthLabel,
  signedCompactEuro,
  validateStatisticsRange,
} from "../features/statistics/statisticsFormatting";
import type {StatisticsCategoryFamily} from "../features/statistics/types";

describe("statistics formatting", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps local date ranges and compact labels deterministic", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 13, 12));
    expect(dateInputValue(new Date(2026, 0, 2, 12))).toBe("2026-01-02");
    expect(defaultStatisticsRange()).toEqual({from: "2026-05-01", to: "2026-07-13"});
    expect(shortMonthLabel("2026-07")).toContain("26");
    expect(shortDayLabel("2026-07-13")).toContain("13");
    expect(shortMonthLabel("")).toBe("");
    expect(formatPercent(12.34)).toBe("12,3 %");
    expect(formatPercent(null)).toBe("No disponible");
    expect(formatPercentagePoints(null)).toBe("Sin base comparable");
    expect(formatPercentagePoints(1.2)).toBe("+1,2 pp");
    expect(signedCompactEuro(250)).toMatch(/^\+/);
  });

  it("keeps category colors stable across views and compact axis labels", () => {
    const categories = [
      {family_id: 3, family_name: "Ocio", color: "#123456"},
      {family_id: 8, family_name: "Hogar", color: "#123456"},
      {family_id: 11, family_name: "Salud", color: "#123456"},
    ] as StatisticsCategoryFamily[];
    const palette = categoryChartColorMap(categories);
    const colors = categoryChartColors(categories, palette);
    expect(new Set(colors).size).toBe(categories.length);
    expect(categoryChartColors(categories, palette)).toEqual(colors);
    expect(categoryChartColors([categories[1]], palette)[0]).toBe(colors[1]);
    expect(chartTickValue(1_250)).not.toContain("€");
  });

  it("validates complete custom ranges, today and the 120-month ceiling", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(validateStatisticsRange({from: "", to: "2026-01-01"}, "2026-07-13")).toContain("Completa");
    expect(validateStatisticsRange({from: "2026-02-01", to: "2026-01-01"}, "2026-07-13")).toContain("inicio");
    expect(validateStatisticsRange({from: "2026-01-01", to: "2026-07-14"}, "2026-07-13")).toContain("futuro");
    expect(validateStatisticsRange({from: "2016-01-01", to: "2026-01-01"}, "2026-07-13")).toContain("120 meses");
    expect(validateStatisticsRange({from: "2016-01-31", to: "2026-01-01"}, "2026-07-13")).toContain("120 meses");
    expect(validateStatisticsRange({from: "2016-01-31", to: "2025-12-31"}, "2026-07-13")).toBe("");
    expect(validateStatisticsRange({from: "2026-01-01", to: "2026-07-13"}, "2026-07-13")).toBe("");
  });
});
