import {useEffect} from "react";
import {errorMessage} from "../../shared/lib/errors";

export function useUnhandledAppError(reportError: (message: string) => void) {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!(event.reason instanceof Error)) return;
      event.preventDefault();
      reportError(errorMessage(event.reason, "No se pudo completar la operación."));
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }, [reportError]);
}
