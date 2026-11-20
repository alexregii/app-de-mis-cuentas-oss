import {useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction} from "react";
import type {AppNavigation} from "../../app/contracts";
import {todayInputValue} from "../../format";
import type {Budget, PlanningPayload} from "../../shared/model/planning";

export type PreparedBudgetTarget = {
  key: string;
  month: string;
  categoryId: number;
  categoryName: string;
  existingBudget: Budget | null;
};

export type PreparedBudgetIssue = {
  message: string;
  categoryId?: number;
  retry?: boolean;
};

type PreparedBudgetRequest =
  | {kind: "invalid-category"}
  | {kind: "invalid-month"; categoryId: number}
  | {kind: "target"; categoryId: number; month: string};

type PreparedBudgetRouteArgs = {
  routeKey: string;
  selectedMonth: string;
  setSelectedMonth: Dispatch<SetStateAction<string>>;
  selectedMonthRef: MutableRefObject<string>;
  isActive: boolean;
  planning: PlanningPayload | null;
  loading: boolean;
  load: (month?: string, fresh?: boolean) => Promise<void>;
  navigate: AppNavigation["navigate"];
};

export const isValidPlanMonth = (value: string | null): value is string => Boolean(
  value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) > 0,
);

export const initialPlanMonth = () => {
  const value = new URLSearchParams(window.location.search).get("plan_month");
  return isValidPlanMonth(value) ? value : todayInputValue().slice(0, 7);
};

function parsePreparedBudgetRequest(routeKey: string): PreparedBudgetRequest | null {
  const params = new URL(routeKey || window.location.href).searchParams;
  const rawIds = params.getAll("budget_category");
  if (rawIds.length === 0) return null;
  if (rawIds.length !== 1 || !/^[1-9]\d*$/.test(rawIds[0])) return {kind: "invalid-category"};
  const categoryId = Number(rawIds[0]);
  if (!Number.isSafeInteger(categoryId)) return {kind: "invalid-category"};
  const rawMonths = params.getAll("plan_month");
  if (rawMonths.length !== 1 || !isValidPlanMonth(rawMonths[0])) return {kind: "invalid-month", categoryId};
  return {kind: "target", categoryId, month: rawMonths[0]};
}

export function usePreparedBudgetRoute({
  routeKey,
  selectedMonth,
  setSelectedMonth,
  selectedMonthRef,
  isActive,
  planning,
  loading,
  load,
  navigate,
}: PreparedBudgetRouteArgs) {
  const route = useMemo(() => new URL(routeKey || window.location.href), [routeKey]);
  const preparedRequest = useMemo(() => parsePreparedBudgetRequest(route.href), [route]);
  const wasActive = useRef(isActive);
  const previousRouteKey = useRef(routeKey);

  useEffect(() => {
    if (route.searchParams.get("tab") !== "planning") return;
    const value = route.searchParams.get("plan_month");
    const month = isValidPlanMonth(value) ? value : todayInputValue().slice(0, 7);
    selectedMonthRef.current = month;
    setSelectedMonth((current) => current === month ? current : month);
  }, [route, routeKey, selectedMonthRef, setSelectedMonth]);

  useEffect(() => {
    const becameActive = isActive && !wasActive.current;
    wasActive.current = isActive;
    if (!becameActive || route.searchParams.get("tab") !== "planning") return;
    const value = route.searchParams.get("plan_month");
    const month = isValidPlanMonth(value) ? value : todayInputValue().slice(0, 7);
    if (month !== selectedMonth) {
      selectedMonthRef.current = month;
      setSelectedMonth(month);
      return;
    }
    void load(month, true).catch(() => undefined);
  }, [isActive, load, route, routeKey, selectedMonth, selectedMonthRef, setSelectedMonth]);

  useEffect(() => {
    const routeChanged = previousRouteKey.current !== routeKey;
    previousRouteKey.current = routeKey;
    if (route.searchParams.get("tab") !== "planning" || preparedRequest?.kind === "invalid-month") return;
    const rawMonths = route.searchParams.getAll("plan_month");
    const requestedMonth = rawMonths.length === 1 && isValidPlanMonth(rawMonths[0])
      ? rawMonths[0]
      : todayInputValue().slice(0, 7);
    if (routeChanged && requestedMonth !== selectedMonth) return;

    const params = new URLSearchParams(route.searchParams);
    if (selectedMonth === todayInputValue().slice(0, 7) && !params.has("budget_category")) params.delete("plan_month");
    else params.set("plan_month", selectedMonth);
    if (params.toString() !== route.searchParams.toString()) {
      navigate("planning", {search: params, history: "replace"});
    }
  }, [navigate, preparedRequest, route, routeKey, selectedMonth]);

  const clearPreparedBudgetRoute = useCallback(() => {
    const params = new URLSearchParams(route.searchParams);
    params.delete("budget_category");
    if (!isValidPlanMonth(params.get("plan_month"))) {
      if (selectedMonth === todayInputValue().slice(0, 7)) params.delete("plan_month");
      else params.set("plan_month", selectedMonth);
    }
    navigate("planning", {search: params, history: "replace"});
  }, [navigate, route, selectedMonth]);

  let preparedBudget: PreparedBudgetTarget | null = null;
  let issue: PreparedBudgetIssue | null = null;
  let pending = false;
  if (preparedRequest?.kind === "invalid-month") {
    issue = {message: "El mes del presupuesto preparado no es válido. Elige un mes válido y selecciona una categoría activa.", categoryId: preparedRequest.categoryId};
  } else if (preparedRequest?.kind === "invalid-category") {
    issue = {message: "La categoría del presupuesto preparado no es válida. Elige una categoría activa."};
  } else if (preparedRequest?.kind === "target") {
    if (loading || !planning) {
      pending = true;
    } else if (planning.period.month !== preparedRequest.month) {
      issue = {message: "No se pudieron comprobar los datos de ese mes. Reintenta la carga antes de preparar el presupuesto.", retry: true};
    } else {
      const category = planning.categories.find((item) => item.id === preparedRequest.categoryId && item.active && item.kind === "expense");
      if (!category) {
        issue = {
          message: "La categoría ya no está disponible como gasto activo. Puedes elegir otra categoría o revisar la clasificación.",
          categoryId: preparedRequest.categoryId,
        };
      } else {
        preparedBudget = {
          key: `${preparedRequest.month}:${preparedRequest.categoryId}`,
          month: preparedRequest.month,
          categoryId: preparedRequest.categoryId,
          categoryName: category.display_name,
          existingBudget: planning.budgets.find((budget) => budget.month === preparedRequest.month && budget.category.id === preparedRequest.categoryId) ?? null,
        };
      }
    }
  }

  return {preparedBudget, issue, pending, clearPreparedBudgetRoute};
}
