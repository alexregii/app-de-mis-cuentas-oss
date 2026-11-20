import {useEffect, useState} from "react";
import {
  CartesianChartModule,
  CategoryAxisModule,
  DonutSeriesModule,
  LineSeriesModule,
  LocaleModule,
  ModuleRegistry,
  NumberAxisModule,
  PolarChartModule,
} from "ag-charts-community";

ModuleRegistry.registerModules([
  CartesianChartModule,
  CategoryAxisModule,
  LineSeriesModule,
  LocaleModule,
  NumberAxisModule,
  PolarChartModule,
  DonutSeriesModule,
]);

const cssColor = (styles: CSSStyleDeclaration, name: string, fallback: string) =>
  styles.getPropertyValue(name).trim() || fallback;

const DEFAULT_AG_CHART_PALETTE = {
  expense: "var(--stats-series-expense)",
  income: "var(--stats-series-income)",
  accent: "var(--stats-series-result)",
  muted: "var(--ink-2)",
  rule: "var(--rule)",
  surface: "var(--surface-soft)",
};

export const useAgChartPalette = () => {
  const [palette, setPalette] = useState(DEFAULT_AG_CHART_PALETTE);
  useEffect(() => {
    const styles = getComputedStyle(document.querySelector(".stats-view") || document.documentElement);
    setPalette({
      expense: cssColor(styles, "--stats-series-expense", DEFAULT_AG_CHART_PALETTE.expense),
      income: cssColor(styles, "--stats-series-income", DEFAULT_AG_CHART_PALETTE.income),
      accent: cssColor(styles, "--stats-series-result", DEFAULT_AG_CHART_PALETTE.accent),
      muted: cssColor(
        styles,
        "--ink-2",
        cssColor(styles, "--color-muted", DEFAULT_AG_CHART_PALETTE.muted),
      ),
      rule: cssColor(
        styles,
        "--color-rule",
        cssColor(styles, "--rule", DEFAULT_AG_CHART_PALETTE.rule),
      ),
      surface: cssColor(styles, "--surface-soft", DEFAULT_AG_CHART_PALETTE.surface),
    });
  }, []);
  return palette;
};
