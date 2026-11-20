import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {statisticsApi as api} from "../api";
import {hasFreshPrefetchedGet} from "../../../shared/api/client";
import {navigateRoute, parseRoute} from "../../../app/navigation";
import {defaultStatisticsRange, validateStatisticsRange} from "../statisticsFormatting";
import type {
  MonthStatisticsPayload,
  StatisticsBasis,
  StatisticsDateRange,
  StatisticsPayload,
  StatisticsPeriod,
} from "../types";

const presetPeriods = new Set<StatisticsPeriod>(["3", "6", "12", "custom"]);
const bases = new Set<StatisticsBasis>(["analytics", "all"]);
const monthPattern = /^\d{4}-\d{2}$/;

const readLocationState = () => {
  const params = new URLSearchParams(window.location.search);
  const rawPeriod = params.get("period") as StatisticsPeriod | null;
  const rawBasis = params.get("basis") as StatisticsBasis | null;
  const fallbackRange = defaultStatisticsRange();
  const range = {
    from: params.get("date_from") || fallbackRange.from,
    to: params.get("date_to") || fallbackRange.to,
  };
  const period = rawPeriod && presetPeriods.has(rawPeriod) ? rawPeriod : "12";
  const basis = rawBasis && bases.has(rawBasis) ? rawBasis : "analytics";
  const rawMonth = params.get("month") || "";
  return {
    period,
    basis,
    range,
    selectedMonth: monthPattern.test(rawMonth) ? rawMonth : "",
  };
};

const syncLocation = ({
  period,
  basis,
  range,
  month,
}: {
  period: StatisticsPeriod;
  basis: StatisticsBasis;
  range: StatisticsDateRange | null;
  month: string;
}) => {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", "statistics");
  params.set("period", period);
  params.set("basis", basis);
  if (range) {
    params.set("date_from", range.from);
    params.set("date_to", range.to);
  } else {
    params.delete("date_from");
    params.delete("date_to");
  }
  if (month) params.set("month", month);
  else params.delete("month");
  navigateRoute({tab: "statistics", search: params, history: "replace"});
};

