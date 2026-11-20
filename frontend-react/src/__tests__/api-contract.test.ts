import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {bootstrapApi} from "../app/bootstrapApi";
import {commandSearchApi} from "../app/commandSearchApi";
import {accountsApi} from "../features/accounts/api";
import {dashboardApi} from "../features/dashboard/api";
import {planningApi} from "../features/planning/api";
import {reviewApi} from "../features/review/api";
import {settingsApi} from "../features/settings/api";
import {statisticsApi} from "../features/statistics/api";
import {transactionsApi} from "../features/transactions/api";
import {bankingApi} from "../shared/api/banking";
import {ApiError, readCachedGet, readCsrfCookie, setCsrfToken} from "../shared/api/client";
import {importsApi} from "../shared/api/imports";

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {"Content-Type": "application/json"},
});

const requestInit = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => fetchMock.mock.calls[call][1] as RequestInit;

describe("API client contract", () => {
  beforeEach(() => {
    setCsrfToken("");
    window.localStorage.clear();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    document.cookie = "mobile_review_csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  afterEach(() => {
    setCsrfToken("");
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    document.cookie = "mobile_review_csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves the complete 92-method API surface across direct domain modules", () => {
    const modules = [
      bootstrapApi,
      commandSearchApi,
      dashboardApi,
      transactionsApi,
      accountsApi,
      bankingApi,
      reviewApi,
      statisticsApi,
      settingsApi,
      planningApi,
      importsApi,
    ];
    const methods = modules.flatMap((module) => Object.keys(module));

    expect(new Set(methods).size).toBe(93);
    expect(methods.sort()).toEqual([
      "accountDetail", "accounts", "applyCategoryRule", "archiveTransaction", "automation", "bankConnectOptions", "bulkCategory", "createMonthlyClose",
      "bankReview", "bankReviewAction", "bankReviewBulk", "bankStatus", "bankTransferOptions", "bootstrap", "categories",
      "categoryDuplicates", "categoryFavorites", "categoryOrder", "categoryRuleApplications", "categoryRuleConflicts", "categoryRuleOrder",
      "categoryRules", "categoryUnused", "confirmImportBatch", "createAccount", "createBudget", "createCategory",
      "copyBudgets",
      "createBackup", "createCategoryRule", "createCategoryRuleFromCandidate", "createImportProfile", "createRecurringRule", "createSavingsObjective", "createTransaction",
      "createTransactionWithAttachment", "createTransfer", "dashboardPreferences", "dashboardSnapshot",
      "deactivateCategory", "deleteAccount", "deleteBudget", "deleteCategoryRule", "deleteImportBatch",
      "disconnectBank", "importBulk", "importRowAction", "importRows", "imports",
      "mergeCategories", "monthStatistics", "monthlyClose", "occurrenceAction", "options", "planning", "calendar", "liquidity", "prepare", "previewBudgetCopy", "previewCategoryMerge",
      "previewCategoryRule", "previewDeactivateCategory", "previewRestore", "recovery", "reopenTransaction", "resetDashboardPreferences", "restore",
      "runtimeHealth", "saveDashboardSnapshot", "savingsGoal", "search", "setRecurringRuleActive", "startBankConnect", "statistics", "syncBank", "transactions",
      "reconciliations", "saveReconciliation", "undoCategoryMerge", "undoCategoryRule", "updateAccount", "updateAutomation", "updateBudget", "updateCategory",
      "updateCategoryRule", "updateDashboardPreferences", "updateRecurringRule", "updateSavingsGoal", "updateSavingsObjective", "updateSavingsObjectiveAllocation",
      "updateTransaction", "uploadImport", "reviewSubscription",
    ].sort());
  });

  it("posts an evidence-bound subscription decision without turning it into automation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ok: true, idempotent: false}));
    vi.stubGlobal("fetch", fetchMock);

    await planningApi.reviewSubscription({
      account_id: 4,
      normalized_description: "video",
      evidence_signature: "a".repeat(64),
      expected_revision: 0,
      action: "accept",
      next_review_date: "2026-12-08",
      monthly_periodicity_confirmed: true,
      confirmed_annual_cost: "144.00",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/subscription-reviews/");
    expect((requestInit(fetchMock).method)).toBe("POST");
    expect(JSON.parse(String(requestInit(fetchMock).body))).toEqual({
      account_id: 4,
      normalized_description: "video",
      evidence_signature: "a".repeat(64),
      expected_revision: 0,
      action: "accept",
      next_review_date: "2026-12-08",
      monthly_periodicity_confirmed: true,
      confirmed_annual_cost: "144.00",
    });
  });

  it("creates and updates purpose goals through their idempotent and revision-bound endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ok: true, created: true}))
      .mockResolvedValueOnce(jsonResponse({ok: true}))
      .mockResolvedValueOnce(jsonResponse({ok: true}));
    vi.stubGlobal("fetch", fetchMock);

    await planningApi.createSavingsObjective({
      name: "Estudios",
      target_amount: "1200.00",
      target_date: "2027-06-01",
      priority: 1,
      idempotency_key: "00000000-0000-4000-8000-000000000001",
    });
    await planningApi.updateSavingsObjective(7, {expected_revision: 0, archived: true});
    await planningApi.updateSavingsObjectiveAllocation(7, {expected_revision: 1, assigned_amount: "250.00"});

    expect(fetchMock.mock.calls.map(([path, init]) => ({path, method: (init as RequestInit).method, body: (init as RequestInit).body}))).toEqual([
      {path: "/api/planning/savings-objectives/", method: "POST", body: JSON.stringify({
        name: "Estudios", target_amount: "1200.00", target_date: "2027-06-01", priority: 1, idempotency_key: "00000000-0000-4000-8000-000000000001",
      })},
      {path: "/api/planning/savings-objectives/7/", method: "PATCH", body: JSON.stringify({expected_revision: 0, archived: true})},
      {path: "/api/planning/savings-objectives/7/allocation/", method: "PUT", body: JSON.stringify({expected_revision: 1, assigned_amount: "250.00"})},
    ]);
  });

  it("uses the current CSRF cookie first and falls back to the in-memory bootstrap token", async () => {
    document.cookie = "csrftoken=cookie%20token; path=/";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ok: true, transactions: []}))
      .mockResolvedValueOnce(jsonResponse({ok: true}));
    vi.stubGlobal("fetch", fetchMock);

    setCsrfToken("memory-token");
    await transactionsApi.createTransfer({
      source_account: "1",
      target_account: "2",
      amount: "125.50",
      date: "2026-07-13",
      description: "Traspaso contractual",
      notes: "",
    });
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    await planningApi.occurrenceAction(27, "confirm");

    expect(new Headers(requestInit(fetchMock, 0).headers).get("X-CSRFToken")).toBe("cookie token");
    expect(new Headers(requestInit(fetchMock, 1).headers).get("X-CSRFToken")).toBe("memory-token");
  });

  it("selects the preview CSRF cookie without colliding with the production cookie", () => {
    document.cookie = "csrftoken=production-token; path=/";
    document.cookie = "mobile_review_csrftoken=preview-token; path=/";

    expect(readCsrfCookie(true)).toBe("preview-token");
    expect(readCsrfCookie(false)).toBe("production-token");
  });

  it("keeps GET requests CSRF-free and always uses same-origin credentials", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({snapshot: null}))
      .mockResolvedValueOnce(jsonResponse({snapshot: null}));
    vi.stubGlobal("fetch", fetchMock);
    setCsrfToken("must-not-leak-into-get");

    await dashboardApi.dashboardSnapshot();
    await dashboardApi.dashboardSnapshot("2026-07");

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/dashboard/snapshot/",
      "/api/dashboard/snapshot/?month=2026-07",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).credentials).toBe("same-origin");
      expect(new Headers((init as RequestInit).headers).has("X-CSRFToken")).toBe(false);
    }
  });

  it("does not persist a sensitive liquidity forecast in the local API cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({status: "unknown", accounts: []}));
    vi.stubGlobal("fetch", fetchMock);

    await planningApi.liquidity(4, "2026-09-08", "2026-10-07");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/planning/liquidity/?account=4&date_from=2026-09-08&date_to=2026-10-07");
    expect(requestInit(fetchMock).cache).toBe("no-store");
    expect(window.localStorage.getItem("miscuentas.api./api/planning/liquidity/?account=4&date_from=2026-09-08&date_to=2026-10-07")).toBeNull();
  });

  it("loads monthly close previews fresh and submits version decisions with same-origin CSRF", async () => {
    const payload = {
      month: "2026-06",
      basis: "analytics" as const,
      source_digest: "a".repeat(64),
      idempotency_key: "04a90669-4722-4fd0-b46f-77d50006f1b6",
      declarations: {"csv:Cuenta:pending": "Revisado."},
      correction_reason: "",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ok: true, preview: {}, versions: []}))
      .mockResolvedValueOnce(jsonResponse({ok: true, created: true, preview: {}, versions: []}, 201));
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "csrftoken=close-token; path=/";

    await statisticsApi.monthlyClose(payload.month, payload.basis);
    await statisticsApi.createMonthlyClose(payload);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/monthly-closes/?month=2026-06&basis=analytics",
      "/api/monthly-closes/",
    ]);
    expect(requestInit(fetchMock, 0).cache).toBe("no-store");
    expect(requestInit(fetchMock, 0).method).toBeUndefined();
    expect(requestInit(fetchMock, 1).method).toBe("POST");
    expect(JSON.parse(requestInit(fetchMock, 1).body as string)).toEqual(payload);
    expect(new Headers(requestInit(fetchMock, 1).headers).get("X-CSRFToken")).toBe("close-token");
    expect(requestInit(fetchMock, 1).credentials).toBe("same-origin");
    expect(window.localStorage.getItem("miscuentas.api./api/monthly-closes/?month=2026-06&basis=analytics")).toBeNull();
  });

  it("serializes JSON mutations but leaves FormData content type to the browser", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ok: true, transaction: {id: 1}}))
      .mockResolvedValueOnce(jsonResponse({ok: true, transaction: {id: 2}}));
    vi.stubGlobal("fetch", fetchMock);
    const input: Parameters<typeof transactionsApi.createTransaction>[0] = {
      kind: "expense",
      account: "4",
      category: "8",
      amount: "19.95",
      date: "2026-07-13",
      description: "Compra",
      refund_for: "",
      notes: "",
      tag_names: "",
    };
    const formData = new FormData();
    formData.set("description", "Compra con adjunto");

    await transactionsApi.createTransaction(input);
    await transactionsApi.createTransactionWithAttachment(formData);

    const jsonInit = requestInit(fetchMock, 0);
    const formInit = requestInit(fetchMock, 1);
    expect(jsonInit.body).toBe(JSON.stringify(input));
    expect(new Headers(jsonInit.headers).get("Content-Type")).toBe("application/json");
    expect(formInit.body).toBe(formData);
    expect(new Headers(formInit.headers).has("Content-Type")).toBe(false);
  });

  it("preserves the transfer endpoint, method and financial payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ok: true, transactions: []}));
    vi.stubGlobal("fetch", fetchMock);
    const transfer: Parameters<typeof transactionsApi.createTransfer>[0] = {
      source_account: "3",
      target_account: "7",
      amount: "800.00",
      date: "2026-07-13",
      description: "Ahorro",
      notes: "",
    };

    await transactionsApi.createTransfer(transfer);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/transfers/");
    expect(requestInit(fetchMock).method).toBe("POST");
    expect(JSON.parse(requestInit(fetchMock).body as string)).toEqual(transfer);
  });

  it("preserves both occurrence action routes as bodyless POST requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ok: true}));
    vi.stubGlobal("fetch", fetchMock);

    await planningApi.occurrenceAction(17, "confirm");
    await planningApi.occurrenceAction(18, "skip");

    expect(fetchMock.mock.calls.map(([path, init]) => ({
      path,
      method: (init as RequestInit).method,
      body: (init as RequestInit).body,
    }))).toEqual([
      {path: "/api/occurrences/17/confirm/", method: "POST", body: undefined},
      {path: "/api/occurrences/18/skip/", method: "POST", body: undefined},
    ]);
  });

  it("exposes status, field errors, server code and message through ApiError", async () => {
    const errors = {amount: ["El importe debe ser positivo."]};
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({error: "Datos inválidos.", errors, code: "invalid_request"}, 422)));

    const failure = await transactionsApi.createTransfer({} as Parameters<typeof transactionsApi.createTransfer>[0]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      message: "Datos inválidos.",
      status: 422,
      errors,
      code: "invalid_request",
      payload: {error: "Datos inválidos.", errors, code: "invalid_request"},
    });
  });

  it("uses the stable fallback message for an empty error response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status: 400})));

    await expect(planningApi.occurrenceAction(9, "skip")).rejects.toMatchObject({
      message: "No se pudo completar la operación. Revisa los datos e inténtalo otra vez.",
      status: 400,
      errors: undefined,
    });
  });

  it("writes successful cacheable GET payloads with a timestamp", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({csrf_token: "fresh"})));

    await bootstrapApi.bootstrap();

    const cached = JSON.parse(window.localStorage.getItem("miscuentas.api./api/bootstrap/") || "null");
    expect(cached.payload).toEqual({csrf_token: "fresh"});
    expect(Number.isNaN(Date.parse(cached.cachedAt))).toBe(false);
    expect(cached).toMatchObject({schemaVersion: 1, endpointVersion: 1});
  });

  it("invalidates old Plan cache entries before requiring the new objective payload", () => {
    const path = "/api/planning/?month=2026-09";
    const key = "miscuentas.api." + path;
    window.localStorage.setItem(key, JSON.stringify({
      payload: {goal: {active: false}},
      cachedAt: "2026-10-22T10:00:00.000Z",
      schemaVersion: 1,
      endpointVersion: 1,
    }));

    expect(readCachedGet(path)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("keeps query strings in cache keys so filtered reads cannot collide", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({transactions: [{id: 1}]}))
      .mockResolvedValueOnce(jsonResponse({transactions: [{id: 2}]}));
    vi.stubGlobal("fetch", fetchMock);

    await transactionsApi.transactions(new URLSearchParams({page: "1", search: "café"}));
    await transactionsApi.transactions(new URLSearchParams({page: "2", search: "café"}));

    const firstKey = "miscuentas.api./api/transactions/?page=1&search=caf%C3%A9";
    const secondKey = "miscuentas.api./api/transactions/?page=2&search=caf%C3%A9";
    expect(JSON.parse(window.localStorage.getItem(firstKey) || "null").payload).toEqual({transactions: [{id: 1}]});
    expect(JSON.parse(window.localStorage.getItem(secondKey) || "null").payload).toEqual({transactions: [{id: 2}]});
  });

  it("uses an exact cached GET after a network failure and reports its age", async () => {
    const path = "/api/statistics/?basis=accrual&year=2026";
    const cachedAt = "2026-07-13T11:00:00.000Z";
    const payload = {summary: {income: "100.00"}};
    window.localStorage.setItem(`miscuentas.api.${path}`, JSON.stringify({payload, cachedAt, schemaVersion: 1, endpointVersion: 1}));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const listener = vi.fn();
    window.addEventListener("miscuentas:offline-cache", listener);

    await expect(statisticsApi.statistics(new URLSearchParams({basis: "accrual", year: "2026"}))).resolves.toEqual(payload);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({path, cachedAt, stale: true});

    window.removeEventListener("miscuentas:offline-cache", listener);
  });

  it("uses cached GET data for server failures but never for 4xx responses", async () => {
    const key = "miscuentas.api./api/bootstrap/";
    const cached = {payload: {csrf_token: "cached"}, cachedAt: "2026-07-13T11:00:00.000Z", schemaVersion: 1, endpointVersion: 1};
    window.localStorage.setItem(key, JSON.stringify(cached));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({error: "Servidor no disponible."}, 503))
      .mockResolvedValueOnce(jsonResponse({error: "Sesión caducada."}, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(bootstrapApi.bootstrap()).resolves.toEqual(cached.payload);
    await expect(bootstrapApi.bootstrap()).rejects.toMatchObject({status: 401, message: "Sesión caducada."});
  });

  it("does not invalidate financial cache entries when a mutation fails", async () => {
    const key = "miscuentas.api./api/planning/";
    const cached = JSON.stringify({payload: {budgets: []}, cachedAt: "2026-07-13T11:00:00.000Z"});
    window.localStorage.setItem(key, cached);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({error: "Conflicto."}, 409)));

    await expect(planningApi.occurrenceAction(12, "confirm")).rejects.toBeInstanceOf(ApiError);
    expect(window.localStorage.getItem(key)).toBe(cached);
  });

  it("maps successful empty or non-JSON response bodies to null", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(new Response("", {status: 200}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(planningApi.occurrenceAction(4, "skip")).resolves.toBeNull();
    await expect(settingsApi.categoryDuplicates()).resolves.toBeNull();
  });

  it("treats cache writes and invalidation as best-effort storage operations", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({csrf_token: "fresh"}))
      .mockResolvedValueOnce(jsonResponse({ok: true}));
    vi.stubGlobal("fetch", fetchMock);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    await expect(bootstrapApi.bootstrap()).resolves.toEqual({csrf_token: "fresh"});

    setItem.mockRestore();
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", "cached");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    await expect(planningApi.occurrenceAction(5, "confirm")).resolves.toEqual({ok: true});
  });
});
