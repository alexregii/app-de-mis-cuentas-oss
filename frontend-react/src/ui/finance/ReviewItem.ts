import type {LedgerEntity, LedgerKind} from "./LedgerItem";

export type ReviewDisplayStatus = "new" | "changed" | "needs_attention" | "blocked" | "ready";
export type ReviewHistory = "new" | "changed" | "unchanged" | "reopened";
export type ReviewPreparation = "prepared" | "needs_attention" | "blocked";
export type ReviewDecision = "pending" | "incorporated";
export type ReviewField = "amount" | "description" | "date" | "account" | "category" | "kind" | "transfer_source_account" | "transfer_target_account";

export type ReviewChange = Readonly<{
  field: ReviewField;
  previous?: unknown;
  current: unknown;
}>;

export type ReviewIssue = Readonly<{
  code: string;
  message: string;
}>;

/** Datos preparados para representación; el dominio y sus objetos permanecen en la feature. */
export type ReviewItem = Readonly<{
  id: string;
  description: string;
  date: string;
  signedAmount: number;
  kind: LedgerKind;
  account: LedgerEntity | null;
  category: LedgerEntity | null;
  sourceLabel?: string;
  isRefund: boolean;
  attachmentCount: number;
  transferFrom?: string;
  transferTo?: string;
  status: ReviewDisplayStatus;
  showMissingCategory?: boolean;
  changes: readonly ReviewChange[];
  /** Prepared issues that prevent incorporation; attention issues stay separate in feature props. */
  issues: readonly ReviewIssue[];
}>;
