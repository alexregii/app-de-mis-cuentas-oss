import type {Account} from "./accounts";
import type {Category, CategoryRuleMatch} from "./categories";
import type {BasicKind} from "./common";

export type CsvImportMutationPayload = Readonly<{
  category: string | number;
  new_category: string;
  new_subcategory: string;
}>;

export type CsvImportRowActionRequest =
  | Readonly<{action: "confirm" | "force" | "category"; input: CsvImportMutationPayload}>
  | Readonly<{action: "skip"; input: Readonly<Record<string, never>>}>;

export type CsvImportBulkRequest =
  | Readonly<{action: "import_safe"}>
  | Readonly<{action: "confirm"; rows: readonly number[]; categories: Readonly<Record<string, string>>}>
  | Readonly<{action: "skip"; rows: readonly number[]}>;

export interface ImportProfile {
  id: number;
  name: string;
  delimiter: string;
  date_format: string;
  date_column: string;
  description_column: string;
  amount_column: string;
  category_column: string;
  subcategory_column: string;
}

export interface ImportBatch {
  id: number;
  filename: string;
  account: Account;
  profile: ImportProfile | null;
  status: string;
  status_display: string;
  created_at: string;
  pending_count: number;
  row_count: number;
}

export interface ImportRow {
  id: number;
  batch_id: number;
  row_number: number;
  date: string;
  description: string;
  amount: number;
  kind: BasicKind;
  category: Category | null;
  possible_duplicate: boolean;
  status: string;
  status_display: string;
  transaction_id: number | null;
  category_rule_matches?: CategoryRuleMatch[];
  reopened_refund?: {id: number; date: string; description: string} | null;
  reopened_split?: {
    transaction_id: number;
    allocations: Array<{category: Category | null; amount: number; position: number}>;
  };
}

export interface ImportPayload {
  profiles: ImportProfile[];
  default_profile_id: number | null;
  batches: ImportBatch[];
  accounts: Account[];
}

export interface ImportRowsPayload {
  batch: ImportBatch;
  count: number;
  page: number;
  num_pages: number;
  has_next: boolean;
  has_previous: boolean;
  results: ImportRow[];
  categories: Category[];
}
