import type {Account} from "../../../shared/model/accounts";
import type {Category} from "../../../shared/model/categories";
import type {BasicKind} from "../../../shared/model/common";
import type {LedgerEntity} from "../../../ui/finance/LedgerItem";
import type {ReviewDisplayStatus, ReviewHistory, ReviewIssue, ReviewPreparation} from "../../../ui/finance/ReviewItem";

export function toReviewDisplayStatus(history: ReviewHistory, preparation: ReviewPreparation): ReviewDisplayStatus {
  if (preparation === "blocked") return "blocked";
  if (preparation === "needs_attention") return "needs_attention";
  if (history === "new") return "new";
  if (history === "changed" || history === "reopened") return "changed";
  return "ready";
}

export function signedBasicAmount(kind: BasicKind, amount: number): number {
  return kind === "expense" ? -Math.abs(amount) : Math.abs(amount);
}

export function editorAmountValue(amount: number): string {
  return Number.isFinite(amount) ? String(Math.abs(amount)) : "";
}

export function accountEntity(account: Pick<Account, "name" | "color">): LedgerEntity {
  return {name: account.name, color: account.color};
}

export function categoryEntity(category: Pick<Category, "display_name" | "color"> | null): LedgerEntity | null {
  return category ? {name: category.display_name, color: category.color} : null;
}

export function preferredCategory(category: Category | null, suggestedCategory: Category | null): Category | null {
  return category ?? suggestedCategory;
}

export function toReviewPreparation(
  blockingIssues: readonly ReviewIssue[],
  attentionIssues: readonly ReviewIssue[],
): ReviewPreparation {
  if (blockingIssues.length > 0) return "blocked";
  if (attentionIssues.length > 0) return "needs_attention";
  return "prepared";
}

export function mergeReviewIssues(
  blockingIssues: readonly ReviewIssue[],
  attentionIssues: readonly ReviewIssue[],
): readonly ReviewIssue[] {
  return [...blockingIssues, ...attentionIssues];
}

export function isPendingReviewStatus(status: string): boolean {
  return status === "pending";
}
