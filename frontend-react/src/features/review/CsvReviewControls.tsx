import {useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction} from "react";
import {motion} from "motion/react";
import type {CsvReviewActionRequest, PreparedReview, ReviewDraft} from "./adapters/reviewAdapterTypes";
import {Button} from "../../ui/controls/Button";
import {FormField, Input} from "../../ui/controls/FormField";

export function useCsvDisclosureAnchor(expanded: boolean, toggle: () => void) {
  const anchorRef = useRef<{element: HTMLElement; top: number} | null>(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    let active = true;
    let frame = 0;
    const timers: number[] = [];
    const cancel = () => {
      if (!active) return;
      active = false;
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("wheel", cancelOnUserScroll);
      window.removeEventListener("touchstart", cancelOnUserScroll);
      window.removeEventListener("pointerdown", cancelOnUserScroll);
      document.removeEventListener("focusin", cancelOnFocusChange);
    };
    const cancelOnFocusChange = () => {
      if (document.activeElement !== anchor.element) cancel();
    };
    const restore = () => {
      if (!active) return;
      if (!anchor.element.isConnected || document.activeElement !== anchor.element) return cancel();
      const drift = anchor.element.getBoundingClientRect().top - anchor.top;
      if (Math.abs(drift) > 0.5) window.scrollTo({top: Math.max(0, window.scrollY + drift), behavior: "instant"});
    };
    const cancelOnUserScroll = () => cancel();
    window.addEventListener("wheel", cancelOnUserScroll, {passive: true});
    window.addEventListener("touchstart", cancelOnUserScroll, {passive: true});
    window.addEventListener("pointerdown", cancelOnUserScroll, {passive: true});
    frame = window.requestAnimationFrame(restore);
    [50, 150, 300, 600, 1000].forEach((delay) => timers.push(window.setTimeout(restore, delay)));
    return cancel;
  }, [expanded]);
  return (element: HTMLButtonElement) => {
    element.focus({preventScroll: true});
    anchorRef.current = {element, top: element.getBoundingClientRect().top};
    toggle();
  };
}

export function useCsvExitScrollAnchor(detailRef: {current: HTMLDivElement | null}, exitCount: number, entryCount: number, setMinHeight: Dispatch<SetStateAction<number | undefined>>, minHeight: number | undefined, resetKey: string) {
  const viewportRef = useRef<{scrollY: number; documentHeight: number; detailTop: number | null} | null>(null);
  useEffect(() => {
    viewportRef.current = null;
  }, [resetKey]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || entryCount || exitCount) return;
    const timer = window.setTimeout(() => {
      const missingHeight = Math.max(0, viewport.documentHeight - document.documentElement.scrollHeight);
      if (missingHeight > 0.5) {
        setMinHeight((current) => (current || 0) + missingHeight);
        return;
      }
      viewportRef.current = null;
      const detailTop = detailRef.current?.getBoundingClientRect().top;
      if (detailTop !== undefined && viewport.detailTop !== null) {
        const drift = detailTop - viewport.detailTop;
        if (Math.abs(drift) > 0.5) window.scrollTo({top: Math.max(0, window.scrollY + drift), behavior: "instant"});
      } else if (Math.abs(window.scrollY - viewport.scrollY) > 0.5) {
        window.scrollTo({top: viewport.scrollY, behavior: "instant"});
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [entryCount, exitCount, minHeight, setMinHeight]);
  return () => {
    const detail = detailRef.current;
    const detailTop = detail?.getBoundingClientRect().top ?? null;
    setMinHeight(detail?.getBoundingClientRect().height || undefined);
    viewportRef.current = {scrollY: window.scrollY, documentHeight: document.documentElement.scrollHeight, detailTop};
  };
}

export function CsvReviewDetails({prepared, onDraftChange, disabled}: {prepared: PreparedReview; onDraftChange: (field: keyof ReviewDraft, value: string) => void; disabled: boolean}) {
  return <div className="prepared-review-details">
    {prepared.preservedRefundDescription ? <p className="prepared-review-suggestion">
      <strong>Reembolso vinculado</strong> Gasto asociado: {prepared.preservedRefundDescription}.
    </p> : null}
    {prepared.preservedAllocationLabels?.length ? <p className="prepared-review-suggestion">
      <strong>Reparto existente</strong> Al reconfirmar se conservarán estas categorías: {prepared.preservedAllocationLabels.join(", ")}.
    </p> : null}
    {prepared.capabilities.canPersistStandaloneEdit ? <div className="entry-form compact-entry-form">
      <FormField label="Nueva categoría">
        <Input type="text" value={prepared.draft.new_category} onChange={(event) => onDraftChange("new_category", event.target.value)} placeholder="Ej. Compras personales" disabled={disabled} />
      </FormField>
      <FormField label="Subcategoría">
        <Input type="text" value={prepared.draft.new_subcategory} onChange={(event) => onDraftChange("new_subcategory", event.target.value)} placeholder="Opcional" disabled={disabled} />
      </FormField>
    </div> : null}
  </div>;
}

export function CsvReviewActions({prepared, onRun, disabled}: {prepared: PreparedReview; onRun: (input: CsvReviewActionRequest) => Promise<boolean>; disabled: boolean}) {
  const [busy, setBusy] = useState(false);
  const confirm = prepared.actions.confirm?.source === "csv" ? prepared.actions.confirm : undefined;
  const force = prepared.actions.force?.source === "csv" ? prepared.actions.force : undefined;
  const category = prepared.actions.category?.source === "csv" ? prepared.actions.category : undefined;
  const run = (input: CsvReviewActionRequest, trigger: HTMLButtonElement) => {
    if (busy || disabled) return;
    if (document.activeElement !== trigger) trigger.focus({preventScroll: true});
    setBusy(true);
    void onRun(input).finally(() => setBusy(false));
  };
  const actionUnavailable = busy || disabled || undefined;
  return <>
    {confirm ? <Button variant="primary" aria-disabled={actionUnavailable} aria-busy={busy || undefined} onClick={(event) => run({action: "confirm", input: {...confirm.input}}, event.currentTarget)}>{prepared.preservedAllocationLabels?.length ? "Reconfirmar reparto" : "Importar"}</Button> : null}
    {force ? <Button variant="primary" aria-disabled={actionUnavailable} aria-busy={busy || undefined} onClick={(event) => run({action: "force", input: {...force.input}}, event.currentTarget)}>{prepared.preservedAllocationLabels?.length ? "Reconfirmar reparto igualmente" : "Importar igualmente"}</Button> : null}
    {category ? <Button variant="secondary" aria-disabled={actionUnavailable} aria-busy={busy || undefined} onClick={(event) => run({action: "category", input: {...category.input}}, event.currentTarget)}>Guardar categoría</Button> : null}
    {prepared.actions.skip?.source === "csv" ? <Button variant="secondary" aria-disabled={actionUnavailable} aria-busy={busy || undefined} onClick={(event) => run({action: "skip", input: {}}, event.currentTarget)}>Omitir</Button> : null}
  </>;
}

type Feedback = Readonly<{kind: "status" | "error"; message: string}>;

export function CsvReviewActionFeedback({feedback, reduceMotion}: {feedback: Feedback | null; reduceMotion: boolean}) {
  return <div className="csv-review-action-feedback-slot">
    {feedback ? <motion.div
      className={`message ${feedback.kind === "error" ? "error" : "success"}`}
      role={feedback.kind === "error" ? "alert" : "status"}
      aria-atomic="true"
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      transition={{duration: reduceMotion ? 0 : 0.16}}
    >{feedback.message}</motion.div> : null}
  </div>;
}
