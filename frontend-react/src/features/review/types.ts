import type {Account} from "../../shared/model/accounts";
import type {Category, CategoryRuleMatch} from "../../shared/model/categories";
import type {BasicKind} from "../../shared/model/common";
import type {Transaction} from "../../shared/model/transactions";

export type ReviewCategoryRuleMatch = CategoryRuleMatch;

export interface BankReviewRow {
  id: number;
  bank_account: {
    id: number;
    display_name: string;
    account: Account;
  };
  booking_date: string;
  description: string;
  amount: number;
  kind: BasicKind;
  currency: string;
  category: Category | null;
  suggested_category: Category | null;
  prediction: {
    model_name?: string;
    category: Category | null;
    confidence: number;
    reason: string;
    status: string;
  } | null;
  possible_duplicate: boolean;
  possible_transfer: boolean;
  fee_transaction_id: number | null;
  status: string;
  category_rule_matches?: ReviewCategoryRuleMatch[];
  reopened_refund?: {id: number; date: string; description: string} | null;
  reopened_split?: {
    transaction_id: number;
    allocations: Array<{category: Category | null; amount: number; position: number}>;
  };
}

export interface BankReviewPayload {
  rows: BankReviewRow[];
  unlinked_transfers?: BankReviewRow[];
  categories: Category[];
  refund_candidates: Transaction[];
}

export interface BankTransferCandidateSide {
  bank_transaction_id: number | null;
  transaction_id: number | null;
  account: Pick<Account, "id" | "name">;
  booking_date: string;
  description: string;
  amount: number;
}

export interface BankTransferCandidate {
  candidate_type: "bank_row" | "transfer_group";
  candidate_id: string;
  source: "bank" | "existing_pair";
  outgoing: BankTransferCandidateSide;
  incoming: BankTransferCandidateSide;
  transfer_amount: number;
  fee_amount: number;
  requires_fee_confirmation: boolean;
  days_apart: number;
}
