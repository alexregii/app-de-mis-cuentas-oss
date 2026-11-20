import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent} from "react";
import {Loader2} from "lucide-react";
import {euro, todayInputValue} from "../../format";
import {transactionIntentHref} from "../../shared/lib/transactionIntent";
import type {Account} from "../../shared/model/accounts";
import type {LiquidityAccountForecast, LiquidityCashflow, LiquidityForecast} from "../../shared/model/planning";
import {ErrorBanner, Panel, SectionHeader} from "../../shared/components/ui";
import {Button} from "../../ui/controls/Button";
import type {AppNavigation} from "../../app/contracts";
import {planningApi} from "./api";
import {prepareLiquidityScenario, topLiquidityCauses, type LiquidityScenario} from "./liquidityScenario";

type LiquidityFilters = {accountId: string; dateFrom: string; dateTo: string; scenario: LiquidityScenario};

const UNKNOWN_REASON_COPY: Record<string, string> = {
  bank_connection_not_authorized: "La conexión bancaria ya no está autorizada.",
  bank_sync_not_healthy: "La sincronización bancaria ha fallado o sigue en curso.",
  bank_authorization_expired: "La autorización bancaria ha caducado.",
  bank_sync_stale: "La última sincronización tiene 23 horas o más; sincroniza el banco y vuelve a comprobar.",
  unsupported_account_currency: "Esta cuenta no tiene una moneda compatible con la previsión en euros.",
  conflicting_balance_cuts: "Hay dos cortes de saldo recientes que no coinciden.",
  reconciliation_difference_after_balance_cut: "Hay una diferencia de conciliación posterior al saldo inicial.",
  no_verified_balance_cut: "No hay un saldo inicial verificable para esta cuenta.",
  bank_rows_unreviewed_after_balance_cut: "Hay movimientos bancarios pendientes de revisar después del saldo inicial.",
  overdue_recurring_occurrence: "Hay un pago recurrente vencido que todavía no está resuelto.",
  confirmed_recurring_without_active_transaction: "Un recurrente confirmado no tiene un movimiento activo asociado.",
  transfer_pair_incomplete: "Un traspaso no tiene sus dos movimientos vinculados.",
};

