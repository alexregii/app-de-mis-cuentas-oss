import {useCallback, useEffect, useRef, useState} from "react";
import {importsApi} from "../../shared/api/imports";
import type {ImportPayload} from "../../shared/model/imports";

export function useSettingsData(enabled = true) {
  const [imports, setImports] = useState<ImportPayload | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [reloadToken, setReloadToken] = useState(0);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError("");
    try {
      const payload = await importsApi.imports();
      if (requestId === latestRequest.current) setImports(payload);
    } catch (reason) {
      if (requestId === latestRequest.current) throw reason;
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudieron cargar los perfiles CSV."));
  }, [enabled, load, reloadToken]);

  return {imports, status, setStatus, error, loading, load, retry: () => setReloadToken((value) => value + 1)};
}
