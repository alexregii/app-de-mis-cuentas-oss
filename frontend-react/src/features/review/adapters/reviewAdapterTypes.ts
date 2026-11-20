import type {LedgerEntity} from "../../../ui/finance/LedgerItem";
import type {
  ReviewChange,
  ReviewDisplayStatus,
  ReviewHistory,
  ReviewIssue,
  ReviewItem,
  ReviewField,
  ReviewPreparation,
  ReviewDecision,
} from "../../../ui/finance/ReviewItem";
import type {TransactionEditorInput} from "../../../ui/finance/TransactionEditor";
import type {CsvImportBulkRequest, CsvImportMutationPayload, CsvImportRowActionRequest} from "../../../shared/model/imports";
import type {ReviewCategoryRuleMatch} from "../types";

export type ReviewAdapterSource = "bank" | "csv";

export type ReviewDraftKind = "income" | "expense" | "transfer";

/** Estado editable de la feature; nunca muta la fila raw ni contiene React. */
export type ReviewDraft = Readonly<{
  kind: ReviewDraftKind;
  amount: string;
  account: string;
  source_account: string;
  target_account: string;
  date: string;
  description: string;
  category: string;
  refund_for: string;
  notes: string;
  tag_names: string;
  remember_category: boolean;
  new_category: string;
  new_subcategory: string;
}>;

export type ReviewCapabilities = Readonly<{
  canEditDraft: boolean;
  editableFields: readonly ReviewField[];
  canPersistStandaloneEdit: boolean;
  select: boolean;
  confirm: boolean;
  force: boolean;
  category: boolean;
  skip: boolean;
  transfer: boolean;
  canChooseRefund: boolean;
  canRememberCategory: boolean;
}>;

export type ReviewSuggestion = Readonly<{
  category: LedgerEntity | null;
  confidence: number;
  reason: string;
  modelName?: string;
  status?: string;
}>;

export type ReviewIdentifier = number | string;

export type BankConfirmPayload = Readonly<{
  category: ReviewIdentifier | "";
  refund_for: ReviewIdentifier | "";
  remember_category: boolean;
}>;

export type BankTransferLinkPayload = Readonly<{
  candidate_type: "bank_row" | "transfer_group";
  candidate_id: ReviewIdentifier;
  confirm_fee: boolean;
}>;

export type CsvConfirmPayload = CsvImportMutationPayload;

export type CsvCategoryPayload = CsvConfirmPayload;
export type EmptyMutationPayload = Readonly<Record<string, never>>;
export type CsvReviewActionRequest = CsvImportRowActionRequest;
export type CsvReviewAction = CsvReviewActionRequest["action"];
export type CsvReviewBulkInput = CsvImportBulkRequest;

export type ReviewPreparedAction =
  | Readonly<{kind: "confirm"; source: "bank"; sourceId: number; input: BankConfirmPayload}>
  | Readonly<{kind: "force"; source: "bank"; sourceId: number; input: BankConfirmPayload}>
  | Readonly<{kind: "confirm"; source: "csv"; sourceId: number; input: CsvConfirmPayload}>
  | Readonly<{kind: "force"; source: "csv"; sourceId: number; input: CsvConfirmPayload}>
  | Readonly<{kind: "category"; source: "csv"; sourceId: number; input: CsvCategoryPayload}>
  | Readonly<{kind: "skip"; source: ReviewAdapterSource; sourceId: number; input?: undefined}>
  | Readonly<{kind: "transfer"; source: "bank"; sourceId: number; input: EmptyMutationPayload}>;

export type ReviewConfirmAction = Extract<ReviewPreparedAction, {kind: "confirm"}>;
export type ReviewForceAction = Extract<ReviewPreparedAction, {kind: "force"}>;
export type ReviewCategoryAction = Extract<ReviewPreparedAction, {kind: "category"}>;
export type ReviewSkipAction = Extract<ReviewPreparedAction, {kind: "skip"}>;
export type ReviewTransferAction = Extract<ReviewPreparedAction, {kind: "transfer"}>;

export type BankReviewAction = "confirm" | "force" | "transfer" | "skip";
export type BankReviewActionInput = BankConfirmPayload | BankTransferLinkPayload | EmptyMutationPayload;
export type BankReviewBulkInput =
  | Readonly<{action: "import_safe"}>
  | Readonly<{action: "confirm"; rows: readonly number[]; categories: Readonly<Record<string, string>>}>
  | Readonly<{action: "skip"; rows: readonly number[]}>;

/** Frontera preparada que la orquestación de la feature puede entregar a src/ui. */
export type PreparedReview = Readonly<{
  source: ReviewAdapterSource;
  sourceId: number;
  contextAccountId?: number;
  contextBatchId?: number | null;
  categoryRuleMatches?: readonly ReviewCategoryRuleMatch[];
  draftIsDirty: boolean;
  item: ReviewItem;
  draft: ReviewDraft;
  history: ReviewHistory;
  preparation: ReviewPreparation;
  decision: ReviewDecision;
  changes: readonly ReviewChange[];
  issues: readonly ReviewIssue[];
  blockingIssues: readonly ReviewIssue[];
  attentionIssues: readonly ReviewIssue[];
  suggestion?: ReviewSuggestion;
  preservedAllocationLabels?: readonly string[];
  preservedRefundDescription?: string;
  capabilities: ReviewCapabilities;
  editorInput: TransactionEditorInput;
  actions: Readonly<{
    confirm?: ReviewConfirmAction;
    force?: ReviewForceAction;
    category?: ReviewCategoryAction;
    skip?: ReviewSkipAction;
    transfer?: ReviewTransferAction;
  }>;
  displayStatus: ReviewDisplayStatus;
}>;
