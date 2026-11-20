import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {motion, useReducedMotion} from "motion/react";
import {Repeat2, WalletCards} from "lucide-react";
import {formatMonth, todayInputValue} from "../../format";
import {ViewLoadError} from "../../shared/components/ViewLoadError";
import {ErrorBanner, LoadingPanel, StatusBanner} from "../../shared/components/ui";
import type {Budget, PlanningCalendarPayload, PlanningPayload, RecurringRule} from "../../shared/model/planning";
import {planningApi as api} from "./api";
import {navigateRoute} from "../../app/navigation";
import {PlanningForms} from "./PlanningForms";
import {PlanningAutomationPanel} from "./PlanningForecastPanels";
import {PlanningResults, PlanningTracking} from "./PlanningResults";
import {motionEase} from "../../shared/lib/motion";
import {PlanningSavingsGoal} from "./PlanningSavingsGoal";
import {PlanningCalendar} from "./PlanningCalendar";
import {Button} from "../../ui/controls/Button";
import {focusPlanningResult} from "./focusPlanningResult";
import type {AppNavigation, Tab} from "../../app/contracts";
import {PreparedBudgetRecovery} from "./PreparedBudgetRecovery";
import {PlanningPageHeader} from "./PlanningPageHeader";
import {initialPlanMonth, usePreparedBudgetRoute} from "./usePreparedBudgetRoute";
import {PlanningLiquidityPanel} from "./PlanningLiquidityPanel";
import {PlanningSavingsObjectives} from "./PlanningSavingsObjectives";

type ComposerKind = "budget" | "recurring";

const fallbackNavigate: AppNavigation["navigate"] = (tab: Tab, transition = {}) =>
  navigateRoute({tab, ...transition});

