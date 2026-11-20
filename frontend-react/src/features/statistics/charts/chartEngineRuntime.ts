import {lazy} from "react";
import {statisticsChartEngine} from "./chartEngineSelection";

export const FinanceChartEngine = lazy(() => statisticsChartEngine === "ag-charts"
  ? import("./engines/ag/AgFinanceLineChart").then((module) => ({default: module.AgFinanceLineChart}))
  : import("./engines/uplot/UPlotFinanceChart").then((module) => ({default: module.UPlotFinanceChart}))
);

export const CategoryChartEngine = lazy(() => statisticsChartEngine === "ag-charts"
  ? import("./engines/ag/AgCategoryDonut").then((module) => ({default: module.AgCategoryDonut}))
  : import("./engines/svg/SvgCategoryDonut").then((module) => ({default: module.SvgCategoryDonut}))
);