const addDays = (dateValue: string, days: number) => {
  const result = new Date(`${dateValue}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const routeUrl = (key: string) => new URL(key || window.location.href, window.location.origin);

function readFilters(url: URL, accounts: Account[], today: string): LiquidityFilters {
  const params = url.searchParams;
  const account = params.get("liquidity_account");
  const scenario = params.get("liquidity_scenario");
  return {
    accountId: account ?? String(accounts.find((item) => item.active && item.bank_link)?.id ?? accounts.find((item) => item.active)?.id ?? ""),
    dateFrom: params.get("liquidity_from") ?? today,
    dateTo: params.get("liquidity_to") ?? addDays(today, 29),
    scenario: scenario === "conservador" ? "conservador" : "base",
  };
}

const hasSavedFilters = (url: URL) => ["liquidity_account", "liquidity_from", "liquidity_to"].every((key) => url.searchParams.has(key));

const filtersKey = ({accountId, dateFrom, dateTo, scenario}: LiquidityFilters) => `${accountId}|${dateFrom}|${dateTo}|${scenario}`;

function filterError(filters: LiquidityFilters, accounts: Account[], today: string) {
  const accountId = Number(filters.accountId);
  if (!Number.isInteger(accountId) || !accounts.some((account) => account.active && account.id === accountId)) {
    return "Elige una cuenta activa para consultar la previsión.";
  }
  if (!validDate(filters.dateFrom) || !validDate(filters.dateTo)) return "Indica fechas válidas para la previsión.";
  if (filters.dateFrom < today) return "El rango debe empezar hoy o en una fecha futura.";
  if (filters.dateTo < filters.dateFrom) return "La fecha final no puede ser anterior a la inicial.";
  if ((Date.parse(`${filters.dateTo}T00:00:00Z`) - Date.parse(`${filters.dateFrom}T00:00:00Z`)) / 86400000 >= 90 || filters.dateTo > addDays(today, 89)) {
    return "El rango puede cubrir como máximo 90 días desde hoy.";
  }
  return "";
}

const formatDate = (date: string, options: Intl.DateTimeFormatOptions = {day: "numeric", month: "short"}) =>
  new Intl.DateTimeFormat("es-ES", options).format(new Date(`${date}T00:00:00`));

const eventState = (flow: LiquidityCashflow) => flow.state === "confirmed" ? "Confirmado" : "Previsto";

function movementHref(flow: LiquidityCashflow) {
  const kind = flow.kind === "income" || flow.kind === "expense" ? flow.kind : undefined;
  return transactionIntentHref({account: flow.account_id, date_from: flow.date, date_to: flow.date, kind});
}

function recurringHref(flow: LiquidityCashflow, filters: LiquidityFilters) {
  const params = new URLSearchParams({
    tab: "planning",
    plan_month: flow.date.slice(0, 7),
    liquidity_account: filters.accountId,
    liquidity_from: filters.dateFrom,
    liquidity_to: filters.dateTo,
    liquidity_scenario: filters.scenario,
  });
  if (flow.date >= filters.dateFrom && flow.date <= filters.dateTo) params.set("liquidity_day", flow.date);
  return `/?${params.toString()}#planning-recurring-${flow.source_id}`;
}

function readSelectedDate(url: URL, filters: LiquidityFilters) {
  const day = url.searchParams.get("liquidity_day") || "";
  return validDate(day) && day >= filters.dateFrom && day <= filters.dateTo ? day : "";
}

function flowHref(flow: LiquidityCashflow, filters: LiquidityFilters) {
  return flow.state === "confirmed" ? movementHref(flow) : recurringHref(flow, filters);
}

function handleFlowLinkClick(event: MouseEvent<HTMLAnchorElement>, flow: LiquidityCashflow, filters: LiquidityFilters, navigate: AppNavigation["navigate"]) {
  if (flow.state === "confirmed" || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.currentTarget.target) return;
  const url = new URL(recurringHref(flow, filters), window.location.origin);
  event.preventDefault();
  navigate("planning", {search: url.searchParams, hash: url.hash, history: "push"});
}

function FlowList({flows, filters, label, navigate}: {flows: LiquidityCashflow[]; filters: LiquidityFilters; label: string; navigate: AppNavigation["navigate"]}) {
  if (!flows.length) return <p className="planning-liquidity-empty-detail">No hay flujos en esta fecha.</p>;
  return <ul className="planning-liquidity-flows" aria-label={label}>{flows.map((flow) => (
    <li key={`${flow.state}-${flow.source_id}-${flow.date}-${flow.kind}`}>
      <span className={`planning-liquidity-flow-state ${flow.state === "confirmed" ? "confirmed" : "forecast"}`}>{eventState(flow)}</span>
      <span className="planning-liquidity-flow-copy"><strong>{flow.description}</strong><small>{flow.kind === "income" ? "Ingreso" : flow.kind === "expense" ? "Gasto" : "Traspaso"} · {formatDate(flow.date, {day: "numeric", month: "long"})}</small></span>
      <strong className={`money ${flow.signed_amount < 0 ? "negative" : "positive"}`}>{euro(flow.signed_amount)}</strong>
      <a href={flowHref(flow, filters)} onClick={(event) => handleFlowLinkClick(event, flow, filters, navigate)}>{flow.state === "confirmed" ? "Ver movimientos" : "Ver recurrente"}</a>
    </li>
  ))}</ul>;
}

function accountProvenance(account: LiquidityAccountForecast) {
  const {kind, cut_date: cutDate} = account.provenance;
  if (kind === "bank_booked_balance") return `Saldo contable del banco · corte ${cutDate ? formatDate(cutDate, {day: "numeric", month: "long", year: "numeric"}) : "sin fecha"}.`;
  if (kind === "reconciled_statement") return `Extracto conciliado · corte ${cutDate ? formatDate(cutDate, {day: "numeric", month: "long", year: "numeric"}) : "sin fecha"}.`;
  return "Saldo inicial reconstruido desde el ledger.";
}

export function PlanningLiquidityPanel({accounts, routeKey, navigate}: {accounts: Account[]; routeKey: string; navigate: AppNavigation["navigate"]}) {
  const today = todayInputValue();
  const maxDate = addDays(today, 89);
  const currentUrl = useMemo(() => routeUrl(routeKey), [routeKey]);
  const activeAccounts = useMemo(() => accounts.filter((account) => account.active), [accounts]);
  const initialFilters = useMemo(() => readFilters(currentUrl, activeAccounts, today), [currentUrl, activeAccounts, today]);
  const [draft, setDraft] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [activated, setActivated] = useState(() => hasSavedFilters(currentUrl));
  const [selectedDate, setSelectedDate] = useState(readSelectedDate(currentUrl, initialFilters));
  const [forecast, setForecast] = useState<LiquidityAccountForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const lastRouteFilters = useRef(filtersKey(initialFilters));
  const dirty = filtersKey(draft) !== filtersKey(applied);
  const draftError = filterError(draft, activeAccounts, today);
  const appliedError = filterError(applied, activeAccounts, today);
  const appliedAccount = activeAccounts.find((account) => String(account.id) === applied.accountId);
  const preparedAccount = useMemo(
    () => forecast ? prepareLiquidityScenario(forecast, applied.scenario) : null,
    [forecast, applied.scenario],
  );
  const causes = useMemo(() => preparedAccount ? topLiquidityCauses(preparedAccount) : [], [preparedAccount]);
  const selectedDay = preparedAccount?.daily_series.find((day) => day.date === selectedDate)
    ?? preparedAccount?.daily_series.find((day) => day.date === (preparedAccount.first_deficit_date ?? preparedAccount.minimum_date))
    ?? preparedAccount?.daily_series[0]
    ?? null;

  useEffect(() => {
    const next = readFilters(currentUrl, activeAccounts, today);
    const nextKey = filtersKey(next);
    if (nextKey !== lastRouteFilters.current) {
      lastRouteFilters.current = nextKey;
      setDraft(next);
      setApplied(next);
      setActivated(hasSavedFilters(currentUrl));
    }
    setSelectedDate(readSelectedDate(currentUrl, next));
  }, [currentUrl, activeAccounts, today]);

  useEffect(() => {
    if (!activated || dirty || appliedError || !appliedAccount) {
      setForecast(null);
      setLoading(false);
      setRequestError("");
      return;
    }
    let active = true;
    setLoading(true);
    setRequestError("");
    setForecast(null);
    planningApi.liquidity(appliedAccount.id, applied.dateFrom, applied.dateTo)
      .then((response: LiquidityForecast) => {
        if (!active) return;
        const account = response.accounts.find((item) => item.account_id === appliedAccount.id);
        if (!account) throw new Error("El servidor no devolvió la cuenta seleccionada.");
        setForecast(account);
      })
      .catch((error: unknown) => {
        if (active) setRequestError(error instanceof Error ? error.message : "No se pudo cargar la previsión.");
      })
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [activated, appliedAccount, applied.dateFrom, applied.dateTo, appliedError, dirty, retryToken]);

  useEffect(() => {
    if (!preparedAccount || selectedDate) return;
    setSelectedDate(preparedAccount.first_deficit_date ?? preparedAccount.minimum_date ?? preparedAccount.daily_series[0]?.date ?? "");
  }, [preparedAccount, selectedDate]);

  const writeRoute = useCallback((filters: LiquidityFilters, day: string | null) => {
    const params = new URLSearchParams(currentUrl.searchParams);
    params.delete("__appEntry");
    params.set("liquidity_account", filters.accountId);
    params.set("liquidity_from", filters.dateFrom);
    params.set("liquidity_to", filters.dateTo);
    params.set("liquidity_scenario", filters.scenario);
    if (day) params.set("liquidity_day", day);
    else params.delete("liquidity_day");
    navigate("planning", {search: params, history: "replace"});
  }, [currentUrl, navigate]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || draftError) return;
    lastRouteFilters.current = filtersKey(draft);
    setApplied(draft);
    setActivated(true);
    setSelectedDate("");
    setRequestError("");
    writeRoute(draft, null);
    setRetryToken((value) => value + 1);
  };

  const changeScenario = (scenario: LiquidityScenario) => setDraft((current) => ({...current, scenario}));

  const selectDate = (date: string) => {
    setSelectedDate(date);
    writeRoute(applied, date);
  };

  if (!activeAccounts.length) {
    return <Panel className="planning-liquidity-panel"><SectionHeader title="Liquidez diaria" detail="Previsión por cuenta a cierre de cada día." /><p>No hay cuentas activas para calcular una previsión.</p></Panel>;
  }

  return <Panel className="planning-liquidity-panel" aria-busy={loading}>
    <SectionHeader title="Liquidez diaria" detail="Comprueba cuándo baja el saldo y qué pagos lo explican." />
    <p className="planning-liquidity-cache-note">La previsión se consulta online y no se guarda en este dispositivo.</p>
    <form className="planning-liquidity-filters" aria-busy={loading} onSubmit={applyFilters}>
      <label><span>Cuenta</span><select className="ui-select" aria-label="Cuenta de liquidez" value={draft.accountId} onChange={(event) => setDraft((current) => ({...current, accountId: event.target.value}))}>
        <option value="">Selecciona una cuenta</option>
        {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select></label>
      <label><span>Desde</span><input className="ui-input" aria-label="Desde" type="date" min={today} max={maxDate} value={draft.dateFrom} onChange={(event) => setDraft((current) => ({...current, dateFrom: event.target.value}))} /></label>
      <label><span>Hasta</span><input className="ui-input" aria-label="Hasta" type="date" min={draft.dateFrom > today ? draft.dateFrom : today} max={maxDate} value={draft.dateTo} onChange={(event) => setDraft((current) => ({...current, dateTo: event.target.value}))} /></label>
      <label><span>Escenario</span><select className="ui-select" aria-label="Escenario de liquidez" value={draft.scenario} onChange={(event) => changeScenario(event.target.value === "conservador" ? "conservador" : "base")}>
        <option value="base">Base</option>
        <option value="conservador">Conservador</option>
      </select></label>
      <Button type="submit" variant="primary" aria-disabled={loading || Boolean(draftError)} aria-busy={loading}>
        {loading ? "Calculando…" : activated ? "Actualizar previsión" : "Calcular previsión"}
      </Button>
    </form>
    <p className="planning-liquidity-scenario-note" aria-live="polite">{draft.scenario === "conservador" ? "El escenario conservador excluye ingresos previstos y mantiene los gastos previstos." : "El escenario base incluye movimientos confirmados y previsiones recurrentes pendientes."}</p>
    {!activated && !dirty && !draftError ? <p className="planning-liquidity-prompt">Pulsa «Calcular previsión» para solicitar los saldos de este rango.</p> : null}
    {draftError ? <p className="planning-liquidity-validation" role="alert">{draftError}</p> : null}
    {dirty && !draftError ? <p className="planning-liquidity-validation" role="status">Pulsa «Actualizar previsión» para aplicar estos filtros.</p> : null}
    {requestError ? <div className="planning-liquidity-error"><ErrorBanner message={`${requestError} No se muestra una previsión guardada.`} /><Button variant="secondary" aria-disabled={loading} onClick={() => setRetryToken((value) => value + 1)}>Reintentar</Button></div> : null}
    {loading ? <p className="planning-liquidity-loading" role="status"><Loader2 aria-hidden="true" className="spin" />Calculando previsión de liquidez…</p> : null}
    {!loading && !dirty && !requestError && preparedAccount?.status === "unknown" ? <div className="planning-liquidity-unknown" role="status">
      <strong>Saldo desconocido; no se puede demostrar cobertura suficiente.</strong>
      <ul>{(preparedAccount.unknown_reasons.length ? preparedAccount.unknown_reasons : ["unknown_data_coverage"]).map((reason) => <li key={reason}>{UNKNOWN_REASON_COPY[reason] ?? "Hay datos sin resolver para esta cuenta."}</li>)}</ul>
      <div className="inline-actions"><Button variant="secondary" aria-disabled={loading} onClick={() => setRetryToken((value) => value + 1)}>Volver a comprobar</Button>{appliedAccount ? <Button variant="default" onClick={() => navigate("accounts", {search: new URLSearchParams([["account", String(appliedAccount.id)]])})}>Revisar cuenta</Button> : null}</div>
    </div> : null}
    {!loading && !dirty && !requestError && preparedAccount?.status === "known" ? <>
      <div className={`planning-liquidity-outcome${preparedAccount.first_deficit_date ? " has-deficit" : ""}`} aria-live="polite">
        <strong>{preparedAccount.first_deficit_date ? `Primer déficit: ${formatDate(preparedAccount.first_deficit_date, {day: "numeric", month: "long", year: "numeric"})}` : "No se prevé saldo negativo en este rango."}</strong>
        <span>Saldo mínimo <b className={`money ${(preparedAccount.minimum_balance ?? 0) < 0 ? "negative" : ""}`}>{euro(preparedAccount.minimum_balance ?? 0)}</b>{preparedAccount.minimum_date ? ` · ${formatDate(preparedAccount.minimum_date, {day: "numeric", month: "long"})}` : ""}</span>
        <small>{accountProvenance(preparedAccount)} Los saldos son cierres diarios; no se conoce el orden intradía.</small>
      </div>
      <section className="planning-liquidity-causes" aria-labelledby="planning-liquidity-causes-title">
        <h3 id="planning-liquidity-causes-title">{preparedAccount.starting_balance !== null && preparedAccount.starting_balance < 0 ? "Cargos que reducen más el saldo" : preparedAccount.first_deficit_date ? "Qué empuja el saldo hacia el déficit" : "Qué reduce más el saldo"}</h3>
        {preparedAccount.starting_balance !== null && preparedAccount.starting_balance < 0 ? <p>El saldo ya estaba por debajo de cero al inicio del rango.{causes.length ? " Estos cargos lo reducen aún más." : ""}</p> : null}
        {causes.length ? <ol>{causes.map((flow) => (
          <li key={`${flow.state}-${flow.source_id}-${flow.date}-${flow.kind}`}>
            <span className={`planning-liquidity-flow-state ${flow.state === "confirmed" ? "confirmed" : "forecast"}`}>{eventState(flow)} · {formatDate(flow.date)}</span>
            <span className="planning-liquidity-flow-copy"><strong>{flow.description}</strong><small>{flow.kind === "expense" ? "Gasto" : "Traspaso"}</small></span>
            <strong className="money negative">{euro(flow.signed_amount)}</strong>
            <a href={flowHref(flow, applied)} onClick={(event) => handleFlowLinkClick(event, flow, applied, navigate)}>{flow.state === "confirmed" ? "Ver movimientos" : "Ver recurrente"}</a>
          </li>
        ))}</ol> : preparedAccount.starting_balance !== null && preparedAccount.starting_balance < 0 ? null : <p>No hay cargos previstos que expliquen una bajada en este rango.</p>}
      </section>
      {selectedDay ? <section className="planning-liquidity-day-detail" aria-labelledby="planning-liquidity-day-title">
        <h3 id="planning-liquidity-day-title">Detalle del {formatDate(selectedDay.date, {day: "numeric", month: "long", year: "numeric"})}</h3>
        <p>Saldo al cierre <strong className="money">{euro(selectedDay.closing_balance ?? 0)}</strong></p>
        <FlowList flows={selectedDay.cashflows} filters={applied} label={`Flujos del ${formatDate(selectedDay.date, {day: "numeric", month: "long"})}`} navigate={navigate} />
      </section> : null}
      <details className="planning-liquidity-days">
        <summary>Ver cierres diarios ({preparedAccount.daily_series.length} días)</summary>
        <div className="planning-liquidity-table-wrap"><table>
          <caption className="sr-only">Previsión de saldo diario de {preparedAccount.name}</caption>
          <thead><tr><th scope="col">Día</th><th scope="col">Saldo al cierre</th><th scope="col">Flujos</th></tr></thead>
          <tbody>{preparedAccount.daily_series.map((day) => {
            const selected = selectedDay?.date === day.date;
            const deficit = preparedAccount.first_deficit_date === day.date;
            const projected = day.cashflows.filter((flow) => flow.state !== "confirmed").length;
            const flowCount = day.cashflows.length;
            return <tr className={selected ? "selected" : ""} key={day.date}>
              <th scope="row"><button type="button" aria-pressed={selected} onClick={() => selectDate(day.date)}>{formatDate(day.date, {weekday: "short", day: "numeric", month: "short"})}{deficit ? <span className="planning-liquidity-deficit-tag">Déficit</span> : null}</button></th>
              <td className="money">{euro(day.closing_balance ?? 0)}</td>
              <td>{flowCount ? `${flowCount} ${flowCount === 1 ? "flujo" : "flujos"}${projected ? ` · ${projected} previsto${projected === 1 ? "" : "s"}` : ""}` : "Sin flujos"}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </details>
    </> : null}
  </Panel>;
}
