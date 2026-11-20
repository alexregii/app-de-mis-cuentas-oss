import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from "react";
import {formatDate} from "../../format";
import {reviewInlineDisplayValue} from "./reviewInlineFormatting";
import {TransactionAmount} from "./TransactionAmount";
import {TransactionCategory} from "./TransactionCategory";
import {TransactionIdentity} from "./TransactionIdentity";
import {TransactionMetadata} from "./TransactionMetadata";
import {TransactionStatus} from "./TransactionStatus";
import type {ReviewChange, ReviewDecision, ReviewHistory, ReviewIssue, ReviewItem, ReviewPreparation} from "./ReviewItem";
import {Button} from "../controls/Button";

const fieldLabels: Record<ReviewChange["field"], string> = {
  amount: "Importe",
  description: "Descripción",
  date: "Fecha",
  account: "Cuenta",
  category: "Categoría",
  kind: "Tipo",
  transfer_source_account: "Cuenta de origen",
  transfer_target_account: "Cuenta de destino",
};

function changeValue(field: ReviewChange["field"], value: unknown, privateAmounts: boolean) {
  if (value === null || value === undefined || value === "") return field === "category" ? "Sin categoría" : field.includes("account") ? "Sin cuenta" : "Sin dato";
  if (field === "amount" || (field === "date" && value)) return reviewInlineDisplayValue(field, value, privateAmounts);
  if (field === "date") return formatDate(String(value));
  if (typeof value === "object" && value !== null && "name" in value) return String(value.name);
  return String(value);
}

export function ReviewChanges({changes, privateAmounts = false}: {changes: readonly ReviewChange[]; privateAmounts?: boolean}) {
  const [expanded, setExpanded] = useState(false);
  if (!changes.length) return null;
  const summary = changes.map((change) => fieldLabels[change.field]).filter((label, index, labels) => labels.indexOf(label) === index).join(" · ");
  return <section className="ui-review-transaction-card__changes" aria-label="Cambios desde última sincronización">
    <div className="ui-review-transaction-card__changes-summary">
      <div><strong>{changes.length} {changes.length === 1 ? "cambio" : "cambios"}</strong><span>{summary}</span></div>
      <Button variant="secondary" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "Ocultar cambios" : "Ver cambios"}</Button>
    </div>
    {expanded ? <div className="ui-review-transaction-card__changes-detail">
      <h4>Cambios desde última sincronización</h4>
      <ul>{changes.map((change, index) => {
        const previous = changeValue(change.field, change.previous, privateAmounts);
        const current = changeValue(change.field, change.current, privateAmounts);
        return <li key={`${change.field}-${index}`}>
          <strong>{fieldLabels[change.field]}</strong>
          <span className="ui-review-transaction-card__change-values" aria-label={`${fieldLabels[change.field]}. Valor anterior: ${previous}. Valor actual: ${current}.`}>
            <span className="ui-review-transaction-card__change-value"><span className="sr-only">Valor anterior: </span><del>{previous}</del></span>
            <span className="ui-review-transaction-card__change-arrow" aria-hidden="true"> → </span>
            <span className="ui-review-transaction-card__change-value ui-review-transaction-card__change-value--current"><span className="sr-only">Valor actual: </span><span>{current}</span></span>
          </span>
        </li>;
      })}</ul>
    </div> : null}
  </section>;
}

type ReviewTransactionCardProps = {
  item: ReviewItem;
  privateAmounts?: boolean;
  inlineAmount?: ReactNode;
  inlineContent?: ReactNode;
  inlineIssues?: ReactNode;
  editing?: boolean;
  editor?: ReactNode;
  categoryEditor?: ReactNode;
  quickFix?: ReactNode;
  selectionControl?: ReactNode;
  decisionActions?: ReactNode;
  editLabel?: string;
  editButtonTone?: "primary" | "secondary";
  statusLabel?: string;
  preparationKey: ReviewPreparation;
  historyKey?: ReviewHistory;
  historyLabel?: string;
  reopened?: boolean;
  decisionKey?: ReviewDecision;
  decisionLabel?: string;
  /** Count already classified by the feature; it never infers blocking rules from issue codes. */
  blockingIssueCount?: number;
  attentionIssues?: readonly ReviewIssue[];
  suppressActions?: boolean;
  selected?: boolean;
  selectionMode?: boolean;
  onSelect?: () => void;
  exiting?: boolean;
  onExitComplete?: () => void;
  onEdit?: () => void;
  onCloseEdit?: () => void;
};

