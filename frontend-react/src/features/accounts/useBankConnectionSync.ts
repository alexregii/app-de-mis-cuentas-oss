import {useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction} from "react";
import {bankingApi} from "../../shared/api/banking";
import type {Connection} from "../../shared/model/accounts";

export function useBankConnectionSync({connections, refresh, setStatus, status}: {
  connections: Connection[];
  refresh: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
  status: string;
}) {
  const [syncingIds, setSyncingIds] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const requests = useRef(new Set<number>());
  const anchors = useRef(new Map<number, {element: HTMLElement; top: number}>());

  useLayoutEffect(() => {
    for (const [id, anchor] of anchors.current) {
      if (anchor.element.isConnected) {
        const offset = anchor.element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(offset) > 0.5) window.scrollBy(0, offset);
      }
      const backgroundSyncing = connections.some((connection) => connection.id === id && connection.sync_status === "syncing");
      if (!syncingIds.includes(id) && !backgroundSyncing) anchors.current.delete(id);
    }
  }, [connections, errors, status, syncingIds]);

  const sync = async (connection: Connection, trigger: HTMLElement) => {
    const {id} = connection;
    if (requests.current.has(id) || connection.sync_status === "syncing") return;
    requests.current.add(id);
    anchors.current.set(id, {element: trigger, top: trigger.getBoundingClientRect().top});
    setSyncingIds((current) => current.includes(id) ? current : [...current, id]);
    setErrors((current) => {
      if (!(id in current)) return current;
      const next = {...current};
      delete next[id];
      return next;
    });
    try {
      await bankingApi.syncBank(id);
      setStatus("Sincronización solicitada.");
      try {
        await refresh();
      } catch (reason) {
        setErrors((current) => ({...current, [id]: `Sincronización solicitada, pero no se pudo actualizar Cuentas: ${reason instanceof Error ? reason.message : "inténtalo otra vez."}`}));
      }
    } catch (reason) {
      setErrors((current) => ({...current, [id]: reason instanceof Error ? reason.message : "No se pudo sincronizar la cuenta."}));
    } finally {
      requests.current.delete(id);
      setSyncingIds((current) => current.filter((item) => item !== id));
    }
  };

  const isSyncing = (connection: Connection) => syncingIds.includes(connection.id) || connection.sync_status === "syncing";
  return {errors, isSyncing, sync};
}
