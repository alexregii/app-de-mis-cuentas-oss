import {Suspense} from "react";
import {CategoryChartEngine} from "./chartEngineRuntime";
import type {CategoryChartProps} from "./chartTypes";

export function CategoryDonut(props: CategoryChartProps) {
  return (
    <Suspense fallback={<div className="category-hero chart-engine-loading skeleton-panel" aria-hidden="true" />}>
      <CategoryChartEngine {...props} />
    </Suspense>
  );
}