export function ReviewTransactionCard({
  item,
  privateAmounts = false,
  inlineAmount,
  inlineContent,
  inlineIssues,
  editing = false,
  editor,
  categoryEditor,
  quickFix,
  selectionControl,
  decisionActions,
  editLabel = "Editar datos",
  editButtonTone = "secondary",
  statusLabel,
  preparationKey,
  historyKey,
  historyLabel,
  reopened = false,
  decisionKey,
  decisionLabel,
  blockingIssueCount,
  attentionIssues = [],
  suppressActions = false,
  selected = false,
  selectionMode = false,
  onSelect,
  exiting = false,
  onExitComplete,
  onEdit,
  onCloseEdit,
}: ReviewTransactionCardProps) {
  const editorId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const exitNotified = useRef(false);
  const onExitCompleteRef = useRef(onExitComplete);
  onExitCompleteRef.current = onExitComplete;
  const inlineMode = Boolean(inlineContent);
  const editIsPrimary = !editing && editButtonTone === "primary";
  const blockingCount = blockingIssueCount ?? item.issues.length;
  const blockingSummary = blockingCount === 1 ? "Hay 1 problema que impide incorporar" : `Hay ${blockingCount} problemas que impiden incorporar`;
  const notifyExitComplete = useCallback(() => {
    const onComplete = onExitCompleteRef.current;
    if (exitNotified.current || !onComplete) return;
    exitNotified.current = true;
    onComplete();
  }, []);

  useEffect(() => {
    if (editing) {
      editorRef.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({preventScroll: true});
    } else if (wasEditing.current) {
      editButtonRef.current?.focus({preventScroll: true});
    }
    wasEditing.current = editing;
  }, [editing]);

  useEffect(() => {
    if (!exiting) {
      exitNotified.current = false;
      return;
    }
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !onExitCompleteRef.current || exitNotified.current) return;
    const frame = window.requestAnimationFrame(() => {
      notifyExitComplete();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exiting, notifyExitComplete]);

  useEffect(() => {
    if (!exiting || !onExitCompleteRef.current || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const fallback = window.setTimeout(notifyExitComplete, 280);
    return () => window.clearTimeout(fallback);
  }, [exiting, notifyExitComplete]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (exiting) {
      card.style.removeProperty("max-height");
      return;
    }
    const measure = () => { if (card.scrollHeight > 0) card.style.maxHeight = `${card.scrollHeight}px`; };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    // Observe content, not the card itself: measure() writes card.maxHeight and
    // self-observation can create a ResizeObserver feedback loop in WebKit.
    for (const child of card.children) observer.observe(child);
    return () => observer.disconnect();
  }, [editing, exiting, inlineAmount, inlineContent, inlineIssues]);

  return <article
    ref={cardRef}
    className={`ui-review-transaction-card ui-review-transaction-card--${item.status}${exiting ? " ui-review-transaction-card--exiting" : ""}`}
    data-review-item={item.id}
    data-review-state={item.status}
    data-review-preparation={preparationKey}
    data-review-history={historyKey}
    data-review-history-label={historyKey}
    data-review-reopened={reopened || undefined}
    data-review-decision={decisionKey}
    data-review-editing={editing}
    data-review-selected={selected || undefined}
    data-review-selection-mode={selectionMode || undefined}
    data-review-exiting={exiting || undefined}
    onClick={(event) => {
      if (!selectionMode || !onSelect) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest("button, input, select, textarea, a, label, [role=\"button\"], [role=\"combobox\"], [role=\"option\"], [role=\"listbox\"]")) return;
      onSelect();
    }}
    onTransitionEnd={(event) => {
      if (event.target === event.currentTarget && exiting && ["max-height", "block-size"].includes(event.propertyName)) notifyExitComplete();
    }}
  >
    <div className="ui-review-transaction-card__top">
      <div className="ui-review-transaction-card__status" aria-label="Historia y preparación de revisión">
        {selectionControl}
        {historyLabel || item.sourceLabel ? <div className="ui-review-transaction-card__history">
          {historyLabel ? <span className="ui-review-history" data-review-history-label={historyKey}>{historyLabel}</span> : null}
          {item.sourceLabel ? <span className="ui-review-source-label">{item.sourceLabel}</span> : null}
        </div> : null}
        {!inlineMode || preparationKey === "blocked" ? <TransactionStatus state={item.status} label={statusLabel} /> : null}
      </div>
      {inlineAmount || <TransactionAmount value={item.signedAmount} privateAmounts={privateAmounts} tone={item.kind === "transfer" ? "neutral" : item.kind} label="Importe" />}
    </div>
    {reopened && !inlineMode ? <p className="ui-review-transaction-card__reopened" role="status"><strong>Reabierto</strong> · Cambió después de una revisión anterior</p> : null}
    {inlineMode ? inlineContent : <>
      <TransactionIdentity description={item.description} date={item.date} account={item.account} kind={item.kind} />
      <TransactionMetadata isRefund={item.isRefund} isTransfer={item.kind === "transfer"} transferFrom={item.transferFrom} transferTo={item.transferTo} attachmentCount={item.attachmentCount} />
      {item.kind !== "transfer" ? <TransactionCategory category={item.category} /> : null}
      {item.showMissingCategory ? <p className="ui-review-transaction-card__missing">Falta categoría.</p> : null}
      {categoryEditor ? <section className="ui-review-transaction-card__category-action" data-review-category-editor aria-label="Completar categoría">{categoryEditor}</section> : null}
      {quickFix ? <section className="ui-review-transaction-card__quick-fix" data-review-quick-fix aria-label="Completar dato pendiente">{quickFix}</section> : null}
      <ReviewChanges changes={item.changes} privateAmounts={privateAmounts} />
    </>}
    {inlineIssues}
    {inlineMode && blockingCount ? <div className="ui-review-inline__issues ui-review-inline__issues--blocking" data-review-blocking-summary role="alert">
      <strong>{blockingSummary}</strong>
      <span>Corrige los datos marcados para incorporar este movimiento.</span>
    </div> : null}
    {!inlineMode && attentionIssues.length ? <div className="ui-review-transaction-card__issues" role="status">
      <strong>Necesita atención</strong>
      <ul>{attentionIssues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>
    </div> : null}
    {!inlineMode && blockingCount ? <div className="ui-review-transaction-card__issues is-blocking" role="alert">
      <strong>No puede incorporarse todavía</strong>
      <ul>{item.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>
    </div> : null}
    {decisionLabel && (!inlineMode || decisionKey === "incorporated") ? <div className="ui-review-transaction-card__decision" data-review-decision-label={decisionKey}><span>{inlineMode ? "Estado" : "Decisión"}</span><strong>{decisionLabel}</strong></div> : null}
    {!suppressActions && (onEdit || editing || decisionActions) ? <div className="ui-review-transaction-card__actions">
      {onEdit || editing ? <div className={editIsPrimary ? "ui-review-transaction-card__primary-action" : "ui-review-transaction-card__secondary-actions"}>
         <button ref={editButtonRef} className={`ui-button ui-button--${editing ? "secondary" : editButtonTone}`} type="button" aria-expanded={editing} aria-controls={editing ? editorId : undefined} onClick={editing ? onCloseEdit : onEdit}>{editing ? (inlineMode ? "Cerrar detalles" : "Cerrar edición") : editLabel}</button>
      </div> : null}
      {!editing && decisionActions ? <div className="ui-review-transaction-card__primary-action">{decisionActions}</div> : null}
    </div> : null}
    {editing && editor ? <section ref={editorRef} id={editorId} className="ui-review-transaction-card__editor" aria-label={`${inlineMode ? "Más detalles de" : "Editor de"} ${item.description}`} tabIndex={-1}>{inlineMode ? null : <h4>Editar movimiento</h4>}{editor}</section> : null}
  </article>;
}
