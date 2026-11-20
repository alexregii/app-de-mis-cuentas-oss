import type {TransactionEditorErrors, TransactionEditorInput} from "../../ui/finance/TransactionEditor";
import {reviewFixtures, type ReviewFixture} from "./review";

/**
 * Correctivos propios de C3. La fixture R0 permanece congelada y este archivo
 * hace explícito el ajuste de consistencia que necesita el escenario actual.
 */
export const reviewC3Fixtures: ReviewFixture[] = reviewFixtures.map((item) => {
  if (item.id === "review-blocked") {
    return {
      ...item,
      transaction: {...item.transaction, date: "", tags: []},
      attentionIssues: [{code: "category-missing", message: "Falta categoría."}],
    };
  }
  if (item.id === "review-new-prepared") {
    return {...item, transaction: {...item.transaction, tags: ["casa", "anual"]}};
  }
  return item;
});

export function hasConsistentReviewFixture(item: ReviewFixture) {
  const hasDateMissing = [...item.attentionIssues, ...item.blockingIssues].some((issue) => issue.code === "date-missing");
  return Boolean(item.transaction.date) !== hasDateMissing;
}

/** El editor de Más detalles sólo valida los campos secundarios que muestra. */
export function validateReviewSecondaryInput(_input: TransactionEditorInput): TransactionEditorErrors {
  return {};
}
