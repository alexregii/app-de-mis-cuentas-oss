import {jsonBody, request} from "../../shared/api/client";
import type {Account, AccountDetail, ReconciliationSnapshot} from "../../shared/model/accounts";
import type {BootstrapPayload} from "../../shared/model/bootstrap";
import type {BankDirectory} from "./types";

export const accountsApi = {
  accounts: () => request<{accounts: Account[]; connections: BootstrapPayload["connections"]; banking_configured: boolean}>("/api/accounts/"),
  bankConnectOptions: () => request<BankDirectory>("/api/bank-connect/"),
  startBankConnect: (input: {bank_name: string; bank_country?: string; return_to?: string}) =>
    request<{ok: true; url: string}>("/api/bank-connect/", {method: "POST", body: jsonBody(input)}),
  createAccount: (input: Record<string, unknown>) => request<{ok: true; account: Account}>("/api/accounts/", {method: "POST", body: jsonBody(input)}),
  updateAccount: (id: number, input: Record<string, unknown>) =>
    request<{ok: true; account: Account}>(`/api/accounts/${id}/`, {method: "PATCH", body: jsonBody(input)}),
  accountDetail: (id: number) => request<AccountDetail>(`/api/accounts/${id}/`),
  reconciliations: (id: number) => request<{snapshots: ReconciliationSnapshot[]}>(`/api/accounts/${id}/reconciliations/`),
  saveReconciliation: (id: number, input: {date: string; statement_balance: string}) =>
    request<{ok: true; snapshot: ReconciliationSnapshot}>(`/api/accounts/${id}/reconciliations/`, {method: "POST", body: jsonBody(input)}),
  deleteAccount: (id: number) => request<{ok: true; message: string}>(`/api/accounts/${id}/`, {method: "DELETE"}),
};
