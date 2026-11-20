import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {bootstrapApi} from "../app/bootstrapApi";
import {planningApi} from "../features/planning/api";
import {reviewApi} from "../features/review/api";
import {settingsApi} from "../features/settings/api";
import {AUTH_INVALIDATED_EVENT, clearOfflineData, prefetchGet, request} from "../shared/api/client";
import {importsApi} from "../shared/api/imports";

describe("API cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("invalidates cached financial reads after a successful mutation", async () => {
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", JSON.stringify({payload: {cached: true}, cachedAt: "2026-07-13T10:00:00.000Z"}));
    window.localStorage.setItem("miscuentas.session.transactions.saved-views.v1", "criteria only");
    window.localStorage.setItem("unrelated", "keep");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ok: true, automation: {}}), {
      status: 200,
      headers: {"Content-Type": "application/json"},
    })));

    await settingsApi.updateAutomation({llm_enabled: false});

    expect(window.localStorage.getItem("miscuentas.api./api/bootstrap/")).toBeNull();
    expect(window.localStorage.getItem("miscuentas.session.transactions.saved-views.v1")).toBe("criteria only");
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });

  it("reuses a successful screen prefetch for the matching GET without changing its payload", async () => {
    const path = "/api/statistics/?period=12&basis=analytics&prefetch-test=reuse";
    const payload = {summary: {income: 123, net_expense: 45}, categories: [{id: 7}], monthly_series: [{month: "2026-08"}]};
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: {"Content-Type": "application/json"},
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(prefetchGet(path)).resolves.toEqual(payload);
    await expect(request(path)).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expires screen prefetches after five seconds", async () => {
    vi.useFakeTimers();
    const path = "/api/transactions/?analytics=all&page=1&prefetch-test=expiry";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({results: [{id: 1}]}), {status: 200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({results: [{id: 2}]}), {status: 200}));
    vi.stubGlobal("fetch", fetchMock);

    await prefetchGet(path);
    vi.advanceTimersByTime(5_001);
    await expect(request(path)).resolves.toEqual({results: [{id: 2}]});

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates fresh screen prefetches after a successful mutation", async () => {
    const path = "/api/bank-review/?prefetch-test=mutation";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({rows: [{id: 1}]}), {status: 200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ok: true, automation: {}}), {status: 200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({rows: [{id: 2}]}), {status: 200}));
    vi.stubGlobal("fetch", fetchMock);

    await prefetchGet(path);
    await settingsApi.updateAutomation({llm_enabled: false});
    await expect(request(path)).resolves.toEqual({rows: [{id: 2}]});

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports the age of cached data used while offline", async () => {
    const cachedAt = "2026-07-13T10:00:00.000Z";
    const payload = {csrf_token: "cached"};
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", JSON.stringify({payload, cachedAt, schemaVersion: 1, endpointVersion: 1}));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const listener = vi.fn();
    window.addEventListener("miscuentas:offline-cache", listener);

    await expect(bootstrapApi.bootstrap()).resolves.toEqual(payload);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({path: "/api/bootstrap/", cachedAt, stale: true});

    window.removeEventListener("miscuentas:offline-cache", listener);
  });

  it("rejects and removes a cache without the current metadata", async () => {
    const cachedAt = new Date().toISOString();
    const key = "miscuentas.api./api/bootstrap/";
    window.localStorage.setItem(key, JSON.stringify({payload: {csrf_token: "legacy"}, cachedAt}));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(bootstrapApi.bootstrap()).rejects.toThrow("offline");
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("clears only this app's offline data without contacting the server", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {keys: vi.fn().mockResolvedValue(["mis-cuentas-shell-v1", "other-app-v1"]), delete: remove});
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", "cached");
    window.localStorage.setItem("miscuentas.session.transactions.saved-views.v1", "criteria only");
    window.localStorage.setItem("app.desktop-rail.collapsed", "true");
    const preferences = JSON.stringify({version: 1, theme: "basalt", privacyMode: true});
    window.localStorage.setItem("app.preferences.v1", preferences);

    await clearOfflineData();

    expect(window.localStorage.getItem("miscuentas.api./api/bootstrap/")).toBeNull();
    expect(window.localStorage.getItem("miscuentas.session.transactions.saved-views.v1")).toBeNull();
    expect(window.localStorage.getItem("app.desktop-rail.collapsed")).toBe("true");
    expect(window.localStorage.getItem("app.preferences.v1")).toBe(preferences);
    expect(remove).toHaveBeenCalledWith("mis-cuentas-shell-v1");
    expect(remove).not.toHaveBeenCalledWith("other-app-v1");
  });

  it("does not hide authorization errors behind cached data", async () => {
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", JSON.stringify({payload: {csrf_token: "cached"}, cachedAt: "2026-07-13T10:00:00.000Z"}));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({error: "Acceso denegado."}), {
      status: 403,
      headers: {"Content-Type": "application/json"},
    })));

    await expect(bootstrapApi.bootstrap()).rejects.toMatchObject({status: 403, message: "Acceso denegado."});
  });

  it("ignores a stale unauthorized response after a newer login", async () => {
    let finishStaleRead: ((response: Response) => void) | undefined;
    const stalePath = "/api/bootstrap/?stale-auth-race=1";
    const fetchMock = vi.fn((path: string) => {
      if (path === stalePath) return new Promise<Response>((resolve) => { finishStaleRead = resolve; });
      return Promise.resolve(new Response(JSON.stringify({ok: true}), {
        status: 200,
        headers: {"Content-Type": "application/json"},
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const invalidated = vi.fn();
    window.addEventListener(AUTH_INVALIDATED_EVENT, invalidated);

    const staleRead = request(stalePath, {cache: "no-store"}).catch((error: unknown) => error);
    await request("/api/auth/login/", {method: "POST", body: "{}"});
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", "new session cache");
    finishStaleRead?.(new Response(JSON.stringify({error: "expired"}), {
      status: 401,
      headers: {"Content-Type": "application/json"},
    }));
    await staleRead;

    expect(invalidated).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("miscuentas.api./api/bootstrap/")).toBe("new session cache");
    window.removeEventListener(AUTH_INVALIDATED_EVENT, invalidated);
  });

  it("clears cached finance data on authentication expiry and blocks stale in-flight cache writes", async () => {
    const key = "miscuentas.api./api/transactions/";
    let resolveTransactions: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveTransactions = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ok: true}), {status: 200, headers: {"Content-Type": "application/json"}}));
    vi.stubGlobal("fetch", fetchMock);
    const expiry = vi.fn();
    window.addEventListener("miscuentas:auth-invalidated", expiry);
    const pending = request<{results: unknown[]}>("/api/transactions/");

    await request("/api/auth/logout/", {method: "POST", body: JSON.stringify({})});
    resolveTransactions?.(new Response(JSON.stringify({results: [{id: 1}]}), {status: 200, headers: {"Content-Type": "application/json"}}));
    await expect(pending).resolves.toEqual({results: [{id: 1}]});
    expect(window.localStorage.getItem(key)).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error: "Sesión caducada."}), {status: 401, headers: {"Content-Type": "application/json"}}));
    await expect(request("/api/transactions/")).rejects.toMatchObject({status: 401});
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(expiry).toHaveBeenCalledTimes(1);
    window.removeEventListener("miscuentas:auth-invalidated", expiry);
  });

  it("preserves bank and CSV review endpoints and transfer payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ok: true}), {
      status: 200,
      headers: {"Content-Type": "application/json"},
    }));
    vi.stubGlobal("fetch", fetchMock);

    await reviewApi.bankReviewAction(41, "transfer", {candidate_type: "bank_row", candidate_id: 42, confirm_fee: false});
    await reviewApi.bankReviewAction(41, "force", {category: 2, refund_for: "", remember_category: false});
    await reviewApi.bankReviewBulk({action: "skip", rows: [41]});
    await importsApi.importRowAction(71, {action: "confirm", input: {category: "2", new_category: "", new_subcategory: ""}});
    await importsApi.importBulk(61, {action: "skip", rows: [71]});

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/bank-review/41/transfer/",
      "/api/bank-review/41/force/",
      "/api/bank-review/bulk/",
      "/api/import-rows/71/confirm/",
      "/api/imports/61/bulk/",
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))).toEqual([
      {candidate_type: "bank_row", candidate_id: 42, confirm_fee: false},
      {category: 2, refund_for: "", remember_category: false},
      {action: "skip", rows: [41]},
      {category: "2", new_category: "", new_subcategory: ""},
      {action: "skip", rows: [71]},
    ]);
  });

  it("loads transfer candidates on demand without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ok: true, candidates: []}), {
      status: 200,
      headers: {"Content-Type": "application/json"},
    }));
    vi.stubGlobal("fetch", fetchMock);

    await reviewApi.bankTransferOptions(41);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/bank-review/41/transfer-options/");
    expect((fetchMock.mock.calls[0][1] as RequestInit).cache).toBe("no-store");
  });

  it("does not read or overwrite cached liquidity data on failure or successful no-store retry", async () => {
    const dateFrom = "2026-09-08";
    const dateTo = "2026-10-07";
    const path = `/api/planning/liquidity/?account=1&date_from=${dateFrom}&date_to=${dateTo}`;
    const key = `miscuentas.api.${path}`;
    const staleRaw = JSON.stringify({payload: {minimum_balance: 999_999.99}, cachedAt: "2026-09-08T10:00:00.000Z", schemaVersion: 1, endpointVersion: 1});
    window.localStorage.setItem(key, staleRaw);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({error: "Fallo simulado de la previsión."}), {
        status: 503,
        headers: {"Content-Type": "application/json"},
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({status: "known", minimum_balance: 10}), {
        status: 200,
        headers: {"Content-Type": "application/json"},
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(planningApi.liquidity(1, dateFrom, dateTo)).rejects.toMatchObject({status: 503});
    expect(fetchMock.mock.calls[0][0]).toBe(path);
    expect((fetchMock.mock.calls[0][1] as RequestInit).cache).toBe("no-store");
    expect(window.localStorage.getItem(key)).toBe(staleRaw);

    await expect(planningApi.liquidity(1, dateFrom, dateTo)).resolves.toMatchObject({status: "known", minimum_balance: 10});
    expect(fetchMock.mock.calls[1][0]).toBe(path);
    expect((fetchMock.mock.calls[1][1] as RequestInit).cache).toBe("no-store");
    expect(window.localStorage.getItem(key)).toBe(staleRaw);
  });
});
