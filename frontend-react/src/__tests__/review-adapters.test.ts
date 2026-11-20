import {describe, expect, it} from "vitest";
import type {Account} from "../shared/model/accounts";
import type {Category} from "../shared/model/categories";
import type {ImportBatch, ImportRow} from "../shared/model/imports";
import {changeTransactionEditorKind} from "../shared/model/transactionEditorOptions";
import type {BankReviewRow} from "../features/review/types";
import {toPreparedBankReview} from "../features/review/adapters/bankReviewAdapter";
import {toPreparedCsvReview} from "../features/review/adapters/csvReviewAdapter";
import {prepareReviewEditorOptions, toReviewEditorInput} from "../features/review/adapters/reviewEditorAdapter";
import {toReviewDisplayStatus, toReviewPreparation} from "../features/review/adapters/reviewAdapterSemantics";
import {changeReviewDraftKind, reviewDraftFromEditorInput, toBankConfirmMutation, toCsvMutation} from "../features/review/adapters/reviewDraft";
import type {PreparedReview} from "../features/review/adapters/reviewAdapterTypes";

const account = (id: number, name = "Cuenta principal"): Account => ({
  id,
  name,
  kind: "bank",
  kind_display: "Banco",
  balance: 100,
  opening_balance: 0,
  color: "#245",
  active: true,
  bank_link: null,
});

const category = (id: number, display_name = "Alimentación", kind: "income" | "expense" = "expense"): Category => ({
  id,
  name: display_name,
  display_name,
  kind,
  color: "#678",
  icon: "",
  active: true,
  parent_id: null,
  exclude_from_analytics: false,
  sort_order: id,
  is_favorite: false,
});

const bankRow = (overrides: Partial<BankReviewRow> = {}): BankReviewRow => ({
  id: 41,
  bank_account: {id: 7, display_name: "Banco", account: account(7)},
  booking_date: "2026-09-08",
  description: "Compra semanal",
  amount: 12.5,
  kind: "expense",
  currency: "EUR",
  category: category(9),
  suggested_category: null,
  prediction: null,
  possible_duplicate: false,
  possible_transfer: false,
  fee_transaction_id: null,
  status: "pending",
  ...overrides,
});

const batch: ImportBatch = {
  id: 3,
  filename: "septiembre.csv",
  account: account(7),
  profile: null,
  status: "pending",
  status_display: "Pendiente",
  created_at: "2026-09-08T10:00:00Z",
  pending_count: 1,
  row_count: 1,
};

const csvRow = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  id: 51,
  batch_id: batch.id,
  row_number: 1,
  date: "2026-09-08",
  description: "Compra semanal",
  amount: 12.5,
  kind: "expense",
  category: category(9),
  possible_duplicate: false,
  status: "pending",
  status_display: "Pendiente",
  transaction_id: null,
  ...overrides,
});

function prepared(value: PreparedReview | null): PreparedReview {
  if (!value) throw new Error("Se esperaba una revisión preparada");
  return value;
}

function expectActionCapabilityInvariants(value: PreparedReview) {
  expect(Boolean(value.actions.confirm)).toBe(value.capabilities.confirm);
  expect(Boolean(value.actions.force)).toBe(value.capabilities.force);
  expect(Boolean(value.actions.category)).toBe(value.capabilities.category);
  expect(Boolean(value.actions.skip)).toBe(value.capabilities.skip);
  expect(Boolean(value.actions.transfer)).toBe(value.capabilities.transfer);
}

