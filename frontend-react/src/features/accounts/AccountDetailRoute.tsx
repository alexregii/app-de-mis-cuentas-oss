import {bankingApi} from "../../shared/api/banking";
import type {Account} from "../../shared/model/accounts";
import {AccountDetailView} from "./AccountDetailView";

export function AccountDetailRoute({
  accountId,
  privateAmounts = false,
  onBack,
  onEdit,
  onOpenTransactions,
  onOpenReview,
  refresh,
}: {
  accountId: number;
  privateAmounts?: boolean;
  onBack: (history?: "push" | "replace") => void;
  onEdit: (account: Account) => void;
  onOpenTransactions: () => void;
  onOpenReview: (search?: URLSearchParams) => void;
  refresh: () => Promise<void>;
}) {
  return <AccountDetailView
    accountId={accountId}
    privateAmounts={privateAmounts}
    onBack={() => onBack()}
    onEdit={(account) => { onEdit(account); onBack("replace"); }}
    onOpenTransactions={onOpenTransactions}
    onOpenReview={onOpenReview}
    onSync={async (connectionId) => { await bankingApi.syncBank(connectionId); await refresh(); }}
  />;
}
