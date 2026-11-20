import {useCallback, useEffect, useRef, useState} from "react";

const formSnapshot = (form: HTMLFormElement) => Array.from(form.elements)
  .filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement,
  )
  .map((element, index) => {
    const identity = element.name || `${element.tagName}:${index}`;
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) return `${identity}=${element.checked}`;
    return `${identity}=${element.value}`;
  })
  .join("\u001f");

function useDirtyFormState() {
  const [hasDirtyForm, setHasDirtyForm] = useState(false);

  useEffect(() => {
    const baselines = new WeakMap<HTMLFormElement, string>();
    const trackedForms = new Set<HTMLFormElement>();
    let syncTimer: number | null = null;
    const sync = () => {
      for (const form of trackedForms) {
        if (!form.isConnected) trackedForms.delete(form);
      }
      setHasDirtyForm([...trackedForms].some((form) => baselines.get(form) !== formSnapshot(form)));
    };
    const scheduleSync = () => {
      if (syncTimer !== null) return;
      syncTimer = window.setTimeout(() => {
        syncTimer = null;
        sync();
      }, 0);
    };
    const track = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const form = target.closest("form");
      if (!form) return;
      if (!baselines.has(form)) baselines.set(form, formSnapshot(form));
      trackedForms.add(form);
      scheduleSync();
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {childList: true, subtree: true});
    document.addEventListener("pointerdown", track, true);
    document.addEventListener("focusin", track, true);
    document.addEventListener("input", track, true);
    document.addEventListener("change", track, true);
    return () => {
      if (syncTimer !== null) window.clearTimeout(syncTimer);
      observer.disconnect();
      document.removeEventListener("pointerdown", track, true);
      document.removeEventListener("focusin", track, true);
      document.removeEventListener("input", track, true);
      document.removeEventListener("change", track, true);
    };
  }, []);

  return hasDirtyForm;
}

export function usePwaUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const hasDirtyForm = useDirtyFormState();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || window.location.port === "5173") return;
    const serviceWorker = navigator.serviceWorker;
    let disposed = false;
    const onControllerChange = () => {
      if (applyingRef.current) window.location.reload();
    };
    const observeRegistration = (next: ServiceWorkerRegistration) => {
      const showUpdateWhenReady = () => {
        const worker = next.installing;
        if (!worker) return;
        const onStateChange = () => {
          if (!disposed && worker.state === "installed" && serviceWorker.controller) setRegistration(next);
        };
        worker.addEventListener("statechange", onStateChange);
      };
      next.addEventListener("updatefound", showUpdateWhenReady);
      if (next.waiting && serviceWorker.controller) setRegistration(next);
      return () => next.removeEventListener("updatefound", showUpdateWhenReady);
    };
    let stopObserving: () => void = () => {};
    serviceWorker.addEventListener("controllerchange", onControllerChange);
    serviceWorker.register("/sw.js")
      .then((next) => { if (!disposed) stopObserving = observeRegistration(next); })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stopObserving();
      serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (hasDirtyForm || !registration?.waiting) return;
    applyingRef.current = true;
    setApplying(true);
    registration.waiting.postMessage({type: "SKIP_WAITING"});
  }, [hasDirtyForm, registration]);

  return {
    applying,
    applyUpdate,
    hasDirtyForm,
    updateAvailable: Boolean(registration?.waiting),
  };
}
