import {act, renderHook, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {useAppBootstrap} from "../app/hooks/useAppBootstrap";
import type {BootstrapPayload} from "../shared/model/bootstrap";

const apiMock = vi.hoisted(() => ({bootstrap: vi.fn(), options: vi.fn()}));

vi.mock("../app/bootstrapApi", () => ({bootstrapApi: apiMock}));

const payload = (csrfToken: string) => ({
  csrf_token: csrfToken,
  metrics: {start: "2026-08-01", end: "2026-08-31", income: 0, expense: 0, net_savings: 0},
  review: {},
  accounts: [],
  categories: [],
  recent: [],
  budget_items: [],
  signals: [],
  connections: [],
  preferences: {},
  dashboard: {},
}) as unknown as BootstrapPayload;

describe("bootstrap stale-while-revalidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders the valid cached payload immediately and replaces it with one network request", async () => {
    const cached = payload("cached-token");
    const fresh = payload("fresh-token");
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", JSON.stringify({
      payload: cached,
      cachedAt: "2026-08-10T17:00:00.000Z",
      schemaVersion: 1,
      endpointVersion: 1,
    }));
    let resolveNetwork!: (value: BootstrapPayload) => void;
    apiMock.bootstrap.mockReturnValue(new Promise<BootstrapPayload>((resolve) => { resolveNetwork = resolve; }));

    const {result} = renderHook(() => useAppBootstrap());

    expect(result.current.bootstrap).toEqual(cached);
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(apiMock.bootstrap).toHaveBeenCalledTimes(1));

    await act(async () => { resolveNetwork(fresh); });
    await waitFor(() => expect(result.current.bootstrap).toEqual(fresh));
  });

  it("deduplicates concurrent bootstrap reloads", async () => {
    let resolveNetwork!: (value: BootstrapPayload) => void;
    apiMock.bootstrap.mockReturnValue(new Promise<BootstrapPayload>((resolve) => { resolveNetwork = resolve; }));
    const {result} = renderHook(() => useAppBootstrap());
    await waitFor(() => expect(apiMock.bootstrap).toHaveBeenCalledTimes(1));

    const first = result.current.reload();
    const second = result.current.reload();
    resolveNetwork(payload("fresh-token"));
    await act(async () => { await Promise.all([first, second]); });

    expect(apiMock.bootstrap).toHaveBeenCalledTimes(1);
  });

  it("renews options without desmontar una sección que ya está activa", async () => {
    const initialOptions = {transaction_kinds: [{value: "expense", label: "Gasto"}]} as never;
    const refreshedOptions = {transaction_kinds: [{value: "income", label: "Ingreso"}]} as never;
    apiMock.bootstrap.mockResolvedValue(payload("fresh-token"));
    apiMock.options.mockResolvedValue(initialOptions);

    const {result} = renderHook(() => useAppBootstrap());
    await act(async () => { await result.current.ensureOptions(); });

    apiMock.options.mockResolvedValue(refreshedOptions);
    await act(async () => { await result.current.reload(); });

    expect(result.current.options).toEqual(refreshedOptions);
    expect(apiMock.options.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
