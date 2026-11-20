import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import type {Account} from "../shared/model/accounts";
import type {Category} from "../shared/model/categories";
import {emptyTransaction} from "../features/transactions/transactionModel";
import {TransactionForm} from "../features/transactions/TransactionForm";

const account = {id: 1, name: "Principal", kind: "checking", active: true, color: "#3478F6", balance: 1000} as Account;
const categories = [
  {id: 1, name: "Alimentación", display_name: "Alimentación", kind: "expense", color: "#3478F6", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 0, is_favorite: false},
  {id: 2, name: "Transporte", display_name: "Transporte", kind: "expense", color: "#18A572", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false},
] as Category[];

describe("TransactionForm category allocations", () => {
  it("does not create explicit allocations while editing a legacy category only", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TransactionForm
      title="Editar movimiento"
      submitLabel="Guardar cambios"
      accounts={[account]}
      categories={categories}
      refundCandidates={[]}
      initial={{...emptyTransaction, amount: "42.35", account: "1", date: "2026-10-23", description: "Compra semanal", category: "1", expected_allocation_revision: 0}}
      onSubmit={onSubmit}
    />);

    fireEvent.change(screen.getByLabelText("Concepto"), {target: {value: "Compra actualizada"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar cambios"}));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0]?.[0];
    expect(submitted).toMatchObject({description: "Compra actualizada", category: "1"});
    expect(submitted.allocations).toBeUndefined();
    expect(submitted.expected_allocation_revision).toBeUndefined();
  });

  it("sends the allocation revision when a legacy category is explicitly split or recategorized", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TransactionForm
      title="Editar movimiento"
      submitLabel="Guardar cambios"
      accounts={[account]}
      categories={categories}
      refundCandidates={[]}
      initial={{...emptyTransaction, amount: "42.35", account: "1", date: "2026-10-23", description: "Compra semanal", category: "1", expected_allocation_revision: 0}}
      onSubmit={onSubmit}
    />);

    fireEvent.change(screen.getByLabelText("Categoría de la partida 1"), {target: {value: "2"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar cambios"}));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      category: "2",
      allocations: [{category_id: 2, amount: "42.35"}],
      expected_allocation_revision: 0,
    });
  });

  it("keeps the revision on explicit allocations when unrelated transaction fields change", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TransactionForm
      title="Editar movimiento"
      submitLabel="Guardar cambios"
      accounts={[account]}
      categories={categories}
      refundCandidates={[]}
      initial={{
        ...emptyTransaction,
        amount: "100.00",
        account: "1",
        date: "2026-10-23",
        description: "Compra semanal",
        allocations: [{category_id: 1, amount: "60.00"}, {category_id: 2, amount: "40.00"}],
        expected_allocation_revision: 4,
      }}
      onSubmit={onSubmit}
    />);

    fireEvent.change(screen.getByLabelText("Concepto"), {target: {value: "Compra actualizada"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar cambios"}));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      description: "Compra actualizada",
      allocations: [{category_id: 1, amount: "60.00"}, {category_id: 2, amount: "40.00"}],
      expected_allocation_revision: 4,
    });
  });

  it("requires an exact cent total and submits one movement with explicit parts", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TransactionForm
      title="Añadir ingreso o gasto"
      submitLabel="Guardar movimiento"
      accounts={[account]}
      categories={categories}
      refundCandidates={[]}
      initial={{...emptyTransaction, amount: "100.00", account: "1", date: "2026-10-23", description: "Compra semanal"}}
      onSubmit={onSubmit}
    />);

    fireEvent.change(screen.getByLabelText("Categoría de la partida 1"), {target: {value: "1"}});
    fireEvent.click(screen.getByRole("button", {name: "Añadir partida"}));
    fireEvent.change(screen.getByLabelText("Categoría de la partida 2"), {target: {value: "2"}});
    fireEvent.change(screen.getByLabelText("Importe de la partida 2"), {target: {value: "40.00"}});
    expect(screen.getByRole("alert")).toHaveTextContent("debe coincidir con el importe");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", {name: "Guardar movimiento"}));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("debe coincidir con el importe"));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Importe de la partida 1"), {target: {value: "60.00"}});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", {name: "Guardar movimiento"}));
      await Promise.resolve();
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      amount: "100.00",
      category: "",
      allocations: [
        {category_id: 1, amount: "60.00"},
        {category_id: 2, amount: "40.00"},
      ],
    })));
  });

  it("allows a linked refund to split excess income across income categories", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const incomeCategories = [
      {id: 3, name: "Reembolso", display_name: "Reembolso", kind: "income", color: "#3478F6", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 2, is_favorite: false},
      {id: 4, name: "Compensación", display_name: "Compensación", kind: "income", color: "#18A572", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 3, is_favorite: false},
    ] as Category[];
    render(<TransactionForm
      title="Añadir ingreso o gasto"
      submitLabel="Guardar movimiento"
      accounts={[account]}
      categories={[...categories, ...incomeCategories]}
      refundCandidates={[]}
      initial={{...emptyTransaction, kind: "income", amount: "100.00", account: "1", date: "2026-10-23", description: "Reembolso", refund_for: "41"}}
      onSubmit={onSubmit}
    />);

    const editor = screen.getByRole("region", {name: "Distribución por categorías"});
    expect(editor).toHaveTextContent("Lo aplicado reduce primero el gasto original");
    fireEvent.change(screen.getByLabelText("Categoría de la partida 1"), {target: {value: "3"}});
    fireEvent.click(screen.getByRole("button", {name: "Añadir partida"}));
    fireEvent.change(screen.getByLabelText("Categoría de la partida 2"), {target: {value: "4"}});
    fireEvent.change(screen.getByLabelText("Importe de la partida 2"), {target: {value: "40.00"}});
    fireEvent.change(screen.getByLabelText("Importe de la partida 1"), {target: {value: "60.00"}});
    fireEvent.click(screen.getByRole("button", {name: "Guardar movimiento"}));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      refund_for: "41",
      category: "",
      allocations: [{category_id: 3, amount: "60.00"}, {category_id: 4, amount: "40.00"}],
    })));
  });
});
