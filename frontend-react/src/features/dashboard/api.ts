import {jsonBody, request} from "../../shared/api/client";
import type {BootstrapPayload} from "../../shared/model/bootstrap";
import type {DashboardSnapshot} from "../../shared/model/dashboard";

export const dashboardApi = {
  dashboardPreferences: () => request<{ok: true; preferences: BootstrapPayload["preferences"]}>("/api/dashboard/preferences/"),
  updateDashboardPreferences: (input: Partial<BootstrapPayload["preferences"]>) => request<{ok: true; preferences: BootstrapPayload["preferences"]}>("/api/dashboard/preferences/", {method: "PUT", body: jsonBody(input)}),
  resetDashboardPreferences: () => request<{ok: true; preferences: BootstrapPayload["preferences"]}>("/api/dashboard/preferences/reset/", {method: "POST"}),
  dashboardSnapshot: (month?: string) => request<{snapshot: DashboardSnapshot | null}>(`/api/dashboard/snapshot/${month ? `?month=${month}` : ""}`),
  saveDashboardSnapshot: () => request<{ok: true; replaced: boolean; snapshot: DashboardSnapshot}>("/api/dashboard/snapshot/", {method: "POST"}),
};
