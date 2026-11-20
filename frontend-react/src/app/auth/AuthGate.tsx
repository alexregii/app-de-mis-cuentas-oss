import {useCallback, useEffect, useRef, useState, type ReactNode} from "react";
import {ApiError, AUTH_INVALIDATED_EVENT, clearOfflineData} from "../../shared/api/client";
import {authApi} from "./api";
import {LoginScreen} from "./LoginScreen";

const LOGOUT_STORAGE_KEY = "miscuentas.auth.logout_at";
const AUTHENTICATED_STORAGE_KEY = "miscuentas.auth.was_authenticated";

const setAuthenticatedMarker = (authenticated: boolean) => {
  try {
    if (authenticated) window.localStorage.setItem(AUTHENTICATED_STORAGE_KEY, "true");
    else window.localStorage.removeItem(AUTHENTICATED_STORAGE_KEY);
  } catch { /* the server session remains authoritative */ }
};

const hadAuthenticatedSession = () => {
  try { return window.localStorage.getItem(AUTHENTICATED_STORAGE_KEY) === "true"; } catch { return false; }
};

const clearLogoutMarker = () => {
  try { window.localStorage.removeItem(LOGOUT_STORAGE_KEY); } catch { /* local auth state remains fail-closed */ }
};

type GateState =
  | {status: "checking"}
  | {status: "unavailable"}
  | {status: "anonymous"; message: string}
  | {status: "authenticated"; expiresAt: string | null};

export function AuthGate({children}: {children: (logout: () => Promise<void>) => ReactNode}) {
  const [gate, setGate] = useState<GateState>({status: "checking"});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const authGeneration = useRef(0);

  const markAnonymous = useCallback((message: string, broadcast = true) => {
    authGeneration.current += 1;
    if (broadcast) {
      try { window.localStorage.setItem(LOGOUT_STORAGE_KEY, String(Date.now())); } catch { /* best-effort cross-tab signal */ }
    }
    setAuthenticatedMarker(false);
    void clearOfflineData();
    setBusy(false);
    setError(message);
    setGate({status: "anonymous", message});
  }, []);

  const checkSession = useCallback(async () => {
    const generation = ++authGeneration.current;
    setGate({status: "checking"});
    setError("");
    try {
      const session = await authApi.session();
      if (generation !== authGeneration.current) return;
      if (session.required && !session.authenticated) {
        markAnonymous(hadAuthenticatedSession() ? "Tu sesión ha caducado. Inicia sesión para volver a la misma vista." : "", false);
        return;
      }
      setAuthenticatedMarker(session.authenticated);
      clearLogoutMarker();
      setGate({status: "authenticated", expiresAt: session.expires_at});
    } catch {
      if (generation !== authGeneration.current) return;
      setGate({status: "unavailable"});
      setError("No se pudo comprobar la sesión. Conéctate al servidor y vuelve a intentarlo.");
    }
  }, [markAnonymous]);

  useEffect(() => { void checkSession(); }, [checkSession]);

  useEffect(() => {
    const onInvalidated = () => markAnonymous("La sesión ha caducado. Inicia sesión para volver a la misma vista.");
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOGOUT_STORAGE_KEY && event.newValue) {
        markAnonymous("La sesión se cerró en otra pestaña. Inicia sesión para continuar.", false);
      }
    };
    window.addEventListener(AUTH_INVALIDATED_EVENT, onInvalidated);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTH_INVALIDATED_EVENT, onInvalidated);
      window.removeEventListener("storage", onStorage);
    };
  }, [markAnonymous]);

  useEffect(() => {
    if (gate.status !== "authenticated" || !gate.expiresAt) return;
    const delay = Date.parse(gate.expiresAt) - Date.now();
    const timer = window.setTimeout(
      () => markAnonymous("La sesión ha caducado. Inicia sesión para volver a la misma vista."),
      Math.max(0, Math.min(delay, 2_147_000_000)),
    );
    return () => window.clearTimeout(timer);
  }, [gate, markAnonymous]);

  const login = async (username: string, password: string) => {
    const generation = ++authGeneration.current;
    setBusy(true);
    setError("");
    try {
      const session = await authApi.login(username, password);
      if (generation !== authGeneration.current) return;
      await clearOfflineData();
      if (generation !== authGeneration.current) return;
      clearLogoutMarker();
      setAuthenticatedMarker(session.authenticated);
      setGate({status: "authenticated", expiresAt: session.expires_at});
    } catch (reason) {
      if (generation !== authGeneration.current) return;
      setError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión.");
    } finally {
      if (generation === authGeneration.current) setBusy(false);
    }
  };

  const logout = async () => {
    const generation = ++authGeneration.current;
    try {
      await authApi.logout();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      throw reason;
    }
    if (generation === authGeneration.current) markAnonymous("");
  };

  if (gate.status === "checking") {
    return <main className="auth-screen" aria-busy="true"><p role="status">Comprobando la sesión…</p></main>;
  }

  if (gate.status === "unavailable" || gate.status === "anonymous") {
    return (
      <LoginScreen
        busy={busy}
        error={error || (gate.status === "anonymous" ? gate.message : "")}
        unavailable={gate.status === "unavailable"}
        onLogin={(username, password) => { void login(username, password); }}
        onRetry={() => { void checkSession(); }}
      />
    );
  }

  return <>{children(logout)}</>;
}
