import {jsonBody, request} from "../../shared/api/client";
import type {BankReviewPayload} from "./types";
import type {BankTransferCandidate} from "./types";
import type {BankReviewAction, BankReviewActionInput, BankReviewBulkInput} from "./adapters/reviewAdapterTypes";

export const reviewApi = {
  bankReview: () => request<BankReviewPayload>("/api/bank-review/"),
  bankTransferOptions: (id: number) => request<{ok: true; candidates: BankTransferCandidate[]}>(`/api/bank-review/${id}/transfer-options/`, {cache: "no-store"}),
  bankReviewAction: (id: number, action: BankReviewAction, input: BankReviewActionInput = {}) =>
    request<{ok: true; message: string; removed: number[]}>(`/api/bank-review/${id}/${action}/`, {method: "POST", body: jsonBody(input)}),
  bankReviewBulk: (input: BankReviewBulkInput) =>
    request<{ok: true; message: string; removed: number[]; failed: number[]}>("/api/bank-review/bulk/", {method: "POST", body: jsonBody(input)}),
};
