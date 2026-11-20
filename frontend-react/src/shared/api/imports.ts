import type {CsvImportBulkRequest, CsvImportMutationPayload, CsvImportRowActionRequest, ImportPayload, ImportProfile, ImportRow, ImportRowsPayload} from "../model/imports";
import {jsonBody, request} from "./client";

export const importsApi = {
  imports: () => request<ImportPayload>("/api/imports/"),
  createImportProfile: (input: Record<string, unknown>) =>
    request<{ok: true; profile: ImportProfile}>("/api/import-profiles/", {method: "POST", body: jsonBody(input)}),
  uploadImport: (formData: FormData) => request<{ok: true; batch: ImportPayload["batches"][number]}>("/api/imports/upload/", {method: "POST", body: formData}),
  deleteImportBatch: (batchId: number) => request<{ok: true; message: string}>(`/api/imports/${batchId}/`, {method: "DELETE"}),
  importRows: (batchId: number, params: URLSearchParams) => request<ImportRowsPayload>(`/api/imports/${batchId}/rows/?${params.toString()}`),
  confirmImportBatch: (batchId: number) => request<{ok: true; message: string; imported: number; removed: number[]}>(`/api/imports/${batchId}/confirm/`, {method: "POST"}),
  importRowAction: (rowId: number, input: CsvImportRowActionRequest) =>
    request<{ok: true; message: string; removed?: number[]; row?: ImportRow}>(`/api/import-rows/${rowId}/${input.action}/`, {method: "POST", body: jsonBody(input.input)}),
  importBulk: (batchId: number, input: CsvImportBulkRequest) =>
    request<{ok: true; message: string; removed: number[]; failed: number[]}>(`/api/imports/${batchId}/bulk/`, {method: "POST", body: jsonBody(input)}),
};