export function useStatisticsData(isActive = true) {
  const initial = useRef(readLocationState()).current;
  const [period, setPeriod] = useState<StatisticsPeriod>(initial.period);
  const [customEditorOpen, setCustomEditorOpen] = useState(initial.period === "custom");
  const [draftRange, setDraftRange] = useState<StatisticsDateRange>(initial.range);
  const [appliedRange, setAppliedRange] = useState<StatisticsDateRange>(initial.range);
  const [basis, setBasisState] = useState<StatisticsBasis>(initial.basis);
  const [data, setData] = useState<StatisticsPayload | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [selectedMonth, setSelectedMonthState] = useState(initial.selectedMonth);
  const [monthData, setMonthData] = useState<MonthStatisticsPayload | null>(null);
  const [reportPending, setReportPending] = useState(true);
  const [monthPending, setMonthPending] = useState(false);
  const [customApplyPending, setCustomApplyPending] = useState(false);
  const customApplyPendingRef = useRef(false);
  const [reportError, setReportError] = useState("");
  const [monthError, setMonthError] = useState("");
  const [rangeError, setRangeError] = useState(() => initial.period === "custom" ? validateStatisticsRange(initial.range) : "");
  const [reportReloadToken, setReportReloadToken] = useState(0);
  const [monthReloadToken, setMonthReloadToken] = useState(0);
  const statisticsRequest = useRef(0);
  const monthRequest = useRef(0);
  const wasActive = useRef(isActive);
  const wasActiveForRefresh = useRef(isActive);

  useLayoutEffect(() => {
    const becameActive = isActive && !wasActive.current;
    wasActive.current = isActive;
    if (!becameActive) return;
    const routeParams = new URLSearchParams(window.location.search);
    const hasExplicitStatisticsState = routeParams.has("period") || routeParams.has("basis");
    if (!hasExplicitStatisticsState) return;
    const restored = readLocationState();
    setPeriod(restored.period);
    setBasisState(restored.basis);
    setDraftRange(restored.range);
    setAppliedRange(restored.range);
    setCustomEditorOpen(restored.period === "custom");
    setRangeError(restored.period === "custom" ? validateStatisticsRange(restored.range) : "");
    setSelectedMonthState(restored.selectedMonth);
  }, [isActive]);

  useEffect(() => {
    const becameActive = isActive && !wasActiveForRefresh.current;
    wasActiveForRefresh.current = isActive;
    const params = new URLSearchParams({period, basis});
    if (period === "custom") {
      params.set("date_from", appliedRange.from);
      params.set("date_to", appliedRange.to);
    }
    if (becameActive && dataRef.current && !hasFreshPrefetchedGet(`/api/statistics/?${params.toString()}`)) {
      setReportReloadToken((current) => current + 1);
    }
  }, [appliedRange.from, appliedRange.to, basis, isActive, period]);

  useEffect(() => {
    const restoreFromHistory = () => {
      if (parseRoute().tab !== "statistics") return;
      const restored = readLocationState();
      setPeriod(restored.period);
      setBasisState(restored.basis);
      setDraftRange(restored.range);
      setAppliedRange(restored.range);
      setCustomEditorOpen(restored.period === "custom");
      setRangeError(restored.period === "custom" ? validateStatisticsRange(restored.range) : "");
      monthRequest.current += 1;
      setMonthData(null);
      setMonthError("");
      setSelectedMonthState(restored.selectedMonth);
    };
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, []);

  useEffect(() => {
    if (period === "custom") {
      const validationMessage = validateStatisticsRange(appliedRange);
      if (validationMessage) {
        setRangeError(validationMessage);
        setCustomApplyPending(false);
        setReportPending(false);
        return;
      }
    }

    const requestId = ++statisticsRequest.current;
    const params = new URLSearchParams({period, basis});
    if (period === "custom") {
      params.set("date_from", appliedRange.from);
      params.set("date_to", appliedRange.to);
    }
    setReportPending(true);
    setReportError("");
    api.statistics(params)
      .then((payload) => {
        if (requestId !== statisticsRequest.current) return;
        setData(payload);
        setRangeError("");
        setSelectedMonthState((current) => {
          if (!current || payload.monthly_series.some((item) => item.month === current)) return current;
          monthRequest.current += 1;
          setMonthData(null);
          return "";
        });
      })
      .catch((exc) => {
        if (requestId === statisticsRequest.current) {
          setReportError(exc instanceof Error ? exc.message : "No se pudieron cargar las estadísticas.");
        }
      })
      .finally(() => {
        if (requestId === statisticsRequest.current) {
          setReportPending(false);
          customApplyPendingRef.current = false;
          setCustomApplyPending(false);
        }
      });
  }, [appliedRange.from, appliedRange.to, basis, period, reportReloadToken]);

  useEffect(() => {
    const matchingScope = data?.scope.period === period && data.scope.basis === basis;
    if (!isActive || parseRoute().tab !== "statistics") return;
    const range = period === "custom"
      ? appliedRange
      : matchingScope && data ? {from: data.scope.date_from, to: data.scope.date_to} : null;
    syncLocation({period, basis, range, month: selectedMonth});
  }, [appliedRange, basis, data, isActive, period, selectedMonth]);

  useEffect(() => {
    if (!selectedMonth || !data || reportPending) {
      if (!selectedMonth) {
        setMonthData(null);
        setMonthError("");
      }
      return;
    }
    const matchesActiveReport = data.scope.period === period
      && data.scope.basis === basis
      && (period !== "custom" || (data.scope.date_from === appliedRange.from && data.scope.date_to === appliedRange.to));
    if (!matchesActiveReport) return;
    const point = data.monthly_series.find((item) => item.month === selectedMonth);
    if (!point) return;
    const requestId = ++monthRequest.current;
    setMonthPending(true);
    setMonthError("");
    api.monthStatistics(point.detail_url)
      .then((payload) => {
        if (requestId === monthRequest.current) setMonthData(payload);
      })
      .catch((exc) => {
        if (requestId === monthRequest.current) {
          setMonthError(exc instanceof Error ? exc.message : "No se pudo cargar el detalle mensual.");
        }
      })
      .finally(() => {
        if (requestId === monthRequest.current) setMonthPending(false);
      });
  }, [appliedRange.from, appliedRange.to, basis, data, monthReloadToken, period, reportPending, selectedMonth]);

  const selectPreset = useCallback((value: Exclude<StatisticsPeriod, "custom">) => {
    setRangeError("");
    setCustomEditorOpen(false);
    monthRequest.current += 1;
    setMonthData(null);
    setMonthError("");
    setPeriod(value);
  }, []);

  const openCustomEditor = useCallback(() => {
    setCustomEditorOpen(true);
    setRangeError("");
  }, []);

  const applyCustomRange = useCallback(() => {
    if (customApplyPendingRef.current) return false;
    const validationMessage = validateStatisticsRange(draftRange);
    setRangeError(validationMessage);
    if (validationMessage) {
      customApplyPendingRef.current = false;
      setCustomApplyPending(false);
      return false;
    }
    customApplyPendingRef.current = true;
    setCustomApplyPending(true);
    monthRequest.current += 1;
    setMonthData(null);
    setMonthError("");
    setAppliedRange(draftRange);
    setPeriod("custom");
    setReportReloadToken((value) => value + 1);
    return true;
  }, [draftRange]);

  const setBasis = useCallback((value: StatisticsBasis) => {
    monthRequest.current += 1;
    setMonthData(null);
    setMonthError("");
    setBasisState(value);
  }, []);
  const resetFilters = useCallback(() => {
    setRangeError("");
    setCustomEditorOpen(false);
    monthRequest.current += 1;
    setMonthData(null);
    setMonthError("");
    setPeriod("12");
    setBasisState("analytics");
    setSelectedMonthState("");
  }, []);
  const selectMonth = useCallback((value: string) => {
    monthRequest.current += 1;
    setMonthData(null);
    setMonthError("");
    setSelectedMonthState(value);
  }, []);

  return {
    appliedRange,
    applyCustomRange,
    basis,
    customEditorOpen,
    customApplyPending,
    data,
    draftRange,
    monthData,
    monthError,
    monthPending,
    openCustomEditor,
    period,
    rangeError,
    reportError,
    reportPending,
    retryMonth: () => setMonthReloadToken((value) => value + 1),
    retryReport: () => setReportReloadToken((value) => value + 1),
    resetFilters,
    selectedMonth,
    selectMonth,
    selectPreset,
    setBasis,
    setDraftRange,
  };
}
