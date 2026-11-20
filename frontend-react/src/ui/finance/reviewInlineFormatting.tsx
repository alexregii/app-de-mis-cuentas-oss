import {displayEuro, formatDate} from "../../format";
import type {ReviewChange, ReviewField} from "./ReviewItem";

const kindLabels = {expense: "Gasto", income: "Ingreso", transfer: "Traspaso"} as const;

export function reviewInlineDisplayValue(field: ReviewField, value: unknown, privateAmounts = false) {
  if (field === "amount") return displayEuro(Number(value), privateAmounts);
  if (field === "date") return value ? formatDate(String(value)) : "Sin fecha";
  if (field === "kind") return kindLabels[String(value) as keyof typeof kindLabels] || String(value || "Sin tipo");
  if (value && typeof value === "object" && "name" in value) return String(value.name);
  if (value === null || value === undefined || value === "") {
    if (field === "category") return "Sin categoría";
    if (field.includes("account")) return "Sin cuenta";
    if (field === "description") return "Sin concepto";
    return "Sin dato";
  }
  return String(value);
}

export function reviewInlineValueWithChange(field: ReviewField, current: unknown, change: ReviewChange | undefined, privateAmounts = false, currentLabel = reviewInlineDisplayValue(field, current, privateAmounts)) {
  if (!change) return <span>{currentLabel}</span>;
  return <span className="ui-review-inline__change"><del>{reviewInlineDisplayValue(field, change.previous, privateAmounts)}</del><span aria-hidden="true">→</span><strong>{currentLabel}</strong></span>;
}
