import {useEffect, type Dispatch, type SetStateAction} from "react";
import type {PreparedReview} from "./adapters/reviewAdapterTypes";

export type ReviewQueueFilter = "all" | "attention" | "prepared";

export function reviewMatchesFilter(prepared: PreparedReview, filter: ReviewQueueFilter) {
  if (filter === "all") return true;
  if (filter === "prepared") return prepared.preparation === "prepared";
  return prepared.preparation === "needs_attention" || prepared.preparation === "blocked";
}

export function reviewBatchSelectable(prepared: PreparedReview) {
  return prepared.capabilities.select && prepared.decision === "pending" && prepared.preparation === "prepared";
}

export function usePruneReviewSelection(selectableIds: readonly number[], setSelected: Dispatch<SetStateAction<number[]>>) {
  const selectableKey = selectableIds.join(",");
  useEffect(() => {
    const allowed = new Set(selectableIds);
    setSelected((current) => {
      const next = current.filter((id) => allowed.has(id));
      return next.length === current.length ? current : next;
    });
  }, [selectableKey, setSelected]);
}
