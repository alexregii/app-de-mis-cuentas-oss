import {useEffect, useId, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Button} from "../../ui/controls/Button";
import {wrapTabFocus} from "../../ui/controls/wrapTabFocus";
import {errorMessage} from "../lib/errors";

const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// A destructive confirmation may remove its opener; try nearby controls before the page fallback.
function focusFallbacksFrom(element: HTMLElement | null) {
  const candidates: HTMLElement[] = [];
  let current = element;
  while (current?.parentElement) {
    const parent = current.parentElement;
    const siblings = Array.from(parent.children) as HTMLElement[];
    const index = siblings.indexOf(current);
    candidates.push(...siblings.slice(index + 1), ...siblings.slice(0, index).reverse());
    // Recheck surviving semantic containers after a mutation can replace a row
    // with a new empty-state action that did not exist when the dialog opened.
    if (parent !== document.body && parent !== document.documentElement) candidates.push(parent);
    current = parent;
  }
  return candidates;
}

function firstFocusable(element: HTMLElement) {
  const candidates = element.matches(focusableSelector)
    ? [element, ...Array.from(element.querySelectorAll<HTMLElement>(focusableSelector))]
    : Array.from(element.querySelectorAll<HTMLElement>(focusableSelector));
  return candidates.find((candidate) => {
    if (!candidate.isConnected || candidate.matches(":disabled, [aria-disabled='true']") || candidate.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    const style = window.getComputedStyle(candidate);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }) || null;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  returnFocusTarget,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  returnFocusTarget?: () => HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusFallbacksRef = useRef<HTMLElement[]>([]);
  const returnFocusTargetRef = useRef(returnFocusTarget);
  const focusCaptureCompleteRef = useRef(false);
  const onCancelRef = useRef(onCancel);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  returnFocusTargetRef.current = returnFocusTarget;

  useLayoutEffect(() => {
    if (!focusCaptureCompleteRef.current) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      returnFocusFallbacksRef.current = focusFallbacksFrom(returnFocusRef.current);
      focusCaptureCompleteRef.current = true;
    }
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>("[data-confirm-cancel]")?.focus({preventScroll: true});
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!submittingRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      wrapTabFocus(event, focusable, true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Let same-commit removals settle before choosing a surviving focus target.
      queueMicrotask(() => {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        const preferredTarget = returnFocusTargetRef.current?.();
        const preferred = preferredTarget ? firstFocusable(preferredTarget) : null;
        if (preferred) {
          preferred.focus({preventScroll: true});
          return;
        }
        const opener = returnFocusRef.current;
        const target = opener ? firstFocusable(opener) : null;
        if (target) {
          target.focus({preventScroll: true});
          return;
        }
        for (const candidate of returnFocusFallbacksRef.current) {
          const fallback = firstFocusable(candidate);
          if (!fallback) continue;
          fallback.focus({preventScroll: true});
          return;
        }
        document.getElementById("main-content")?.focus({preventScroll: true});
      });
    };
  }, []);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const confirm = async () => {
    if (submittingRef.current) return;
    setError("");
    submittingRef.current = true;
    setSubmitting(true);
    let succeeded = false;
    try {
      await onConfirm();
      succeeded = true;
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo completar la acción. Inténtalo de nuevo."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    if (succeeded) onCancel();
  };

  return createPortal(
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submittingRef.current) onCancel();
    }}>
      <div ref={dialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className="confirm-dialog-copy">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
        {error ? <p className="confirm-dialog-error" role="alert">{error}</p> : null}
        <div className="confirm-dialog-actions">
          <Button data-confirm-cancel variant="secondary" disabled={submitting} onClick={onCancel}>Cancelar</Button>
          <Button variant="danger" aria-disabled={submitting || undefined} aria-busy={submitting || undefined} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); void confirm();}}>{submitting ? "Aplicando…" : confirmLabel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
