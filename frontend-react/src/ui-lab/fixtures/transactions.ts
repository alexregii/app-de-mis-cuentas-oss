import type {LedgerItem} from "../../ui/finance/LedgerItem";

export const transactionDirections = [
  {name: "Ledger columnar", detail: "Descripción e importe forman el eje; el contexto se ordena en líneas auxiliares."},
  {name: "Ticket compacto", detail: "Agrupa cada movimiento como comprobante, pero reduce demasiado la densidad."},
  {name: "Rail de identidad", detail: "El color de cuenta guía la fila, pero roba atención al importe."},
] as const;

export const transactionFixtures: LedgerItem[] = [
  {id: "income", kind: "income", description: "Nómina agosto 2026", date: "2026-08-30", account: {name: "Cuenta principal", color: "var(--entity-1)"}, category: {name: "Nómina", color: "var(--entity-2)"}, sourceLabel: "CSV", signedAmount: 1955, isRefund: false, attachmentCount: 1},
  {id: "expense", kind: "expense", description: "Compra extraordinariamente larga de material para el hogar, garantías y entrega programada", date: "2026-08-29", account: {name: "Cuenta principal", color: "var(--entity-1)"}, category: {name: "Hogar", color: "var(--entity-3)"}, sourceLabel: "Manual", signedAmount: -12345678.9, isRefund: false, attachmentCount: 2},
  {id: "transfer", kind: "transfer", description: "Traspaso a cuenta de ahorro", date: "2026-08-28", account: {name: "Cuenta principal", color: "var(--entity-1)"}, category: null, signedAmount: -300, isRefund: false, attachmentCount: 0},
  {id: "refund", kind: "income", description: "Reembolso parcial de compra", date: "2026-08-27", account: {name: "Cuenta Imagin", color: "var(--entity-4)"}, category: {name: "Electrónica", color: "var(--entity-5)"}, sourceLabel: "Enable Banking", signedAmount: 49.99, isRefund: true, attachmentCount: 0},
  {id: "uncategorized", kind: "expense", description: "Cargo pendiente de clasificar", date: "2026-08-26", account: {name: "Cuenta Imagin", color: "var(--entity-4)"}, category: null, sourceLabel: "Recurrente", signedAmount: -0.99, isRefund: false, attachmentCount: 0},
  {id: "no-actions", kind: "expense", description: "Movimiento sin acciones", date: "2026-08-25", account: {name: "Cuenta Imagin", color: "var(--entity-4)"}, category: null, signedAmount: -4.2, isRefund: false, attachmentCount: 0},
];

export const transactionCapabilities = {
  income: {edit: false, archive: true, reopen: true},
  expense: {edit: true, archive: true, reopen: false},
  transfer: {edit: false, archive: true, reopen: false},
  refund: {edit: false, archive: true, reopen: true},
  uncategorized: {edit: false, archive: true, reopen: false},
  "no-actions": {edit: false, archive: false, reopen: false},
} as const;
