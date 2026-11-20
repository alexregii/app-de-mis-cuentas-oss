import {useCallback, useEffect, useState} from "react";
import {formatDateTimeShort} from "../../format";

export function useOfflineStatus() {
  const [message, setMessage] = useState("");
  const clear = useCallback(() => setMessage(""), []);

  useEffect(() => {
    const onOfflineCache = (event: Event) => {
      const cacheDetail = (event as CustomEvent<{cachedAt?: string; stale?: boolean}>).detail;
      const cachedAt = cacheDetail?.cachedAt;
      const cachedDate = cachedAt ? new Date(cachedAt) : null;
      const dateDetail = cachedDate && Number.isFinite(cachedDate.getTime())
        ? ` del ${formatDateTimeShort(cachedDate)}`
        : "";
      setMessage(`Sin conexión. Mostrando datos guardados${dateDetail}${cacheDetail?.stale ? "; podrían no estar actualizados" : ""}.`);
    };
    const onOffline = () => setMessage("Sin conexión. Puedes consultar datos recientes guardados en este dispositivo.");
    const onOnline = () => setMessage("");
    window.addEventListener("miscuentas:offline-cache", onOfflineCache);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (!navigator.onLine) onOffline();
    return () => {
      window.removeEventListener("miscuentas:offline-cache", onOfflineCache);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return {message, clear};
}
