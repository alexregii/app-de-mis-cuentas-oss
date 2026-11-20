// @vitest-environment node
import {describe, expect, it} from "vitest";
import {chartEngineForLocation} from "../features/statistics/charts/chartEngineSelection";
import {chartAxisDateValue, chartTimestamp} from "../features/statistics/charts/engines/uplot/chartTimestamp";
import {splitPartialSeries} from "../features/statistics/charts/engines/uplot/partialSeries";

describe("statistics chart engine selection", () => {
  it("uses lightweight UPlot by default and loads AG Charts only by explicit selection", () => {
    expect(chartEngineForLocation("")).toBe("uplot");
    expect(chartEngineForLocation("?statisticsChartEngine=ag-charts")).toBe("ag-charts");
    expect(chartEngineForLocation("?statisticsChartEngine=ag-charts", "Mozilla/5.0 AppleWebKit/605.1.15 Version/26.5 Safari/605.1.15")).toBe("uplot");
  });

  it("uses the existing UPlot fallback on WebKit browsers", () => {
    expect(chartEngineForLocation("?statisticsChartEngine=ag-charts", "Mozilla/5.0 AppleWebKit/605.1.15 Version/26.5 Safari/605.1.15")).toBe("uplot");
    expect(chartEngineForLocation("?statisticsChartEngine=ag-charts", "Mozilla/5.0 AppleWebKit/537.36 Chrome/149.0.7827.55 Safari/537.36")).toBe("ag-charts");
  });

  it("keeps UPlot month and day labels on their UTC calendar date", () => {
    expect(new Date(chartTimestamp("2025-12") * 1000).toISOString().slice(0, 7)).toBe("2025-12");
    expect(new Date(chartTimestamp("2026-01-05") * 1000).toISOString().slice(0, 10)).toBe("2026-01-05");
    const pointDates = ["2025-12-01", "2026-01-01"];
    expect(chartAxisDateValue(Date.UTC(2025, 10, 30, 23) / 1000, pointDates)).toBe("2025-12-01");
    expect(chartAxisDateValue(Date.UTC(2025, 10, 1) / 1000, pointDates)).toBe("2025-12-01");
  });

  it("keeps partial period endpoints distinct in UPlot line and marker data", () => {
    expect(splitPartialSeries([10, 20, 30], [true, false, false])).toEqual({
      complete: [null, 20, 30],
      dashed: [10, 20, null],
      partialPoints: [10, null, null],
    });
    expect(splitPartialSeries([10, 20], [true, true])).toEqual({
      complete: [null, null],
      dashed: [10, 20],
      partialPoints: [10, 20],
    });
  });
});