describe("adapters de Revisión", () => {
  it("prepara Bank pendiente con payloads tipados y categoría persistida", () => {
    const value = prepared(toPreparedBankReview(bankRow()));

    expect(value).toMatchObject({
      source: "bank",
      sourceId: 41,
      history: "new",
      preparation: "prepared",
      decision: "pending",
      displayStatus: "new",
      item: {
        id: "bank:41",
        signedAmount: -12.5,
        account: {name: "Cuenta principal", color: "#245"},
        category: {name: "Alimentación", color: "#678"},
        sourceLabel: "Banco",
      },
      blockingIssues: [],
      attentionIssues: [],
      capabilities: {editableFields: ["category"], canPersistStandaloneEdit: false, select: true, confirm: true, skip: true, transfer: true, canChooseRefund: false, canRememberCategory: true},
    });
    expect(value.item).not.toHaveProperty("bank_account");
    expect(value.item).not.toHaveProperty("prediction");
    expect(value.item).not.toHaveProperty("possible_duplicate");
    expect(value.actions.confirm).toEqual({kind: "confirm", source: "bank", sourceId: 41, input: {category: 9, refund_for: "", remember_category: false}});
    expect(value.actions.skip).toEqual({kind: "skip", source: "bank", sourceId: 41});
    expect(value.actions.transfer).toEqual({kind: "transfer", source: "bank", sourceId: 41, input: {}});
    expect(value.capabilities.editableFields).toEqual(["category"]);
    expectActionCapabilityInvariants(value);
  });

  it("separa bloqueo de atención en Bank y conserva todas las señales", () => {
    const value = prepared(toPreparedBankReview(bankRow({category: null, possible_duplicate: true, possible_transfer: true})));

    expect(value.item.kind).toBe("expense");
    expect(value.preparation).toBe("blocked");
    expect(value.capabilities.confirm).toBe(false);
    expect(value.blockingIssues.map(({code}) => code)).toEqual(["category-missing"]);
    expect(value.attentionIssues.map(({code}) => code)).toEqual(["possible-duplicate", "possible-transfer"]);
    expect(value.issues.map(({code}) => code)).toEqual(["category-missing", "possible-duplicate", "possible-transfer"]);
    expect(value.item.issues.map(({code}) => code)).toEqual(["category-missing"]);
    expectActionCapabilityInvariants(value);
  });

  it("clasifica duplicado y posible traspaso como needs_attention, no como bloqueo", () => {
    const duplicate = prepared(toPreparedBankReview(bankRow({possible_duplicate: true})));
    const possibleTransfer = prepared(toPreparedBankReview(bankRow({possible_transfer: true})));

    expect(duplicate).toMatchObject({preparation: "needs_attention", displayStatus: "needs_attention", blockingIssues: []});
    expect(duplicate.attentionIssues.map(({code}) => code)).toEqual(["possible-duplicate"]);
    expect(duplicate.item.issues).toEqual([]);
    expect(possibleTransfer).toMatchObject({preparation: "needs_attention", displayStatus: "needs_attention", blockingIssues: []});
    expect(possibleTransfer.attentionIssues.map(({code}) => code)).toEqual(["possible-transfer"]);
    expect(duplicate.actions.confirm).toBeUndefined();
    expect(duplicate.actions.force).toEqual({kind: "force", source: "bank", sourceId: 41, input: {category: 9, refund_for: "", remember_category: false}});
    expect(duplicate.capabilities.force).toBe(true);
    expectActionCapabilityInvariants(duplicate);
  });

  it("no ofrece forzar cuando la fila sigue bloqueada por un dato obligatorio", () => {
    const value = prepared(toPreparedBankReview(bankRow({category: null, possible_duplicate: true})));

    expect(value.preparation).toBe("blocked");
    expect(value.actions.force).toBeUndefined();
    expect(value.capabilities.force).toBe(false);
    expectActionCapabilityInvariants(value);
  });

  it("usa la categoría persistida antes que la sugerida en item, editor y acción", () => {
    const value = prepared(toPreparedBankReview(bankRow({category: category(9, "Alimentación"), suggested_category: category(10, "Restaurantes")})));

    expect(value.item.category).toMatchObject({name: "Alimentación"});
    expect(value.editorInput.category).toBe("9");
    expect(value.actions.confirm?.input.category).toBe(9);
  });

  it("preselecciona la sugerencia solo cuando no hay categoría persistida", () => {
    const value = prepared(toPreparedBankReview(bankRow({category: null, suggested_category: category(10, "Restaurantes")})));

    expect(value.item.category).toMatchObject({name: "Restaurantes"});
    expect(value.editorInput.category).toBe("10");
    expect(value.actions.confirm?.input.category).toBe(10);
    expect(value.preparation).toBe("prepared");
  });

  it("reconfirms a reopened split without adopting a new category suggestion", () => {
    const refundIncome = category(12, "Reembolso", "income");
    const refundBonus = category(13, "Compensación", "income");
    const value = prepared(toPreparedBankReview(bankRow({
      kind: "income",
      amount: 130,
      category: null,
      suggested_category: refundIncome,
      prediction: {category: refundIncome, confidence: 0.9, reason: "Ingreso habitual", status: "suggested"},
      reopened_refund: {id: 77, date: "2026-07-08", description: "Compra original"},
      reopened_split: {
        transaction_id: 88,
        allocations: [
          {category: refundIncome, amount: 65, position: 0},
          {category: refundBonus, amount: 65, position: 1},
        ],
      },
    })));

    expect(value).toMatchObject({
      history: "reopened",
      preparation: "prepared",
      item: {category: null},
      draft: {category: ""},
      preservedAllocationLabels: ["Reembolso", "Compensación"],
      preservedRefundDescription: "Compra original · 2026-07-08",
      capabilities: {canEditDraft: false, editableFields: [], select: false, confirm: true, transfer: false, canChooseRefund: false},
    });
    expect(value.blockingIssues).toEqual([]);
    expect(value.suggestion).toBeUndefined();
    expect(value.actions.confirm?.input.category).toBe("");
    expect(value.actions.confirm).toMatchObject({source: "bank", input: {category: "", refund_for: 77}});
    expectActionCapabilityInvariants(value);
  });

  it("conserva la explicación de predicción como dato preparado, sin filtrar el raw", () => {
    const value = prepared(toPreparedBankReview(bankRow({
      suggested_category: category(10, "Restaurantes"),
      prediction: {category: category(10, "Restaurantes"), confidence: 0.92, reason: "Compra habitual", model_name: "qwen3:1.7b", status: "suggested"},
    })));

    expect(value.suggestion).toEqual({category: {name: "Restaurantes", color: "#678"}, confidence: 0.92, reason: "Compra habitual", modelName: "qwen3:1.7b", status: "suggested"});
    expect(value.item).not.toHaveProperty("prediction");
  });

  it("mantiene el signo financiero y permite modificadores de confirmación de ingreso", () => {
    const value = prepared(toPreparedBankReview(bankRow({kind: "income", amount: -30})));

    expect(value.item.signedAmount).toBe(30);
    expect(value.editorInput.amount).toBe("30");
    expect(value.capabilities.canChooseRefund).toBe(true);
    expect(value.capabilities.canRememberCategory).toBe(true);
    expect(value.actions.confirm).toMatchObject({input: {refund_for: ""}});
  });

  it("no transforma una fila Bank omitida en una incorporación", () => {
    expect(toPreparedBankReview(bankRow({status: "skipped"}))).toBeNull();
    const imported = prepared(toPreparedBankReview(bankRow({status: "imported"})));
    expect(imported.decision).toBe("incorporated");
    expect(imported.actions).toEqual({});
    expect(imported.capabilities.editableFields).toEqual([]);
    expectActionCapabilityInvariants(imported);
  });

  it("aplica una whitelist fail-safe de estados Bank", () => {
    expect(toPreparedBankReview(bankRow({status: "unknown"}))).toBeNull();
    expect(toPreparedBankReview(bankRow({status: "skipped"}))).toBeNull();
    expect(prepared(toPreparedBankReview(bankRow({status: "pending"}))).decision).toBe("pending");
    expect(prepared(toPreparedBankReview(bankRow({status: "imported"}))).decision).toBe("incorporated");
  });

  it("recalcula Bank desde el draft y deriva la confirmación actual", () => {
    const nextCategory = category(11, "Restaurantes", "income");
    const input = toReviewEditorInput({source: "bank", row: bankRow({kind: "income", category: category(9, "Nómina", "income")})});
    const draft = reviewDraftFromEditorInput(input, {category: "11", refund_for: "77", remember_category: true});
    const value = prepared(toPreparedBankReview({...bankRow({kind: "income", category: category(9, "Nómina", "income")}), possible_transfer: false}, draft, [nextCategory]));

    expect(value.draft).toEqual(draft);
    expect(value.item.category).toMatchObject({name: "Restaurantes"});
    expect(value.actions.confirm?.input).toEqual({category: 11, refund_for: 77, remember_category: true});
  });

  it("deriva cambios visibles desde el draft actual y los elimina al volver al original", () => {
    const original = bankRow({category: category(9, "Comida")});
    const input = toReviewEditorInput({source: "bank", row: original});
    const changedDraft = reviewDraftFromEditorInput(input, {category: "11"});
    const categories = [category(9, "Comida"), category(11, "Ocio")];
    const changed = prepared(toPreparedBankReview(original, changedDraft, categories));

    expect(changed.changes).toEqual([{field: "category", previous: {name: "Comida", color: "#678"}, current: {name: "Ocio", color: "#678"}}]);
    expect(changed.item.changes).toEqual(changed.changes);
    expect(prepared(toPreparedBankReview(original, reviewDraftFromEditorInput(input, {category: "9"}), categories)).changes).toEqual([]);
  });

  it("prepara CSV pendiente y conserva la categoría opcional del contrato de importación", () => {
    const value = prepared(toPreparedCsvReview(csvRow(), batch));
    const withoutCategory = prepared(toPreparedCsvReview(csvRow({category: null}), batch));

    expect(value).toMatchObject({source: "csv", sourceId: 51, history: "new", preparation: "prepared", decision: "pending"});
    expect(value.item).toMatchObject({id: "csv:51", signedAmount: -12.5, account: {name: "Cuenta principal"}, category: {name: "Alimentación"}});
    expect(withoutCategory).toMatchObject({preparation: "prepared", blockingIssues: [], actions: {confirm: {input: {category: "", new_category: "", new_subcategory: ""}}}});
    expectActionCapabilityInvariants(value);
  });

  it("reabre CSV repartido sin exponer categoría ni sugerencias automáticas", () => {
    const value = prepared(toPreparedCsvReview(csvRow({
      category_rule_matches: [{id: 8, description: "Compra semanal", kind: "expense", category: category(10, "Ocio"), priority: 1, match_mode: "exact", account_id: null, amount_min: null, amount_max: null}],
      reopened_split: {
        transaction_id: 80,
        allocations: [
          {category: category(9, "Alimentación"), amount: 7, position: 0},
          {category: category(10, "Ocio"), amount: 5.5, position: 1},
        ],
      },
      reopened_refund: {id: 79, date: "2026-09-01", description: "Compra original CSV"},
    }), batch));

    expect(value).toMatchObject({history: "reopened", preparation: "prepared", categoryRuleMatches: [], preservedAllocationLabels: ["Alimentación", "Ocio"], preservedRefundDescription: "Compra original CSV · 2026-09-01"});
    expect(value.item.category).toBeNull();
    expect(value.capabilities).toMatchObject({canEditDraft: false, editableFields: [], canPersistStandaloneEdit: false, category: false, confirm: true});
    expect(value.actions.confirm?.input).toEqual({category: "", new_category: "", new_subcategory: ""});
    expect(value.actions.category).toBeUndefined();
    expectActionCapabilityInvariants(value);
  });

  it("clasifica duplicado CSV como atención y no expone confirmación ordinaria", () => {
    const value = prepared(toPreparedCsvReview(csvRow({possible_duplicate: true}), batch));

    expect(value).toMatchObject({preparation: "needs_attention", displayStatus: "needs_attention", blockingIssues: [], attentionIssues: [{code: "possible-duplicate"}]});
    expect(value.actions.confirm).toBeUndefined();
    expect(value.actions.force).toMatchObject({kind: "force", input: {category: "9", new_category: "", new_subcategory: ""}});
    expect(value.actions.category).toMatchObject({kind: "category"});
    expect(value.item.issues).toEqual([]);
    expect(value.actions.skip).toEqual({kind: "skip", source: "csv", sourceId: 51});
    expectActionCapabilityInvariants(value);
  });

  it("mapea CSV imported y descarta CSV skipped sin confundir decisiones", () => {
    const imported = prepared(toPreparedCsvReview(csvRow({status: "imported", status_display: "Importada", transaction_id: 80}), batch));

    expect(imported).toMatchObject({history: "unchanged", preparation: "prepared", decision: "incorporated", displayStatus: "ready", actions: {}});
    expect(toPreparedCsvReview(csvRow({status: "skipped", status_display: "Omitida"}), batch)).toBeNull();
    expectActionCapabilityInvariants(imported);
  });

  it("representa las operaciones CSV reales desde el draft actual", () => {
    const input = toReviewEditorInput({source: "csv", row: csvRow({category: null}), batch});
    const draft = reviewDraftFromEditorInput(input, {category: "12", new_category: "Compras personales", new_subcategory: "Libros"});
    const categories = [category(12, "Compras personales")];
    const normal = prepared(toPreparedCsvReview(csvRow({possible_duplicate: false, category: null}), batch, draft, categories));
    const duplicate = prepared(toPreparedCsvReview(csvRow({possible_duplicate: true, category: null}), batch, draft, categories));

    expect(normal.actions.confirm?.input).toEqual(toCsvMutation(draft));
    expect(normal.actions.category?.input).toEqual(toCsvMutation(draft));
    expect(normal.actions.force).toBeUndefined();
    expect(duplicate.actions.confirm).toBeUndefined();
    expect(duplicate.actions.force?.input).toEqual({category: "12", new_category: "Compras personales", new_subcategory: "Libros"});
    expect(duplicate.capabilities).toMatchObject({canEditDraft: true, canPersistStandaloneEdit: true, force: true, category: true});
    expect(duplicate.capabilities.editableFields).toEqual(["category"]);
  });

  it("aplica la función pura de preparación con prioridad bloqueado > atención > preparado", () => {
    expect(toReviewPreparation([], [])).toBe("prepared");
    expect(toReviewPreparation([], [{code: "possible-duplicate", message: ""}])).toBe("needs_attention");
    expect(toReviewPreparation([{code: "category-missing", message: ""}], [{code: "possible-duplicate", message: ""}])).toBe("blocked");
  });

  it("mantiene independientes preparación, historial y estado de representación", () => {
    expect(toReviewDisplayStatus("new", "prepared")).toBe("new");
    expect(toReviewDisplayStatus("changed", "prepared")).toBe("changed");
    expect(toReviewDisplayStatus("reopened", "prepared")).toBe("changed");
    expect(toReviewDisplayStatus("unchanged", "prepared")).toBe("ready");
    expect(toReviewDisplayStatus("new", "needs_attention")).toBe("needs_attention");
    expect(toReviewDisplayStatus("changed", "blocked")).toBe("blocked");
  });

  it("mantiene la frontera del editor y reutiliza sus preparadores puros", () => {
    const input = toReviewEditorInput({source: "bank", row: bankRow({kind: "income", amount: 30, category: null, suggested_category: category(10, "Nómina", "income")})});
    const options = prepareReviewEditorOptions([account(7)], [category(9), category(10, "Nómina", "income")], [{id: 12, kind: "expense", amount: 24, date: "2026-09-01", description: "Compra"}]);

    expect(input).toMatchObject({kind: "income", amount: "30", account: "7", category: "10", date: "2026-09-08"});
    expect(options.accounts).toEqual([{id: 7, name: "Cuenta principal", balance: 100}]);
    expect(options.categoriesByKind.income).toEqual([{id: 10, display_name: "Nómina", kind: "income", color: "#678"}]);
    expect(options.refundCandidates).toEqual([{id: 12, kind: "expense", amount: 24, date: "2026-09-01", description: "Compra"}]);
  });

  it("hace round-trip de importes expense e income y mantiene una sola política de cambio de tipo", () => {
    const expense = toReviewEditorInput({source: "bank", row: bankRow({amount: -12.5})});
    const income = toReviewEditorInput({source: "csv", row: csvRow({kind: "income", amount: 30}), batch});
    const transfer = changeTransactionEditorKind({...expense, category: "9", refund_for: "12", source_account: "7", target_account: "8"}, "transfer");
    const backToExpense = changeTransactionEditorKind(transfer, "expense");

    expect(expense.amount).toBe("12.5");
    expect(income).toMatchObject({kind: "income", amount: "30"});
    expect(transfer).toMatchObject({kind: "transfer", category: "", refund_for: "", source_account: "7", account: "7"});
    expect(backToExpense).toMatchObject({kind: "expense", category: "", refund_for: "", account: "7"});
  });

  it("documenta la política de cambio de tipo y limpia los campos dependientes", () => {
    const input = reviewDraftFromEditorInput(toReviewEditorInput({source: "bank", row: bankRow()}), {category: "9", refund_for: "12"});
    const transfer = changeReviewDraftKind(input, "transfer");
    const expense = changeReviewDraftKind(transfer, "expense");

    expect(transfer).toMatchObject({kind: "transfer", category: "", refund_for: "", target_account: ""});
    expect(expense).toMatchObject({kind: "expense", category: "", refund_for: ""});
    expect(toBankConfirmMutation(input)).toEqual({category: 9, refund_for: 12, remember_category: false});
  });

  it("mantiene equivalencia semántica entre Bank y CSV para el mismo movimiento", () => {
    const bank = prepared(toPreparedBankReview(bankRow()));
    const csv = prepared(toPreparedCsvReview(csvRow(), batch));

    expect({description: bank.item.description, date: bank.item.date, signedAmount: bank.item.signedAmount, kind: bank.item.kind, category: bank.item.category})
      .toEqual({description: csv.item.description, date: csv.item.date, signedAmount: csv.item.signedAmount, kind: csv.item.kind, category: csv.item.category});
  });
});
