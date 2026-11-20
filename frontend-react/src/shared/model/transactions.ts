import type {Account} from "./accounts";
import type {Category} from "./categories";
import type {Kind} from "./common";

export interface Transaction {
  id: number;
  kind: Kind;
  kind_display: string;
  amount: number;
  signed_amount: number;
  date: string;
  description: string;
  notes: string;
  account: Account;
  category: Category | null;
  allocations?: Array<{category: Category | null; amount: number; position: number}>;
  allocation_revision?: number;
  can_allocate?: boolean;
  source: string;
  source_display: string;
  refund_for_id: number | null;
  is_refund: boolean;
  is_transfer: boolean;
  can_reopen?: boolean;
  tags: string[];
  attachments: Array<{id: number; name: string; url: string}>;
  statistics_attribution?: {
    applied_amount: number;
    extra_income: number;
  };
}
