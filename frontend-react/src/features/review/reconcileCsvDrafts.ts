import type {ImportRowsPayload} from "../../shared/model/imports";
import {toPreparedCsvReview} from "./adapters/csvReviewAdapter";
import {reviewDraftEquals} from "./adapters/reviewDraft";
import type {ReviewDraft} from "./adapters/reviewAdapterTypes";

export function reconcileCsvDrafts(current: Record<number, ReviewDraft>, payload: ImportRowsPayload, previousRows: readonly ImportRowsPayload["results"][number][], previousBatch: ImportRowsPayload["batch"] | undefined, previousBaselines: Record<number, ReviewDraft>, resetIds: ReadonlySet<number>) {
  const next = {...current};
  payload.results.forEach((row) => {
    const prepared = toPreparedCsvReview(row, payload.batch, undefined, payload.categories);
    if (!prepared || row.status !== "pending" || resetIds.has(row.id)) {
      delete next[row.id];
      return;
    }
    const previousRow = previousRows.find((candidate) => candidate.id === row.id);
    const previousBaseline = previousRow && previousBatch
      ? toPreparedCsvReview(previousRow, previousBatch, undefined, payload.categories)?.draft
      : previousBaselines[row.id];
    const preserveDirtyDraft = Boolean(current[row.id] && previousBaseline && !reviewDraftEquals(current[row.id], previousBaseline));
    next[row.id] = preserveDirtyDraft ? current[row.id] : prepared.draft;
  });
  resetIds.forEach((id) => delete next[id]);
  return next;
}

export function getDirtyCsvDraftIdsForBatch(drafts: Record<number, ReviewDraft>, batchByRow: Record<number, number>, baselineByRow: Record<number, ReviewDraft>, batchId: number) {
  return Object.entries(drafts)
    .filter(([id, draft]) => {
      const rowId = Number(id);
      const baseline = baselineByRow[rowId];
      return batchByRow[rowId] === batchId && Boolean(baseline) && !reviewDraftEquals(draft, baseline);
    })
    .map(([id]) => Number(id));
}
