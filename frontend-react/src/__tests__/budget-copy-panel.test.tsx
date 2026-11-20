import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {ComponentProps} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ApiError} from "../shared/api/client";
import {setPrivacyMode} from "../shared/lib/privacy";
import type {BudgetCopyPreview} from "../features/planning/api";
import {BudgetCopyPanel} from "../features/planning/BudgetCopyPanel";

const apiMock = vi.hoisted(() => ({previewBudgetCopy: vi.fn(), copyBudgets: vi.fn()}));
vi.mock("../features/planning/api", () => ({planningApi: apiMock}));

const preview: BudgetCopyPreview = {
  ok: true,
  source_month: "2026-07",
  target_month: "2026-08",
  preview_token: "signed-preview",
  items: [
    {category: {id: 1, display_name: "Comida", active: true, kind: "expense"}, source_limit: "125.00", destination_limit: null, status: "new", can_copy: true, selected_by_default: true},
    {category: {id: 2, display_name: "Vivienda", active: true, kind: "expense"}, source_limit: "300.00", destination_limit: "275.00", status: "existing", can_copy: true, selected_by_default: false},
    {category: {id: 3, display_name: "Archivada", active: false, kind: "expense"}, source_limit: "40.00", destination_limit: null, status: "inactive", can_copy: false, selected_by_default: false},
  ],
};

const renderPanel = (overrides: Partial<ComponentProps<typeof BudgetCopyPanel>> = {}) => {
  const props = {
    targetMonth: "2026-08",
    onClose: vi.fn(),
    onPendingChange: vi.fn(),
    onApplied: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<BudgetCopyPanel {...props} />);
  return props;
};

beforeEach(() => {
  vi.clearAllMocks();
  setPrivacyMode(false);
  apiMock.previewBudgetCopy.mockResolvedValue(preview);
  apiMock.copyBudgets.mockResolvedValue({ok: true, created: 1, updated: 1, unchanged: 0, budget_ids: [21, 22]});
});

afterEach(() => setPrivacyMode(false));

describe("BudgetCopyPanel", () => {
  it("previews new, existing and inactive limits without writing or selecting overwrites", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Mes de origen"), {target: {value: "2026-07"}});
    fireEvent.click(screen.getByRole("button", {name: "Ver vista previa"}));

    expect(await screen.findByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 1 categoría inactiva.")).toBeInTheDocument();
    expect(apiMock.previewBudgetCopy).toHaveBeenCalledWith("2026-07", "2026-08");
    expect(apiMock.copyBudgets).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", {name: "Copiar presupuesto de Comida"})).toBeChecked();
    expect(screen.getByRole("checkbox", {name: "Sobrescribir presupuesto de Vivienda"})).not.toBeChecked();
    expect(screen.getByRole("checkbox", {name: "Copiar presupuesto de Archivada"})).toBeDisabled();
  });

  it("applies only the selected limits, preserves focus, and reports the refresh result", async () => {
    let finishCopy!: () => void;
    apiMock.copyBudgets.mockReturnValueOnce(new Promise((resolve) => {
      finishCopy = () => resolve({ok: true, created: 1, updated: 1, unchanged: 0, budget_ids: [21, 22]});
    }));
    const props = renderPanel();
    fireEvent.change(screen.getByLabelText("Mes de origen"), {target: {value: "2026-07"}});
    fireEvent.click(screen.getByRole("button", {name: "Ver vista previa"}));
    await screen.findByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 1 categoría inactiva.");
    fireEvent.click(screen.getByRole("checkbox", {name: "Sobrescribir presupuesto de Vivienda"}));

    const copy = screen.getByRole("button", {name: "Copiar 2 presupuestos"});
    copy.focus();
    fireEvent.click(copy);
    await waitFor(() => expect(copy).toHaveAttribute("aria-busy", "true"));
    expect(copy).toHaveFocus();
    expect(apiMock.copyBudgets).toHaveBeenCalledWith("signed-preview", [1, 2]);
    finishCopy();

    await waitFor(() => expect(props.onApplied).toHaveBeenCalledWith(21, "Copia completada: 1 presupuesto nuevo, 1 presupuesto actualizado."));
    expect(props.onPendingChange).toHaveBeenNthCalledWith(1, true);
    expect(props.onPendingChange).toHaveBeenLastCalledWith(false);
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledWith(false);
  });

  it("does not show limits when global privacy is enabled", async () => {
    setPrivacyMode(true);
    apiMock.previewBudgetCopy.mockResolvedValueOnce({...preview, items: preview.items.filter((item) => item.status === "existing")});
    renderPanel();
    fireEvent.change(screen.getByLabelText("Mes de origen"), {target: {value: "2026-07"}});
    fireEvent.click(screen.getByRole("button", {name: "Ver vista previa"}));

    await screen.findByText("Vista previa: 0 presupuestos nuevos, 1 presupuesto existente y 0 categorías inactivas.");
    expect(screen.queryByText(/125\.00|300\.00|275\.00|40\.00/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Selecciona presupuestos"})).toHaveAttribute("aria-disabled", "true");
    const amounts = [...document.querySelectorAll(".budget-copy-item-copy small")].map((item) => item.textContent || "");
    expect(amounts).toHaveLength(1);
    expect(amounts.every((value) => value.includes("•••• €"))).toBe(true);
  });

  it("clears a stale preview and returns focus to the source month field", async () => {
    apiMock.copyBudgets.mockRejectedValueOnce(new ApiError("El presupuesto de destino cambió.", 409));
    renderPanel();
    const sourceMonth = screen.getByLabelText("Mes de origen");
    fireEvent.change(sourceMonth, {target: {value: "2026-07"}});
    fireEvent.click(screen.getByRole("button", {name: "Ver vista previa"}));
    await screen.findByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 1 categoría inactiva.");
    fireEvent.click(screen.getByRole("button", {name: "Copiar 1 presupuesto"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Genera una nueva vista previa antes de reintentar.");
    await waitFor(() => expect(sourceMonth).toHaveFocus());
    expect(screen.queryByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 1 categoría inactiva.")).not.toBeInTheDocument();
  });

  it("preserves selection and preview after a network error so the same copy can be retried", async () => {
    apiMock.copyBudgets
      .mockRejectedValueOnce(new Error("Sin conexión."))
      .mockResolvedValueOnce({ok: true, created: 0, updated: 0, unchanged: 1, budget_ids: [21]});
    const props = renderPanel();
    fireEvent.change(screen.getByLabelText("Mes de origen"), {target: {value: "2026-07"}});
    fireEvent.click(screen.getByRole("button", {name: "Ver vista previa"}));
    await screen.findByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 1 categoría inactiva.");
    const copy = screen.getByRole("button", {name: "Copiar 1 presupuesto"});
    fireEvent.click(copy);
    await screen.findByRole("alert");
    expect(screen.getByRole("checkbox", {name: "Copiar presupuesto de Comida"})).toBeChecked();
    expect(screen.getByText("Vista previa: 1 presupuesto nuevo, 1 presupuesto existente y 1 categoría inactiva.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Copiar 1 presupuesto"}));
    await waitFor(() => expect(props.onApplied).toHaveBeenCalledWith(21, "Copia completada: 1 presupuesto ya coincidía con el origen."));
    expect(apiMock.copyBudgets).toHaveBeenCalledTimes(2);
    expect(apiMock.copyBudgets).toHaveBeenNthCalledWith(1, "signed-preview", [1]);
    expect(apiMock.copyBudgets).toHaveBeenNthCalledWith(2, "signed-preview", [1]);
  });
});
