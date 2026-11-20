import {describe, expect, it} from "vitest";
import {
  INITIAL_JS_GZIP_LIMIT,
  STATISTICS_JS_GZIP_LIMIT,
  UPLOT_ENGINE_JS_GZIP_LIMIT,
  AG_CHARTS_ENGINE_JS_GZIP_LIMIT,
  assertBuildReport,
  extractInitialJavaScript,
} from "./check-build.mjs";

const validReport = () => ({
  initial: [
    {asset: "assets/index.js", bytes: 300_000, gzipBytes: 120_000, forbiddenSignatures: []},
    {asset: "assets/ui-icons.js", bytes: 20_000, gzipBytes: 7_000, forbiddenSignatures: []},
  ],
  initialGzipBytes: 127_000,
  dynamic: [
    {asset: "assets/StatisticsView-example.js", bytes: 180_000, gzipBytes: 55_000, forbiddenSignatures: []},
    {asset: "assets/statistics-uplot-example.js", bytes: 45_000, gzipBytes: 15_000, forbiddenSignatures: []},
    {asset: "assets/statistics-ag-charts-example.js", bytes: 900_000, gzipBytes: 280_000, forbiddenSignatures: []},
  ],
});

describe("production build assertions", () => {
  it("reads module scripts and modulepreloads without counting CSS", () => {
    expect(extractInitialJavaScript(`
      <link rel="modulepreload" href="/assets/ui-icons.js">
      <link rel="stylesheet" href="/assets/index.css">
      <script type="module" src="/assets/index.js"></script>
    `)).toEqual(["assets/index.js", "assets/ui-icons.js"]);
  });

  it("accepts a small entry and a deferred statistics chunk without MUI or Emotion styling", () => {
    expect(assertBuildReport(validReport())).toEqual(validReport());
  });

  it("rejects entry, statistics-budget and forbidden-runtime regressions", () => {
    const tooLarge = validReport();
    tooLarge.initialGzipBytes = INITIAL_JS_GZIP_LIMIT + 1;
    expect(() => assertBuildReport(tooLarge)).toThrow("el máximo");

    const statisticsTooLarge = validReport();
    statisticsTooLarge.dynamic[0].gzipBytes = STATISTICS_JS_GZIP_LIMIT + 1;
    expect(() => assertBuildReport(statisticsTooLarge)).toThrow("chunk de Estadísticas");

    const forbiddenRuntime = validReport();
    forbiddenRuntime.dynamic[0].forbiddenSignatures = ["MuiCharts"];
    expect(() => assertBuildReport(forbiddenRuntime)).toThrow("MUI/Emotion");

    const missingStatistics = validReport();
    missingStatistics.dynamic = [];
    expect(() => assertBuildReport(missingStatistics)).toThrow("chunk diferido");

    const uplotTooLarge = validReport();
    uplotTooLarge.dynamic[1].gzipBytes = UPLOT_ENGINE_JS_GZIP_LIMIT + 1;
    expect(() => assertBuildReport(uplotTooLarge)).toThrow("chunk de uPlot");

    const agChartsTooLarge = validReport();
    agChartsTooLarge.dynamic[2].gzipBytes = AG_CHARTS_ENGINE_JS_GZIP_LIMIT + 1;
    expect(() => assertBuildReport(agChartsTooLarge)).toThrow("chunk de AG Charts");

    const missingAgCharts = validReport();
    missingAgCharts.dynamic.splice(2, 1);
    expect(() => assertBuildReport(missingAgCharts)).toThrow("único chunk diferido de AG Charts");
  });
});
