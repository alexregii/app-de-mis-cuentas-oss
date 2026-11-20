let csrfToken = "";
const API_CACHE_PREFIX = "miscuentas.api.";
const SESSION_DATA_PREFIX = "miscuentas.session.";
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const PREFETCH_TTL_MS = 5 * 1000;
const APP_SHELL_CACHE_PREFIX = "mis-cuentas-shell-";
export const AUTH_INVALIDATED_EVENT = "miscuentas:auth-invalidated";
const prefetchedGets = new Map<string, {promise: Promise<unknown>; expiresAt: number}>();
let cacheEpoch = 0;
const CACHEABLE_GETS = [
  "/api/bootstrap/",
  "/api/options/",
  "/api/accounts/",
  "/api/bank-review/",
  "/api/statistics/",
  "/api/planning/",
  "/api/imports/",
  "/api/settings/savings-goal/",
  "/api/settings/automation/",
  "/api/transactions/",
];

const cachePolicyFor = (path: string) => {
  if (path.startsWith("/api/options/")) return {endpointVersion: 1, ttlMs: 7 * 24 * 60 * 60 * 1000};
  if (path.startsWith("/api/planning/")) return {endpointVersion: 2, ttlMs: DEFAULT_CACHE_TTL_MS};
  if (path.startsWith("/api/transactions/") || path.startsWith("/api/statistics/") || path.startsWith("/api/bank-review/") || path.startsWith("/api/imports/")) {
    return {endpointVersion: 1, ttlMs: 5 * 60 * 1000};
  }
  return {endpointVersion: 1, ttlMs: DEFAULT_CACHE_TTL_MS};
};

export const setCsrfToken = (value: string) => {
  csrfToken = value;
};

const readCookie = (name: string) => {
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : "";
};

export const readCsrfCookie = (mobileReviewPreview: boolean) => (
  readCookie(mobileReviewPreview ? "mobile_review_csrftoken" : "csrftoken")
);

const mobileReviewPreview = import.meta.env.VITE_MOBILE_REVIEW_PREVIEW === "true";

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string[]>;
  code?: string;
  payload?: unknown;

  constructor(message: string, status: number, errors?: Record<string, string[]>, code?: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.code = code;
    this.payload = payload;
  }
}

const isCacheableGet = (path: string, method: string) =>
  method === "GET" && CACHEABLE_GETS.some((item) => path.startsWith(item));

const cacheKey = (path: string) => `${API_CACHE_PREFIX}${path}`;

export type CachedPayload<T> = {
  payload: T;
  cachedAt: string;
  schemaVersion: number;
  endpointVersion: number;
  stale: boolean;
};

type StoredCachedPayload<T> = Omit<CachedPayload<T>, "stale">;

const readCachedPayload = <T>(path: string): CachedPayload<T> | null => {
  try {
    const raw = window.localStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCachedPayload<T>> | null;
    if (!parsed || typeof parsed !== "object" || !("payload" in parsed) || typeof parsed.cachedAt !== "string") return null;
    const cachedAt = Date.parse(parsed.cachedAt);
    const policy = cachePolicyFor(path);
    const isCompatible = !Number.isNaN(cachedAt)
      && parsed.schemaVersion === CACHE_SCHEMA_VERSION
      && parsed.endpointVersion === policy.endpointVersion;
    if (!isCompatible) {
      window.localStorage.removeItem(cacheKey(path));
      return null;
    }
    return {
      payload: parsed.payload as T,
      cachedAt: parsed.cachedAt,
      schemaVersion: CACHE_SCHEMA_VERSION,
      endpointVersion: policy.endpointVersion,
      stale: Date.now() - cachedAt > policy.ttlMs,
    };
  } catch {
    return null;
  }
};

export const readCachedGet = <T>(path: string): CachedPayload<T> | null =>
  isCacheableGet(path, "GET") ? readCachedPayload<T>(path) : null;

const clearPrefetchedGet = (path: string) => prefetchedGets.delete(path);

const writeCachedPayload = (path: string, payload: unknown) => {
  try {
    window.localStorage.setItem(cacheKey(path), JSON.stringify({
      payload,
      cachedAt: new Date().toISOString(),
      schemaVersion: CACHE_SCHEMA_VERSION,
      endpointVersion: cachePolicyFor(path).endpointVersion,
    }));
  } catch {
    // Cache is best-effort; storage pressure should never break finance actions.
  }
};

const clearCachedPayloads = () => {
  cacheEpoch += 1;
  prefetchedGets.clear();
  try {
    const keys = Array.from({length: window.localStorage.length}, (_, index) => window.localStorage.key(index));
    keys.forEach((key) => {
      if (key?.startsWith(API_CACHE_PREFIX)) window.localStorage.removeItem(key);
    });
  } catch {
    // Cache invalidation is best-effort and must not break a successful mutation.
  }
};

