import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {act} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {PlanningSavingsGoal} from "../features/planning/PlanningSavingsGoal";
import type {PlanningPayload} from "../shared/model/planning";

const apiMock = vi.hoisted(() => ({updateSavingsGoal: vi.fn()}));
vi.mock("../features/planning/api", () => ({planningApi: apiMock}));

const goal: PlanningPayload["goal"] = {configured: true, active: true, percentage: 15, minimum: 100, target: 100};

describe("PlanningSavingsGoal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.updateSavingsGoal.mockResolvedValue({ok: true, goal});
  });

  it("retiene el foco durante PUT y reintenta solo el GET del margen", async () => {
    let acceptWrite!: () => void;
    let rejectRefresh!: (reason: Error) => void;
    let finishRetry!: () => void;
    apiMock.updateSavingsGoal.mockImplementationOnce(() => new Promise((resolve) => {
      acceptWrite = () => resolve({ok: true, goal: {...goal, percentage: 20}});
    }));
    const refreshMargin = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => {rejectRefresh = reject;}))
      .mockImplementationOnce(() => new Promise((resolve) => {finishRetry = () => resolve(undefined);}));
    const setError = vi.fn();
    const setStatus = vi.fn();
    render(<PlanningSavingsGoal goal={goal} refreshMargin={refreshMargin} setError={setError} setStatus={setStatus} />);
    fireEvent.click(screen.getByRole("button", {name: "Expandir objetivo de ahorro"}));

    const percentage = screen.getByLabelText("Porcentaje");
    fireEvent.change(percentage, {target: {value: "20"}});
    const save = screen.getByRole("button", {name: "Guardar objetivo"});
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(apiMock.updateSavingsGoal).toHaveBeenCalledOnce());
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveFocus();
    fireEvent.click(save);
    expect(apiMock.updateSavingsGoal).toHaveBeenCalledOnce();

    await act(async () => {acceptWrite(); await Promise.resolve();});
    await waitFor(() => expect(refreshMargin).toHaveBeenCalledOnce());
    const firstReadRetry = await screen.findByRole("button", {name: "Actualizando margen…"});
    expect(firstReadRetry).toHaveAttribute("aria-disabled", "true");
    expect(firstReadRetry).toHaveAttribute("aria-busy", "true");
    fireEvent.click(firstReadRetry);
    expect(refreshMargin).toHaveBeenCalledOnce();
    await act(async () => {rejectRefresh(new Error("Plan no disponible")); await Promise.resolve();});
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("Objetivo guardado; margen pendiente de actualizar."));
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(percentage).toHaveValue(20);

    const retryMargin = screen.getByRole("button", {name: "Reintentar actualización del margen"});
    fireEvent.click(retryMargin);
    await waitFor(() => expect(refreshMargin).toHaveBeenCalledTimes(2));
    expect(retryMargin).toHaveAttribute("aria-disabled", "true");
    expect(retryMargin).toHaveAttribute("aria-busy", "true");
    fireEvent.click(retryMargin);
    expect(refreshMargin).toHaveBeenCalledTimes(2);
    await act(async () => {finishRetry(); await Promise.resolve();});
    await waitFor(() => expect(retryMargin).not.toBeInTheDocument());
    expect(setStatus).toHaveBeenLastCalledWith("Objetivo guardado y margen actualizado.");
    expect(screen.getByRole("button", {name: "Expandir objetivo de ahorro"})).toHaveFocus();
    expect(apiMock.updateSavingsGoal).toHaveBeenCalledOnce();
  });

  it("conserva el borrador ante un rechazo del PUT y permite reintentarlo", async () => {
    apiMock.updateSavingsGoal.mockRejectedValueOnce(new Error("No se pudo guardar el objetivo."))
      .mockResolvedValueOnce({ok: true, goal: {...goal, minimum: 180}});
    const refreshMargin = vi.fn().mockResolvedValue(undefined);
    const setError = vi.fn();
    const setStatus = vi.fn();
    render(<PlanningSavingsGoal goal={goal} refreshMargin={refreshMargin} setError={setError} setStatus={setStatus} />);
    fireEvent.click(screen.getByRole("button", {name: "Expandir objetivo de ahorro"}));

    const minimum = screen.getByLabelText("Mínimo mensual");
    fireEvent.change(minimum, {target: {value: "180"}});
    const save = screen.getByRole("button", {name: "Guardar objetivo"});
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(setError).toHaveBeenCalledWith("No se pudo guardar el objetivo."));
    expect(minimum).toHaveValue(180);
    expect(save).toHaveFocus();
    fireEvent.click(save);

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("Objetivo guardado y margen actualizado."));
    expect(apiMock.updateSavingsGoal).toHaveBeenCalledTimes(2);
    expect(refreshMargin).toHaveBeenCalledOnce();
  });
});
