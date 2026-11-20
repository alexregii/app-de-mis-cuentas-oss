export interface Account {
  id: number;
  name: string;
  kind: string;
  kind_display: string;
  balance: number;
  opening_balance: number;
  color: string;
  active: boolean;
  bank_link: {
    id: number;
    display_name: string;
    remote_balance: number | null;
    remote_balance_type: string;
    remote_balance_currency: string;
    remote_balance_reference_date: string;
    balance_updated_at: string;
    last_transaction_date: string;
    connection_id: number;
  } | null;
}

export interface Connection {
  id: number;
  bank_name: string;
  bank_country: string;
  status: string;
  status_display: string;
  sync_status: string;
  sync_status_display: string;
  sync_started_at: string;
  sync_started_at_display: string;
  last_synced_at: string;
  last_synced_at_display: string;
  last_error: string;
  authorized_until: string;
  accounts: Account[];
}

export interface AccountDetail {
  account: Account;
  period: {start: string; end: string; income: number; expense: number};
  recent: import("./transactions").Transaction[];
  connection: Connection | null;
  latest_reconciliation: ReconciliationSnapshot | null;
}

export interface ReconciliationSnapshot {
  id: number;
  date: string;
  statement_balance: number;
  ledger_balance: number;
  difference: number;
  status: "reconciled" | "difference" | "stale";
  status_display: string;
  created_at: string;
  current_ledger_balance: number;
  ledger_change: number;
  stale: boolean;
  diagnosis: {pending_bank: number; pending_imports: number; possible_duplicates: number};
}
