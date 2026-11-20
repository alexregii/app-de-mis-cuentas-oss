import {useLayoutEffect, useRef} from "react";
import type {Connection} from "../../shared/model/accounts";

export function useBankConnectionRemovalAnchor(connections: Connection[]) {
  const anchorRef = useRef<{connectionId: number; element: HTMLElement; top: number} | null>(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || connections.some((connection) => connection.id === anchor.connectionId)) return;
    window.requestAnimationFrame(() => {
      if (anchorRef.current !== anchor) return;
      if (anchor.element.isConnected) {
        const offset = anchor.element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(offset) > 0.5) window.scrollBy(0, offset);
      }
      anchorRef.current = null;
    });
  }, [connections]);

  return (connectionId: number) => {
    const element = document.getElementById("bank-connections");
    const anchor = element ? {connectionId, element, top: element.getBoundingClientRect().top} : null;
    anchorRef.current = anchor;
    return () => {
      if (anchorRef.current === anchor) anchorRef.current = null;
    };
  };
}
