import {ReviewRuleGroups} from "./ReviewRuleGroups";
import type {PreparedReview} from "./adapters/reviewAdapterTypes";
import type {CsvReviewMutationResult, ReviewData} from "./useReviewData";
import {reviewMatchesFilter, type ReviewQueueFilter} from "./reviewQueueFilter";
import {buildReviewRuleGroups} from "./reviewRuleModel";

export function CsvReviewRuleGroups({rows, filter, isExiting, privateAmounts, selectionMode, selectedBatchId, runBulkAction, onResult}: {
  rows: readonly PreparedReview[];
  filter: ReviewQueueFilter;
  isExiting: (id: number) => boolean;
  privateAmounts: boolean;
  selectionMode: boolean;
  selectedBatchId: number | null;
  runBulkAction: ReviewData["runCsvBulkAction"];
  onResult: (candidateIds: readonly number[], result: CsvReviewMutationResult) => void;
}) {
  if (selectionMode) return null;
  const model = buildReviewRuleGroups(rows.filter((row) => !isExiting(row.sourceId) && reviewMatchesFilter(row, filter)));
  return <ReviewRuleGroups
    groups={filter === "attention" ? [] : model.groups}
    conflicts={model.conflicts.filter(({prepared}) => reviewMatchesFilter(prepared, filter))}
    privateAmounts={privateAmounts}
    focusTargetId="review-csv-workspace"
    onApply={async (group, preparedRows) => {
      const batchId = group.batchId;
      if (group.source !== "csv" || batchId === null || batchId !== selectedBatchId) return false;
      const ids = preparedRows.map((prepared) => prepared.sourceId);
      return runBulkAction(batchId, {
        action: "confirm",
        rows: ids,
        categories: Object.fromEntries(ids.map((id) => [id, String(group.rule.category.id)])),
      }, (result) => onResult(ids, result));
    }}
  />;
}
