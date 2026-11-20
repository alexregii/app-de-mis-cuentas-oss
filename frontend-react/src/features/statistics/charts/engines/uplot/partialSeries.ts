export type ChartValue = number | null;

export function splitPartialSeries(values: readonly ChartValue[], partialFlags: readonly boolean[]) {
  const last = values.length - 1;
  const partialPoints = new Set<number>();
  const partialSegments = new Set<number>();
  if (last >= 0 && partialFlags[0]) partialPoints.add(0);
  if (last > 0 && partialFlags[0]) { partialSegments.add(0); partialSegments.add(1); }
  if (last >= 0 && partialFlags[last]) partialPoints.add(last);
  if (last > 0 && partialFlags[last]) { partialSegments.add(last - 1); partialSegments.add(last); }
  return {
    complete: values.map((value, index) => partialPoints.has(index) ? null : value),
    dashed: values.map((value, index) => partialSegments.has(index) ? value : null),
    partialPoints: values.map((value, index) => partialPoints.has(index) ? value : null),
  };
}