export const clearOfflineData = async () => {
  clearCachedPayloads();
  try {
    const keys = Array.from({length: window.localStorage.length}, (_, index) => window.localStorage.key(index));
    keys.forEach((key) => {
      if (key?.startsWith(SESSION_DATA_PREFIX)) window.localStorage.removeItem(key);
    });
  } catch {
    // Session-scoped client state is best-effort; the server session remains authoritative.
  }
  try {
    const cacheNames = await window.caches?.keys();
    await Promise.all(cacheNames?.filter((name) => name.startsWith(APP_SHELL_CACHE_PREFIX)).map((name) => window.caches.delete(name)) ?? []);
  } catch {
    // Cache Storage may be unavailable in private browsing or older browsers.
  }
};

const dispatchOfflineCacheUse = (path: string, cached: CachedPayload<unknown>) => {
  window.dispatchEvent(new CustomEvent("miscuentas:offline-cache", {
    detail: {path, cachedAt: cached.cachedAt, stale: cached.stale},
  }));
};

type ApiCacheMode = "default" | "reload" | "no-store";

const requestFresh = async <T>(path: string, init: RequestInit = {}, cacheMode: ApiCacheMode = "default", shouldCache?: (payload: T) => boolean): Promise<T> => {
  const requestCacheEpoch = cacheEpoch;
  const headers = new Headers(init.headers);
  const body = init.body;
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const method = (init.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRFToken", readCsrfCookie(mobileReviewPreview) || csrfToken);

  const cacheableGet = isCacheableGet(path, method);
  const canUseCache = cacheableGet && cacheMode === "default";
  const response = await fetch(path, {...init, headers, credentials: "same-origin"}).catch((exc) => {
    if (canUseCache && requestCacheEpoch === cacheEpoch) {
      const cached = readCachedPayload<T>(path);
      if (cached) {
        dispatchOfflineCacheUse(path, cached);
        return cached.payload;
      }
    }
    throw exc;
  });
  if (!(response instanceof Response)) return response;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && requestCacheEpoch === cacheEpoch && !["/api/auth/login/", "/api/auth/session/"].includes(path)) {
      clearCachedPayloads();
      window.dispatchEvent(new CustomEvent(AUTH_INVALIDATED_EVENT));
    }
    if (canUseCache && response.status >= 500 && requestCacheEpoch === cacheEpoch) {
      const cached = readCachedPayload<T>(path);
      if (cached) {
        dispatchOfflineCacheUse(path, cached);
        return cached.payload;
      }
    }
    throw new ApiError(
      payload?.error || "No se pudo completar la operación. Revisa los datos e inténtalo otra vez.",
      response.status,
      payload?.errors,
      typeof payload?.code === "string" ? payload.code : undefined,
      payload,
    );
  }
  if (cacheableGet && cacheMode !== "no-store" && requestCacheEpoch === cacheEpoch && (shouldCache?.(payload as T) ?? true)) writeCachedPayload(path, payload);
  else if (!["GET", "HEAD", "OPTIONS"].includes(method)) clearCachedPayloads();
  return payload as T;
};

export const request = <T>(path: string, init: RequestInit = {}, shouldCache?: (payload: T) => boolean): Promise<T> => {
  const method = (init.method || "GET").toUpperCase();
  const cacheMode: ApiCacheMode = method !== "GET" ? "default" : init.cache === "reload" ? "reload" : init.cache === "no-store" ? "no-store" : "default";
  if (method === "GET" && cacheMode !== "default") clearPrefetchedGet(path);
  if (method === "GET" && cacheMode === "default") {
    const prefetched = prefetchedGets.get(path);
    if (prefetched && (prefetched.expiresAt === 0 || prefetched.expiresAt > Date.now())) {
      return prefetched.promise as Promise<T>;
    }
    if (prefetched) prefetchedGets.delete(path);
  }
  return requestFresh<T>(path, init, cacheMode, shouldCache);
};

export const prefetchGet = <T>(path: string): Promise<T> => {
  if (!isCacheableGet(path, "GET")) return Promise.reject(new Error("La ruta no admite precarga GET."));
  const existing = prefetchedGets.get(path);
  if (existing && (existing.expiresAt === 0 || existing.expiresAt > Date.now())) return existing.promise as Promise<T>;
  if (existing) prefetchedGets.delete(path);

  const entry: {promise: Promise<unknown>; expiresAt: number} = {promise: Promise.resolve(null), expiresAt: 0};
  const promise = requestFresh<T>(path, {}, "default", () => prefetchedGets.get(path) === entry)
    .then((payload) => {
      if (prefetchedGets.get(path) === entry) entry.expiresAt = Date.now() + PREFETCH_TTL_MS;
      return payload;
    })
    .catch((error: unknown) => {
      if (prefetchedGets.get(path) === entry) prefetchedGets.delete(path);
      throw error;
    });
  entry.promise = promise;
  prefetchedGets.set(path, entry);
  return promise;
};

export const hasFreshPrefetchedGet = (path: string): boolean => {
  const entry = prefetchedGets.get(path);
  return Boolean(entry && entry.expiresAt > Date.now());
};

export const jsonBody = (input: unknown) => JSON.stringify(input);
