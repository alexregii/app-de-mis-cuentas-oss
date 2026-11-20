import {describe, expect, it} from "vitest";
import type {Account} from "../shared/model/accounts";
import type {Category} from "../shared/model/categories";
import type {RefundCandidate} from "../shared/model/bootstrap";
import {changeTransactionEditorKind, prepareEditorAccounts, prepareEditorCategories, prepareRefundCandidates, validateTransactionDraft} from "../features/transactions/transactionEditorModel";
import type {TransactionEditorInput} from "../ui/finance/TransactionEditor";

const input: TransactionEditorInput = {
  kind: "expense",
  amount: "12.50",
  account: "",
  source_account: "",
  target_account: "",
  date: "2026-09-09",
  description: "Compra",
  category: "10",
  refund_for: "12",
  notes: "",
  tag_names: "",
};

const account = (id: number, name: string, active: boolean): Account => ({id, name, kind: "cash", kind_display: "Efectivo", balance: id * 10, opening_balance: 0, color: "#fff", active, bank_link: null});
const category = (id: number, display_name: string, kind: "income" | "expense"): Category => ({id, name: display_name, display_name, kind, color: "#fff", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: id, is_favorite: false});

describe("transaction editor feature model", () => {
  it("valida el borrador en la feature y exige cuentas distintas para transferencias", () => {
    expect(validateTransactionDraft({...input, account: "1"})).toEqual({});
    expect(validateTransactionDraft({...input, kind: "transfer", account: "", source_account: "1", target_account: "1"})).toEqual({target_account: ["El origen y el destino deben ser distintos."]});
  });

  it("resetea los campos dependientes al cambiar de tipo", () => {
    expect(changeTransactionEditorKind(input, "income")).toMatchObject({kind: "income", category: "", refund_for: "", account: ""});
    expect(changeTransactionEditorKind({...input, account: "2"}, "transfer")).toMatchObject({kind: "transfer", source_account: "2"});
  });

  it("prepara opciones presentacionales sin filtrar la lógica en stable UI", () => {
    expect(prepareEditorAccounts([account(1, "Activa", true), account(2, "Cerrada", false)])).toEqual([{id: 1, name: "Activa", balance: 10}]);
    expect(prepareEditorCategories([
      category(10, "Comida", "expense"),
      category(11, "Nómina", "income"),
    ])).toEqual({
      income: [{id: 11, display_name: "Nómina", kind: "income", color: "#fff"}],
      expense: [{id: 10, display_name: "Comida", kind: "expense", color: "#fff"}],
    });
    const refund: RefundCandidate = {id: 12, kind: "expense", amount: 30, date: "2026-09-01", description: "Compra"};
    expect(prepareRefundCandidates([refund])).toEqual([refund]);
  });
});
