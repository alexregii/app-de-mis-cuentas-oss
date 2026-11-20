import type {Account} from "../../shared/model/accounts";
import type {Category} from "../../shared/model/categories";
import type {BasicKind, Choice} from "../../shared/model/common";
import type {Transaction} from "../../shared/model/transactions";

export interface TransactionListPayload {
  count: number;
  page: number;
  page_size: number;
  num_pages: number;
  has_next: boolean;
  has_previous: boolean;
  results: Transaction[];
  summary?: {income: number; expense: number; net: number; excluded: number; count: number};
  filters: {
    accounts: Account[];
    categories: Category[];
    kinds: Choice[];
    sources: Choice[];
  };
  statistics_attribution?: {
    income?: number;
    gross_expense: number;
    refunds_applied: number;
    extra_income: number;
    net_expense: number;
    analytical_result?: number;
    savings_rate?: number | null;
  };
}

export interface TransactionInput {
  kind: BasicKind;
  amount: string;
  account: string;
  date: string;
  description: string;
  category: string;
  allocations?: Array<{category_id: number | null; amount: string}>;
  expected_allocation_revision?: number;
  refund_for: string;
  notes: string;
  tag_names: string;
}

export interface TransferInput {
  source_account: string;
  target_account: string;
  amount: string;
  date: string;
  description: string;
  notes: string;
}
