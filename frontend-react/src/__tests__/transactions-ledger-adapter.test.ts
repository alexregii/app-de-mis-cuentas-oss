import {describe, expect, it} from "vitest";
import type {Transaction} from "../shared/model/transactions";
import {toLedgerCapabilities} from "../features/transactions/ledgerAdapter";
import {toLedgerItem} from "../shared/adapters/transactionLedgerItem";

const account = {id: 7, name: "Cuenta principal", color: "#245"} as Transaction["account"];
const category = {id: 9, name: "Alimentación", display_name: "Alimentación", kind: "expense", color: "#678"} as NonNullable<Transaction["category"]>;
const baseTransaction = {
  id: 41,
  kind: "expense",
  kind_display: "Gasto",
  amount: 12.5,
  signed_amount: -12.5,
  date: "2026-09-08",
  description: "Compra semanal",
  notes: "interno",
  account,
  category,
  source: "manual",
  source_display: "Manual",
  refund_for_id: null,
  is_refund: false,
  is_transfer: false,
  tags: ["casa"],
  attachments: [],
} as unknown as Transaction;

const makeTransaction = (overrides: Partial<Transaction> = {}) => ({...baseTransaction, ...overrides});

describe("adapter de transacciones a Ledger UI", () => {
  it.each([
    ["income", "income", 12.5],
    ["expense", "expense", -12.5],
    ["transfer_in", "transfer", 300],
    ["transfer_out", "transfer", -300],
  ] as const)("normaliza kind y signedAmount para %s", (kind, expectedKind, signedAmount) => {
    const item = toLedgerItem(makeTransaction({kind, is_transfer: expectedKind === "transfer", signed_amount: signedAmount}));
    expect(item).toMatchObject({kind: expectedKind, signedAmount});
  });

  it("normaliza el item sin filtrar datos de dominio", () => {
    const item = toLedgerItem(makeTransaction({id: 99, category: null, description: "Descripción larga ".repeat(20)}));

    expect(item).toMatchObject({
      id: "99",
      date: "2026-09-08",
      description: "Descripción larga ".repeat(20),
      signedAmount: -12.5,
      kind: "expense",
      account: {name: "Cuenta principal", color: "#245"},
      category: null,
      isRefund: false,
      attachmentCount: 0,
    });
    expect(item).not.toHaveProperty("notes");
    expect(item).not.toHaveProperty("tags");
    expect(item).not.toHaveProperty("statistics_attribution");
    expect(item).not.toHaveProperty("refund_for_id");
    expect(item).not.toHaveProperty("attachments");
    expect(item).not.toHaveProperty("permissions");
    expect(item).not.toHaveProperty("callbacks");
    expect(item).not.toHaveProperty("transaction");
  });

  it.each([
    ["manual", {edit: true, archive: true, reopen: false, allocate: true}],
    ["csv", {edit: false, archive: true, reopen: true, allocate: true}],
    ["enable_banking", {edit: false, archive: true, reopen: true, allocate: true}],
    ["recurring", {edit: false, archive: true, reopen: false, allocate: true}],
    ["unknown_future_source", {edit: false, archive: true, reopen: false, allocate: true}],
  ] as const)("aplica capabilities para %s", (source, expected) => {
    expect(toLedgerCapabilities(makeTransaction({source}))).toEqual(expected);
  });

  it.each(["transfer_in", "transfer_out"] as const)("mantiene %s como transfer y bloquea edición y reapertura no disponible", (kind) => {
    const transaction = makeTransaction({kind, is_transfer: true, category: null, signed_amount: kind === "transfer_in" ? 300 : -300});

    expect(toLedgerItem(transaction)).toMatchObject({kind: "transfer", category: null});
    expect(toLedgerCapabilities(transaction)).toEqual({edit: false, archive: true, reopen: false, allocate: false});
  });

  it("permite reabrir un traspaso solo cuando la API confirma su origen bancario", () => {
    const transaction = makeTransaction({kind: "transfer_out", is_transfer: true, can_reopen: true});

    expect(toLedgerCapabilities(transaction)).toEqual({edit: false, archive: true, reopen: true, allocate: false});
  });

  it("expone solo origen excepcional, reembolso y cantidad de adjuntos", () => {
    const refund = makeTransaction({source: "csv", source_display: "Importación CSV", is_refund: true, attachments: [
      {id: 1, name: "factura.pdf", url: "/privado/factura.pdf"},
      {id: 2, name: "ticket.pdf", url: "/privado/ticket.pdf"},
    ]});
    const item = toLedgerItem(refund);

    expect(item).toMatchObject({sourceLabel: "Importación CSV", isRefund: true, attachmentCount: 2});
    expect(toLedgerCapabilities(refund).allocate).toBe(true);
    expect(item).not.toHaveProperty("attachments");
    expect(item).not.toHaveProperty("attachmentUrls");
    expect(item).not.toHaveProperty("refund_for_id");
  });

  it("omite sourceLabel cuando el origen no aporta etiqueta visible", () => {
    expect(toLedgerItem(makeTransaction({source: "unknown_future_source", source_display: ""}))).not.toHaveProperty("sourceLabel");
  });

  it("deja la categoría ausente como null y respeta los colores de entidad", () => {
    const item = toLedgerItem(makeTransaction({category}));

    expect(item.category).toEqual({name: "Alimentación", color: "#678"});
    expect(item.account).toEqual({name: "Cuenta principal", color: "#245"});
    expect(toLedgerItem(makeTransaction({category: null})).category).toBeNull();
  });

  it("muestra los nombres de partidas de categoría sin exponer importes", () => {
    const item = toLedgerItem(makeTransaction({
      category: null,
      allocations: [
        {category, amount: 60, position: 0},
        {category: {...category, id: 10, name: "Transporte", display_name: "Transporte", color: "#abc"}, amount: 40, position: 1},
      ],
    }));

    expect(item.category).toEqual({name: "Alimentación · Transporte", color: "#678"});
    expect(item.category?.name).not.toContain("60");
    expect(item.category?.name).not.toContain("40");
  });

  it("aplica una policy parcial sin habilitar acciones de dominio", () => {
    expect(toLedgerCapabilities(makeTransaction({source: "manual"}), {actionPolicy: {edit: false}})).toEqual({edit: false, archive: true, reopen: false, allocate: true});
    expect(toLedgerCapabilities(makeTransaction({source: "unknown_future_source"}), {actionPolicy: {reopen: true}})).toEqual({edit: false, archive: true, reopen: false, allocate: true});
  });

  it("aplica la policy total como límite adicional", () => {
    expect(toLedgerCapabilities(makeTransaction(), {actionPolicy: {edit: false, archive: false, reopen: false}})).toEqual({edit: false, archive: false, reopen: false, allocate: true});
  });
});
