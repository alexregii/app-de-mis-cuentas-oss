import {act, renderHook} from "@testing-library/react";
import {useRef, useState} from "react";
import {describe, expect, it, vi} from "vitest";
import {todayInputValue} from "../format";
import type {PlanningPayload} from "../shared/model/planning";
import {usePreparedBudgetRoute} from "../features/planning/usePreparedBudgetRoute";

const planning = (categoryActive = true, month = "2026-07") => ({
  period: {month},
  categories: [{id: 2, display_name: "Comida", active: categoryActive, kind: "expense"}],
  budgets: [{id: 9, month, category: {id: 2, display_name: "Comida"}, limit: 300}],
} as unknown as PlanningPayload);

function renderRoute(routeKey: string, payload: PlanningPayload | null, initialMonth = "2026-07") {
  const navigate = vi.fn();
  const load = vi.fn().mockResolvedValue(undefined);
  const rendered = renderHook(() => {
    const [selectedMonth, setSelectedMonth] = useState(initialMonth);
    const selectedMonthRef = useRef(selectedMonth);
    const route = usePreparedBudgetRoute({
      routeKey,
      selectedMonth,
      setSelectedMonth,
      selectedMonthRef,
      isActive: true,
      planning: payload,
      loading: false,
      load,
      navigate,
    });
    return {selectedMonth, ...route};
  });
  return {...rendered, navigate, load};
}

describe("usePreparedBudgetRoute", () => {
  it("resolves a route to the matching month, active category and existing budget", () => {
    const {result, navigate, load} = renderRoute("http://localhost/?tab=planning&plan_month=2026-07&budget_category=2", planning());

    expect(result.current.preparedBudget).toMatchObject({
      month: "2026-07",
      categoryId: 2,
      categoryName: "Comida",
      existingBudget: {id: 9, limit: 300},
    });
    expect(result.current.issue).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("reports retired categories without preparing a budget", () => {
    const {result} = renderRoute("http://localhost/?tab=planning&plan_month=2026-07&budget_category=2", planning(false));

    expect(result.current.preparedBudget).toBeNull();
    expect(result.current.issue?.message).toContain("La categoría ya no está disponible");
  });

  it("preserves an explicit current month when the route prepares a budget", () => {
    const currentMonth = todayInputValue().slice(0, 7);
    const routeKey = `http://localhost/?tab=planning&plan_month=${currentMonth}&budget_category=2`;
    const {result, navigate} = renderRoute(routeKey, planning(true, currentMonth), currentMonth);

    expect(result.current.preparedBudget).toMatchObject({month: currentMonth, categoryId: 2});
    expect(result.current.selectedMonth).toBe(currentMonth);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejects invalid month parameters and clears the stale route without a write", () => {
    const {result, navigate, load} = renderRoute("http://localhost/?tab=planning&plan_month=2026-13&budget_category=2", null);

    expect(result.current.issue?.message).toContain("El mes del presupuesto preparado no es válido");
    expect(result.current.preparedBudget).toBeNull();
    act(() => result.current.clearPreparedBudgetRoute());

    expect(navigate).toHaveBeenCalledOnce();
    const transition = navigate.mock.calls[0]?.[1];
    const search = transition?.search as URLSearchParams;
    expect(search.has("budget_category")).toBe(false);
    expect(search.get("plan_month")).not.toBe("2026-13");
    expect(load).not.toHaveBeenCalled();
  });
});
