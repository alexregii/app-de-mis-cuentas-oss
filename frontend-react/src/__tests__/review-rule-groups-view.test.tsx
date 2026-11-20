import {fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import type {PreparedReview} from "../features/review/adapters/reviewAdapterTypes";
import {ReviewRuleGroups} from "../features/review/ReviewRuleGroups";
import type {ReviewRuleConflict, ReviewRuleGroup} from "../features/review/reviewRuleModel";

const preparedRow = (sourceId: number) => ({
  source: "bank",
  sourceId,
  item: {
    description: `Compra agrupada ${sourceId}`,
    date: "2026-10-20",
    signedAmount: -12,
    account: {name: "Cuenta diaria"},
  },
} as unknown as PreparedReview);

const makeGroup = (count: number): ReviewRuleGroup => ({
  id: "bank:bank:12:expense:7:1",
  source: "bank",
  accountId: 12,
  batchId: null,
  kind: "expense",
  rule: {id: 7, description: "Compra agrupada", category: {id: 1, display_name: "Comida"}} as ReviewRuleGroup["rule"],
  rows: Array.from({length: count}, (_, index) => preparedRow(index + 1)),
});

const conflict = (): ReviewRuleConflict => ({
  prepared: preparedRow(51),
  matches: [],
  reason: "Varias reglas coinciden con categorías distintas.",
});

describe("ReviewRuleGroups", () => {
  it("shows a 50-row preview, excludes a selected row, and applies only after confirmation", async () => {
    const group = makeGroup(50);
    const onApply = vi.fn().mockResolvedValue(true);
    render(<ReviewRuleGroups groups={[group]} conflicts={[]} focusTargetId="bank-review" onApply={onApply} />);

    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: /Revisar grupo/}));
    const preview = screen.getByRole("region", {name: "Vista previa de regla Compra agrupada"});
    expect(within(preview).getAllByRole("checkbox")).toHaveLength(50);
    expect(screen.getByText("50 de 50 filas seleccionadas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", {name: "Incluir fila 1 en el grupo"}));
    expect(screen.getByText("49 de 50 filas seleccionadas")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: "Incorporar 49 filas"}));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(group, group.rows.slice(1)));
  });

  it("ignores a concurrent apply and allows retry after the in-flight result fails", async () => {
    const group = makeGroup(2);
    let releaseFirst!: (result: boolean) => void;
    const onApply = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {releaseFirst = resolve;}))
      .mockResolvedValueOnce(true);
    render(<ReviewRuleGroups groups={[group]} conflicts={[]} focusTargetId="bank-review" onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", {name: /Revisar grupo/}));

    const apply = screen.getByRole("button", {name: "Incorporar 2 filas"});
    fireEvent.click(apply);
    await waitFor(() => expect(apply).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);

    releaseFirst(false);
    await waitFor(() => expect(apply).not.toHaveAttribute("aria-busy"));
    fireEvent.click(apply);
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
  });

  it("keeps individual conflicts separate and explains an empty group list", () => {
    const onApply = vi.fn();
    const {rerender} = render(<ReviewRuleGroups groups={[]} conflicts={[]} focusTargetId="bank-review" onApply={onApply} />);
    expect(screen.getByText("No hay grupos homogéneos listos. Las filas siguen disponibles para revisión individual.")).toBeInTheDocument();

    rerender(<ReviewRuleGroups groups={[]} conflicts={[conflict()]} focusTargetId="bank-review" onApply={onApply} />);
    expect(screen.queryByText("No hay grupos homogéneos listos. Las filas siguen disponibles para revisión individual.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("1 filas con reglas en conflicto o revisión individual"));
    expect(screen.getByText("Varias reglas coinciden con categorías distintas.")).toBeInTheDocument();
    expect(screen.getByText("Estas filas siguen en la cola individual y no se incorporarán desde un grupo.")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});
