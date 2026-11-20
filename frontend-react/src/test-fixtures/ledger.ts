import type {LedgerItem} from "../ui/finance/LedgerItem";

export const ledgerFixtures: LedgerItem[] = [
  {id: "ledger-1", date: "2026-09-30", kind: "income", description: "Nómina septiembre 2026", account: {name: "Cuenta principal", color: "var(--entity-1)"}, category: {name: "Nómina", color: "var(--entity-2)"}, signedAmount: 1955, isRefund: false, attachmentCount: 0},
  {id: "ledger-2", date: "2026-09-29", kind: "expense", description: "Alquiler vivienda", account: {name: "Cuenta principal", color: "var(--entity-1)"}, category: {name: "Vivienda", color: "var(--entity-3)"}, signedAmount: -725, isRefund: false, attachmentCount: 0},
  {id: "ledger-3", date: "2026-09-28", kind: "expense", description: "Compra semanal", account: {name: "Tarjeta diaria", color: "var(--entity-6)"}, category: {name: "Alimentación", color: "var(--entity-6)"}, signedAmount: -63.42, sourceLabel: "Enable Banking", isRefund: false, attachmentCount: 1},
];
