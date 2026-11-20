import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {AuthGate} from "../app/auth/AuthGate";
import {AUTH_INVALIDATED_EVENT} from "../shared/api/client";
import {APP_PREFERENCES_STORAGE_KEY} from "../app/preferences/appPreferences";

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {"Content-Type": "application/json"},
});

const sessionPayload = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  required: true,
  authenticated: false,
  username: null,
  expires_at: null,
  csrf_token: "test-csrf-token",
  ...overrides,
});

const renderGate = () => render(
  <AuthGate>
    {(logout) => <main><p>Datos financieros privados</p><button type="button" onClick={() => { void logout(); }}>Salir</button></main>}
  </AuthGate>,
);

describe("application authentication gate", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.dataset.theme = "mineral";
  });

  it("does not mount finance content until the session check resolves", async () => {
    let finishSession: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finishSession = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", "cached finance");

    renderGate();

    expect(screen.queryByText("Datos financieros privados")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Comprobando la sesión");
    finishSession?.(jsonResponse(sessionPayload({authenticated: true, username: "operator", expires_at: "2026-10-18T08:00:00+02:00"})));

    expect(await screen.findByText("Datos financieros privados")).toBeInTheDocument();
  });

  it("logs in with CSRF and clears old financial cache before mounting the app", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(sessionPayload()))
      .mockResolvedValueOnce(jsonResponse(sessionPayload({authenticated: true, username: "operator", expires_at: "2026-10-18T08:00:00+02:00"})));
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", "previous session data");

    renderGate();
    await screen.findByRole("heading", {name: "Inicia sesión"});
    fireEvent.change(screen.getByLabelText("Usuario"), {target: {value: "operator"}});
    fireEvent.change(screen.getByLabelText("Contraseña"), {target: {value: "fake-test-password"}});
    fireEvent.click(screen.getByRole("button", {name: "Entrar"}));

    expect(await screen.findByText("Datos financieros privados")).toBeInTheDocument();
    expect(window.localStorage.getItem("miscuentas.api./api/bootstrap/")).toBeNull();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/login/");
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("X-CSRFToken")).toBe("test-csrf-token");
  });

  it("clears cached data and hides the app when the server invalidates the session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(sessionPayload({authenticated: true, username: "operator", expires_at: "2026-10-18T08:00:00+02:00"}))));
    window.localStorage.setItem("miscuentas.api./api/bootstrap/", "session data");
    window.localStorage.setItem("miscuentas.session.transactions.saved-views.v1", "private filter criteria");
    renderGate();
    await screen.findByText("Datos financieros privados");

    window.dispatchEvent(new CustomEvent(AUTH_INVALIDATED_EVENT));

    await screen.findByRole("heading", {name: "Inicia sesión"});
    await waitFor(() => expect(window.localStorage.getItem("miscuentas.api./api/bootstrap/")).toBeNull());
    expect(window.localStorage.getItem("miscuentas.session.transactions.saved-views.v1")).toBeNull();
  });

  it("locks an already-open tab when another tab closes the shared session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(sessionPayload({authenticated: true, username: "operator", expires_at: "2026-10-18T08:00:00+02:00"}))));
    renderGate();
    await screen.findByText("Datos financieros privados");

    window.dispatchEvent(new StorageEvent("storage", {key: "miscuentas.auth.logout_at", newValue: "123"}));

    expect(await screen.findByRole("heading", {name: "Inicia sesión"})).toBeInTheDocument();
  });

  it("does not remount finance content when a pending session check finishes after cross-tab logout", async () => {
    let finishSession: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finishSession = resolve; })));
    renderGate();

    window.dispatchEvent(new StorageEvent("storage", {key: "miscuentas.auth.logout_at", newValue: "123"}));
    expect(await screen.findByRole("heading", {name: "Inicia sesión"})).toBeInTheDocument();
    finishSession?.(jsonResponse(sessionPayload({authenticated: true, username: "operator", expires_at: "2026-10-18T08:00:00+02:00"})));

    await waitFor(() => expect(screen.queryByText("Datos financieros privados")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", {name: "Inicia sesión"})).toBeInTheDocument();
  });

  it("shows an expiry message when a previously authenticated session is already expired on reload", async () => {
    window.localStorage.setItem("miscuentas.auth.was_authenticated", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(sessionPayload())));

    renderGate();

    expect(await screen.findByRole("alert")).toHaveTextContent("Tu sesión ha caducado");
  });

  it("keeps the saved Basalt theme on the login screen", async () => {
    window.localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify({version: 1, theme: "basalt", privacyMode: false}));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(sessionPayload())));

    renderGate();

    await screen.findByRole("heading", {name: "Inicia sesión"});
    expect(document.documentElement.dataset.theme).toBe("basalt");
  });

  it("returns to the login screen after a successful logout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(sessionPayload({authenticated: true, username: "operator", expires_at: "2026-10-18T08:00:00+02:00"})))
      .mockResolvedValueOnce(jsonResponse(sessionPayload()));
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("miscuentas.session.transactions.saved-views.v1", "private filter criteria");
    renderGate();
    await screen.findByText("Datos financieros privados");

    fireEvent.click(screen.getByRole("button", {name: "Salir"}));

    await screen.findByRole("heading", {name: "Inicia sesión"});
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/logout/");
    expect(window.localStorage.getItem("miscuentas.session.transactions.saved-views.v1")).toBeNull();
  });
});
