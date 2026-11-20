import {useCallback, useEffect, useRef, useState} from "react";
import {bootstrapApi} from "../bootstrapApi";
import {readCachedGet, setCsrfToken} from "../../shared/api/client";
import type {BootstrapPayload, OptionsPayload} from "../../shared/model/bootstrap";
import type {AppBootstrapState} from "../contracts";

export interface AppBootstrapController extends AppBootstrapState {
  clearError: () => void;
  reportError: (message: string) => void;
}

const cachedBootstrap = () => {
  const cached = readCachedGet<BootstrapPayload>("/api/bootstrap/");
  const payload = cached?.payload;
  return payload
    && typeof payload.csrf_token === "string"
    && payload.metrics
    && payload.review
    && Array.isArray(payload.accounts)
    && Array.isArray(payload.categories)
    && Array.isArray(payload.recent)
    && payload.dashboard
    ? payload
    : null;
};

export function useAppBootstrap(onReloadStart?: () => void): AppBootstrapController {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(cachedBootstrap);
  const [options, setOptions] = useState<OptionsPayload | null>(null);
  const bootstrapRequest = useRef<Promise<BootstrapPayload> | null>(null);
  const optionsRequest = useRef<Promise<OptionsPayload> | null>(null);
  const optionsRef = useRef<OptionsPayload | null>(null);
  const [error, setError] = useState("");
  const clearError = useCallback(() => setError(""), []);
  const reportError = useCallback((message: string) => setError(message), []);

  const fetchBootstrap = useCallback(() => {
    if (!bootstrapRequest.current) {
      bootstrapRequest.current = bootstrapApi.bootstrap()
        .finally(() => { bootstrapRequest.current = null; });
    }
    return bootstrapRequest.current;
  }, []);

  const fetchOptions = useCallback(() => {
    if (!optionsRequest.current) {
      optionsRequest.current = bootstrapApi.options()
        .then((payload) => {
          optionsRef.current = payload;
          setOptions(payload);
          return payload;
        })
        .finally(() => { optionsRequest.current = null; });
    }
    return optionsRequest.current;
  }, []);

  const reload = useCallback(async () => {
    onReloadStart?.();
    const bootstrapPayload = await fetchBootstrap();
    setCsrfToken(bootstrapPayload.csrf_token);
    setBootstrap(bootstrapPayload);
    if (optionsRef.current) await fetchOptions();
    else setOptions(null);
  }, [fetchBootstrap, fetchOptions, onReloadStart]);

  const ensureOptions = useCallback(() => {
    if (options) return Promise.resolve(options);
    return fetchOptions();
  }, [fetchOptions, options]);

  useEffect(() => {
    if (bootstrap) setCsrfToken(bootstrap.csrf_token);
    reload().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo cargar la app React."));
  }, [reload]);

  return {bootstrap, options, loading: !bootstrap, error, reload, ensureOptions, clearError, reportError};
}
