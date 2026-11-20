import {fireEvent, render, screen, within} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {ReviewTransactionCard} from "../ui/finance/ReviewTransactionCard";
import {reviewInlineDisplayValue} from "../ui/finance/reviewInlineFormatting";
import type {ReviewDecision, ReviewDisplayStatus, ReviewHistory, ReviewItem, ReviewPreparation} from "../ui/finance/ReviewItem";

const account = {id: "account-1", name: "Cuenta principal", color: "var(--entity-1)"};
const category = {id: "category-1", name: "Restaurantes", color: "var(--entity-2)"};

function item(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "review-card-contract",
    description: "Reembolso de restaurante",
    date: "2026-09-09",
    signedAmount: 42.5,
    kind: "income",
    account,
    category,
    sourceLabel: "Banco",
    isRefund: true,
    attachmentCount: 1,
    status: "changed",
    changes: [{field: "amount", previous: 40, current: 42.5}],
    issues: [],
    ...overrides,
  };
}

describe("ReviewTransactionCard reusable contract", () => {
  it("representa historia, preparación, decisión, origen, reembolso, cambios e incidencias", () => {
    render(
      <ReviewTransactionCard
        item={item()}
        statusLabel="Preparado"
        preparationKey="prepared"
        historyKey="changed"
        historyLabel="Modificado"
        decisionKey="pending"
        decisionLabel="Pendiente"
        attentionIssues={[{code: "description-review", message: "Confirma el concepto."}]}
        decisionActions={<button className="button primary" type="button">Incorporar</button>}
      />,
    );

    const card = screen.getByRole("article");
    expect(card).toHaveAttribute("data-review-state", "changed");
    expect(card).toHaveAttribute("data-review-preparation", "prepared");
    expect(card).toHaveAttribute("data-review-decision", "pending");
    expect(card).toHaveTextContent("Modificado");
    expect(card).toHaveTextContent("Preparado");
    expect(card).toHaveTextContent("Pendiente");
    expect(card).toHaveTextContent("Banco");
    expect(card.querySelector(".ui-review-history")).toHaveTextContent("Modificado");
    expect(card.querySelector(".ui-review-source-label")).toHaveTextContent("Banco");
    expect(card.querySelector(".ui-review-history")).not.toHaveTextContent("Banco");
    expect(card).toHaveTextContent("Reembolso");
    expect(card).toHaveTextContent("1 adjunto");
    expect(card).toHaveTextContent("Necesita atención");
    expect(card).toHaveTextContent("Confirma el concepto.");
    expect(within(card).getByRole("button", {name: "Ver cambios"})).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", {name: "Ver cambios"}));
    expect(within(card).getByLabelText(/Valor anterior:.*Valor actual:/)).toBeInTheDocument();
    expect(card).toHaveTextContent("Importe");
    expect(card).toHaveTextContent("Cuenta principal");
    expect(card).toHaveTextContent("Restaurantes");
  });

  it.each<{
    status: ReviewDisplayStatus;
    preparation: ReviewPreparation;
    history: ReviewHistory;
    decision: ReviewDecision;
  }>([
    {status: "ready", preparation: "blocked", history: "unchanged", decision: "pending"},
    {status: "blocked", preparation: "prepared", history: "new", decision: "incorporated"},
    {status: "new", preparation: "needs_attention", history: "new", decision: "pending"},
    {status: "changed", preparation: "blocked", history: "changed", decision: "pending"},
    {status: "needs_attention", preparation: "prepared", history: "changed", decision: "pending"},
  ])("mantiene independientes estado $status, preparación $preparation, historia $history y decisión $decision", ({status, preparation, history, decision}) => {
    render(
      <ReviewTransactionCard
        item={item({id: `review-${status}-${preparation}`, status})}
        preparationKey={preparation}
        historyKey={history}
        decisionKey={decision}
      />,
    );
    const card = screen.getByRole("article");
    const preparationAttribute = card.getAttribute("data-review-preparation");
    expect(card).toHaveAttribute("data-review-state", status);
    expect(card).toHaveAttribute("data-review-preparation", preparation);
    expect(card).toHaveAttribute("data-review-history", history);
    expect(card).toHaveAttribute("data-review-decision", decision);
    expect(["prepared", "needs_attention", "blocked"]).toContain(preparationAttribute);
    expect(["new", "changed", "ready"]).not.toContain(preparationAttribute);
  });

  it("expone el estado seleccionado y evita doble alternancia desde el checkbox", () => {
    const onSelect = vi.fn();
    render(
      <ReviewTransactionCard
        item={item({id: "review-selectable"})}
        preparationKey="prepared"
        selectionMode
        selected
        onSelect={onSelect}
        selectionControl={<label><input type="checkbox" aria-label="Seleccionar" /><span>Seleccionar</span></label>}
      />,
    );

    const card = screen.getByRole("article");
    expect(card).toHaveAttribute("data-review-selected", "true");
    expect(card).toHaveAttribute("data-review-selection-mode", "true");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card).getByRole("checkbox"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("comparte el formato de importe y fecha sin mezclar los fallbacks de contexto ni exponer importes privados", () => {
    const reviewItem = item({changes: [
      {field: "amount", previous: 40, current: 42.5},
      {field: "date", previous: "2026-09-08", current: "2026-09-09"},
      {field: "date", previous: "", current: "2026-09-10"},
      {field: "kind", previous: "income", current: "expense"},
    ]});
    const {container, rerender} = render(<ReviewTransactionCard item={reviewItem} preparationKey="prepared" />);

    fireEvent.click(screen.getByRole("button", {name: "Ver cambios"}));
    expect(container).toHaveTextContent("42,50");
    expect(container).toHaveTextContent("09/09/2026");
    expect(container).toHaveTextContent("Sin dato");
    expect(container).toHaveTextContent("income");
    expect(reviewInlineDisplayValue("date", "")).toBe("Sin fecha");
    expect(reviewInlineDisplayValue("kind", "income")).toBe("Ingreso");

    rerender(<ReviewTransactionCard item={reviewItem} privateAmounts preparationKey="prepared" />);
    expect(container).toHaveTextContent("••••••");
    expect(container).not.toHaveTextContent("42,50");
  });
});
