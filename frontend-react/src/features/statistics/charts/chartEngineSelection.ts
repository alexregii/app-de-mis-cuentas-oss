export type StatisticsChartEngine = "ag-charts" | "uplot";

export const chartEngineForLocation = (search: string, userAgent = ""): StatisticsChartEngine => {
  // AG Charts' OffscreenCanvas compositor throws in WebKit; use the existing UPlot/SVG fallback there.
  const isWebKit = /AppleWebKit/i.test(userAgent) && !/(Chrome|Chromium|Edg\/|OPR\/)/i.test(userAgent);
  return new URLSearchParams(search).get("statisticsChartEngine") === "ag-charts" && !isWebKit ? "ag-charts" : "uplot";
};

export const statisticsChartEngine = chartEngineForLocation(
  typeof window === "undefined" ? "" : window.location.search,
  typeof window === "undefined" ? "" : window.navigator.userAgent,
);
