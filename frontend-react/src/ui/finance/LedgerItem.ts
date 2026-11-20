export type LedgerItemId = string;

export type LedgerKind = "income" | "expense" | "transfer";

export type LedgerEntity = Readonly<{
  name: string;
  color: string;
}>;

export type LedgerItem = Readonly<{
  id: LedgerItemId;
  date: string;
  description: string;
  signedAmount: number;
  kind: LedgerKind;
  account: LedgerEntity;
  category: LedgerEntity | null;
  sourceLabel?: string;
  isRefund: boolean;
  attachmentCount: number;
}>;

export type LedgerItemCapabilities = Readonly<{
  edit: boolean;
  archive: boolean;
  reopen: boolean;
  allocate?: boolean;
}>;
