import {jsonBody, request} from "../../shared/api/client";
import type {Transaction} from "../../shared/model/transactions";
import type {TransactionInput, TransactionListPayload, TransferInput} from "./types";

export const transactionsApi = {
  transactions: (params: URLSearchParams) => request<TransactionListPayload>(`/api/transactions/?${params.toString()}`),
  createTransaction: (input: TransactionInput) =>
    request<{ok: true; transaction: Transaction}>("/api/transactions/", {method: "POST", body: jsonBody(input)}),
  createTransactionWithAttachment: (formData: FormData) =>
    request<{ok: true; transaction: Transaction}>("/api/transactions/", {method: "POST", body: formData}),
  updateTransaction: (id: number, input: Partial<TransactionInput>) =>
    request<{ok: true; transaction: Transaction}>(`/api/transactions/${id}/`, {method: "PATCH", body: jsonBody(input)}),
  archiveTransaction: (id: number) => request<{ok: true; message: string}>(`/api/transactions/${id}/archive/`, {method: "POST"}),
  reopenTransaction: (id: number) => request<{ok: true; message: string; source: string; target: number}>(`/api/transactions/${id}/reopen/`, {method: "POST"}),
  bulkCategory: (rows: number[], category: number) => request<{ok: true; updated: number[]; message: string}>("/api/transactions/bulk-category/", {method: "POST", body: jsonBody({rows, category})}),
  createTransfer: (input: TransferInput) =>
    request<{ok: true; transactions: Transaction[]}>("/api/transfers/", {method: "POST", body: jsonBody(input)}),
};