export function PlanningView({openComposerToken = 0, routeKey = "", isActive = true, navigate = fallbackNavigate, navigateToSettings = (search) => navigateRoute({tab: "settings", search})}: {openComposerToken?: number; routeKey?: string; isActive?: boolean; navigate?: AppNavigation["navigate"]; navigateToSettings?: (search: URLSearchParams) => void}) {
  const [selectedMonth, setSelectedMonth] = useState(initialPlanMonth);
  const selectedMonthRef = useRef(selectedMonth);
  const planningLoadRequestRef = useRef(0);
  const planningAppliedRequestRef = useRef(0);
  const planningRevisionRef = useRef(0);
  const [savedResult, setSavedResult] = useState<{kind: ComposerKind; id: number} | null>(null);
  const [planning, setPlanning] = useState<PlanningPayload | null>(null);
  const [calendar, setCalendar] = useState<PlanningCalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [composerChoiceOpen, setComposerChoiceOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{kind: ComposerKind; token: number} | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [budgetCopyPending, setBudgetCopyPending] = useState(false);
  const reduceMotion = useReducedMotion();
  const choiceRef = useRef<HTMLDivElement>(null);
  const lastComposerToken = useRef(openComposerToken);

  useEffect(() => {
    if (openComposerToken === lastComposerToken.current) return;
    lastComposerToken.current = openComposerToken;
    setComposerChoiceOpen(true);
  }, [openComposerToken]);

  useLayoutEffect(() => {
    if (composerChoiceOpen) choiceRef.current?.querySelector<HTMLButtonElement>("button")?.focus({preventScroll: true});
  }, [composerChoiceOpen]);

  useEffect(() => setSavedResult(null), [selectedMonth]);

  const load = useCallback(async (requestedMonth = selectedMonth, fresh = false) => {
    if (requestedMonth !== selectedMonthRef.current) return;
    const requestId = ++planningLoadRequestRef.current;
    const planningRevision = planningRevisionRef.current;
    setLoading(true);
    setError("");
    try {
      const shouldCachePlan = () => requestId === planningLoadRequestRef.current
        && requestedMonth === selectedMonthRef.current && planningRevision === planningRevisionRef.current;
      const plan = await api.planning(requestedMonth, fresh ? {cache: "reload"} : undefined, shouldCachePlan);
      if (requestId !== planningLoadRequestRef.current || requestedMonth !== selectedMonthRef.current) return;
      const monthCalendar = typeof api.calendar === "function" ? await api.calendar(requestedMonth) : null;
      if (requestId !== planningLoadRequestRef.current || requestedMonth !== selectedMonthRef.current) return;
      if (planningRevision === planningRevisionRef.current) {
        setPlanning(plan);
        planningAppliedRequestRef.current = requestId;
      }
      setCalendar(monthCalendar);
    } catch (exception) {
      if (requestId === planningLoadRequestRef.current && requestedMonth === selectedMonthRef.current) {
        setError(exception instanceof Error ? exception.message : "No se pudo cargar el plan.");
      }
      throw exception;
    } finally {
      if (requestId === planningLoadRequestRef.current && requestedMonth === selectedMonthRef.current) setLoading(false);
    }
  }, [selectedMonth]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const refreshMargin = useCallback(async () => {
    const revision = ++planningRevisionRef.current;
    const loadRequestId = planningLoadRequestRef.current;
    let requestedMonth = selectedMonthRef.current;
    let revalidating = false;
    const revalidateCurrentMonth = async () => {
      const currentMonth = selectedMonthRef.current;
      const hadAppliedPlan = planningAppliedRequestRef.current === planningLoadRequestRef.current;
      revalidating = true;
      const revalidation = loadRef.current(currentMonth, true);
      const revalidationRequestId = planningLoadRequestRef.current;
      let loadError: unknown;
      try {
        await revalidation;
      } catch (exception) {
        loadError = exception;
      }
      if (currentMonth !== selectedMonthRef.current) {
        revalidating = false;
        return false;
      }
      const laterLoadStarted = planningLoadRequestRef.current !== revalidationRequestId;
      const latestLoadApplied = planningAppliedRequestRef.current === planningLoadRequestRef.current;
      if (latestLoadApplied || (!laterLoadStarted && hadAppliedPlan)) {
        setError("");
        revalidating = false;
        return true;
      }
      if (loadError) throw loadError;
      throw new Error("No se pudo confirmar el plan actualizado.");
    };
    while (true) {
      try {
        const plan = await api.planning(requestedMonth, {cache: "reload"}, () => loadRequestId === planningLoadRequestRef.current
          && requestedMonth === selectedMonthRef.current && revision === planningRevisionRef.current);
        if (requestedMonth !== selectedMonthRef.current) {
          requestedMonth = selectedMonthRef.current;
          await loadRef.current(requestedMonth);
          if (requestedMonth === selectedMonthRef.current) return;
          continue;
        }
        if (loadRequestId !== planningLoadRequestRef.current || revision !== planningRevisionRef.current) {
          if (await revalidateCurrentMonth()) return;
          requestedMonth = selectedMonthRef.current;
          continue;
        }
        setPlanning(plan);
        planningAppliedRequestRef.current = loadRequestId;
        return;
      } catch (exception) {
        if (revalidating) throw exception;
        if (requestedMonth !== selectedMonthRef.current) {
          requestedMonth = selectedMonthRef.current;
          continue;
        }
        if (loadRequestId !== planningLoadRequestRef.current || revision !== planningRevisionRef.current) {
          if (await revalidateCurrentMonth()) return;
          requestedMonth = selectedMonthRef.current;
          continue;
        }
        throw exception;
      }
    }
  }, []);

  const {preparedBudget, issue: preparedBudgetIssue, pending: preparedBudgetPending, clearPreparedBudgetRoute} = usePreparedBudgetRoute({
    routeKey,
    selectedMonth,
    setSelectedMonth,
    selectedMonthRef,
    isActive,
    planning,
    loading,
    load,
    navigate,
  });

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load, reloadToken]);

  const openComposer = (kind: ComposerKind) => {
    setComposerChoiceOpen(false);
    setFocusRequest({kind, token: Date.now()});
  };

  const openManualBudget = () => {
    clearPreparedBudgetRoute();
    openComposer("budget");
  };

  const savePlanningResult = async (kind: ComposerKind, id: number, message: string, consumePreparedBudget = false) => {
    if (consumePreparedBudget && kind === "budget" && new URL(routeKey || window.location.href).searchParams.has("budget_category")) {
      clearPreparedBudgetRoute();
    }
    setSavedResult({kind, id});
    setStatus(message);
    try {
      await load();
      focusPlanningResult(kind, id);
    } catch {
      setSavedResult(null);
    }
  };

  if (!planning && loading) return <LoadingPanel label="Cargando el plan…" />;
  if (!planning) return <ViewLoadError title="Plan del mes" message={error} onRetry={() => setReloadToken((value) => value + 1)} />;

  const showingRetainedMonth = planning.period.start.slice(0, 7) !== selectedMonth;
  const periodLabel = showingRetainedMonth
    ? planning.period.status === "past" ? `Datos de ${formatMonth(planning.period.start)} · cerrado` : formatMonth(planning.period.start)
    : planning.period.status === "current" ? "Periodo parcial" : planning.period.status === "future" ? "Previsión" : "Periodo cerrado";
  const periodDetails = showingRetainedMonth
    ? planning.period.status === "current" ? `Periodo parcial · datos a ${planning.period.as_of}` : planning.period.status === "future" ? `Previsión calculada a ${planning.period.as_of}` : ""
    : planning.period.status === "current" ? `Datos a ${planning.period.as_of}` : planning.period.status === "future" ? `Calculada a ${planning.period.as_of}` : "";

  return (
    <div className="view-stack planning-view" aria-busy={loading}>
      <PlanningPageHeader
        selectedMonth={selectedMonth}
        periodLabel={periodLabel}
        periodDetails={periodDetails}
        disabled={budgetCopyPending}
        onMonthChange={(month) => {
          selectedMonthRef.current = month;
          setStatus("");
          setSelectedMonth(month);
        }}
      />
      <PreparedBudgetRecovery
        issue={preparedBudgetIssue}
        pending={preparedBudgetPending}
        onChooseManually={openManualBudget}
        onReviewCategory={() => {
          const categoryId = preparedBudgetIssue?.categoryId;
          if (categoryId) navigateToSettings(new URLSearchParams([
            ["settings_section", "classification"],
            ["category", String(categoryId)],
          ]));
        }}
        onRetry={() => setReloadToken((value) => value + 1)}
      />
      {isActive && (error || status) ? createPortal(
        <motion.div
          key={error ? `error:${error}` : `status:${status}`}
          className="planning-feedback"
          initial={reduceMotion ? false : {opacity: 0, y: -4}}
          animate={{opacity: 1, y: 0}}
          transition={reduceMotion ? {duration: 0} : {duration: 0.16, ease: motionEase}}
        >
          {error ? <ErrorBanner message={`${error} Se mantienen los últimos datos cargados.`} /> : <StatusBanner message={status} />}
        </motion.div>,
        document.body,
      ) : null}

      {composerChoiceOpen ? <div className="planning-composer-choice" ref={choiceRef} role="group" aria-label="¿Qué quieres añadir?">
        <strong>¿Qué quieres añadir?</strong>
        <div className="inline-actions">
          <Button variant="primary" onClick={() => openComposer("budget")}><WalletCards aria-hidden="true" />Presupuesto</Button>
          <Button variant="secondary" onClick={() => openComposer("recurring")}><Repeat2 aria-hidden="true" />Recurrente</Button>
        </div>
      </div> : null}

      <PlanningResults planning={planning} /><PlanningLiquidityPanel accounts={planning.accounts} routeKey={routeKey} navigate={navigate} />
      <PlanningSavingsObjectives objectives={planning.savings_objectives} rules={planning.rules} routeKey={routeKey} isActive={isActive} refreshPlan={() => loadRef.current(selectedMonthRef.current, true)} setError={setError} setStatus={setStatus} />
      <PlanningSavingsGoal goal={planning.goal} refreshMargin={refreshMargin} setError={setError} setStatus={setStatus} />
      <PlanningTracking
        planning={planning} selectedMonth={selectedMonth}
        loading={loading}
        savedResult={savedResult}
        onEntryComplete={(kind, id) => setSavedResult((current) => current?.kind === kind && current.id === id ? null : current)}
        load={load}
        setError={setError}
        setStatus={setStatus}
        isActive={isActive} onBudgetCopyPendingChange={setBudgetCopyPending}
        onBudgetCopySaved={(id, message) => savePlanningResult("budget", id, message)}
        onEditBudget={(budget) => {
          setEditingBudget(budget);
          setFocusRequest({kind: "budget", token: Date.now()});
        }}
        onEditRule={(rule) => {
          setEditingRule(rule);
          setFocusRequest({kind: "recurring", token: Date.now()});
        }}
        setup={<PlanningForms
          planning={planning}
          selectedMonth={selectedMonth}
          preparedBudget={preparedBudget}
          editingBudget={editingBudget}
          editingRule={editingRule}
          focusRequest={focusRequest}
          onCancelEdit={(kind) => {
            if (kind === "budget") {
              setEditingBudget(null);
              if (new URL(window.location.href).searchParams.has("budget_category")) clearPreparedBudgetRoute();
            } else setEditingRule(null);
          }}
          onSaved={(kind, id, message) => savePlanningResult(kind, id, message, true)}
        />}
      />
      {calendar ? <><PlanningCalendar calendar={calendar} />{calendar.warning ? <p className="planning-period-note">{calendar.warning}</p> : null}</> : null}
      <PlanningAutomationPanel planning={planning} load={load} setError={setError} setStatus={setStatus} navigateToSettings={navigateToSettings} />
    </div>
  );
}
