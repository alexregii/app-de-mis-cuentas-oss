import {type FormEvent, useCallback, useEffect, useRef, useState} from "react";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {ArrowLeft, Download, Pencil, RefreshCw} from "lucide-react";
import {euro, formatDate, formatDateTimeShort} from "../../format";
import {ErrorBanner, LoadingPanel, Panel, SectionHeader} from "../../shared/components/ui";
import type {AccountDetail, ReconciliationSnapshot} from "../../shared/model/accounts";
import {MoneyAmount} from "../../ui/finance/MoneyAmount";
import {TransactionRow} from "../../ui/finance/TransactionRow";
import {toLedgerItem} from "../../shared/adapters/transactionLedgerItem";
import {accountsApi} from "./api";
import {FormField, Input} from "../../ui/controls/FormField";
import {Button, TextButton} from "../../ui/controls/Button";
import {OverflowMenu, OverflowMenuItem} from "../../ui/controls/OverflowMenu";
import {motionEase} from "../../shared/lib/motion";

const readOnlyLedgerCapabilities = {edit: false, archive: false, reopen: false} as const;
const bankBalanceTypeLabels: Record<string, string> = {
  CLBD: "Contable · cierre",
  ITBD: "Contable · intradía",
  CLAV: "Disponible · cierre",
  ITAV: "Disponible · intradía",
};
const formatObservedAt = (value: string) => {
  const observedAt = new Date(value);
  return Number.isFinite(observedAt.getTime())
    ? formatDateTimeShort(observedAt)
    : "No disponible";
};

export function AccountDetailView({
  accountId,
  privateAmounts = false,
  onBack,
  onEdit,
  onOpenTransactions,
  onOpenReview = () => undefined,
  onSync,
}: {
  accountId: number;
  privateAmounts?: boolean;
  onBack: () => void;
  onEdit: (detail: AccountDetail["account"]) => void;
  onOpenTransactions: () => void;
  onOpenReview?: (search?: URLSearchParams) => void;
  onSync: (connectionId: number) => Promise<void>;
}) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const detailRequest = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const localDate = () => new Date().toLocaleDateString("en-CA");
  const [statementDate, setStatementDate] = useState(localDate);
  const [statementBalance, setStatementBalance] = useState("");
  const [reconciliation, setReconciliation] = useState<ReconciliationSnapshot | null>(null);
  const [reconciliationError, setReconciliationError] = useState("");
  const [savingReconciliation, setSavingReconciliation] = useState(false);
  const savingReconciliationRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const load = useCallback(async () => {
    const requestId = ++detailRequest.current;
    setLoading(true);
    setError("");
    try {
      const nextDetail = await accountsApi.accountDetail(accountId);
      if (requestId === detailRequest.current) setDetail(nextDetail);
    } catch (cause) {
      if (requestId === detailRequest.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar la cuenta.");
    } finally {
      if (requestId === detailRequest.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    setStatementDate(localDate());
    setStatementBalance("");
    setReconciliation(null);
    setReconciliationError("");
    setSyncError("");
    void load();
  }, [load]);

  const currentDetail = detail?.account.id === accountId ? detail : null;
  if (error && !currentDetail) return <div className="account-detail-error"><ErrorBanner message={error} /><Button variant="secondary" onClick={() => {void load();}}>Reintentar</Button></div>;
  if (!currentDetail) return <LoadingPanel label="Cargando detalle de cuenta…" />;
  const {account, connection, period, recent} = currentDetail;
  const latestReconciliation = reconciliation || currentDetail.latest_reconciliation;
  const diagnosis = latestReconciliation?.diagnosis;
  const bankLink = account.bank_link;
  const hasVerifiableBankBalance = Boolean(bankLink
    && bankLink.remote_balance !== null
    && bankLink.remote_balance_type
    && bankLink.remote_balance_currency
    && bankLink.balance_updated_at);
  const connectionNeedsAttention = Boolean(connection?.last_error) || ["error", "failed", "needs_reconnect", "reconnect_required"].includes(connection?.sync_status || "");
  const syncAccount = async () => {
    if (!connection) return;
    setSyncError("");
    setSyncing(true);
    try {
      await onSync(connection.id);
      await load();
    } catch {
      setSyncError("No se pudo iniciar la sincronización. Inténtalo de nuevo.");
    } finally {
      setSyncing(false);
    }
  };
  const saveReconciliation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement) submitter.focus({preventScroll: true});
    if (savingReconciliationRef.current) return;
    setReconciliationError("");
    savingReconciliationRef.current = true;
    setSavingReconciliation(true);
    try {
      const result = await accountsApi.saveReconciliation(accountId, {date: statementDate, statement_balance: statementBalance});
      setReconciliation(result.snapshot);
      setStatementBalance("");
    } catch (cause) {
      setReconciliationError(cause instanceof Error ? cause.message : "No se pudo guardar la reconciliación.");
    } finally {
      savingReconciliationRef.current = false;
      setSavingReconciliation(false);
    }
  };
  return <div className="view-stack account-detail" aria-busy={loading}>
    <header className="account-detail-header">
      <TextButton className="account-detail-back" onClick={onBack}><ArrowLeft aria-hidden="true" /> Volver a cuentas</TextButton>
      <div className="account-detail-identity">
        <i style={{backgroundColor: account.color}} aria-hidden="true" />
        <div><h1>{account.name}</h1><p>{account.kind_display} · {account.bank_link ? `Vinculada a ${account.bank_link.display_name}` : "Cuenta manual"}</p></div>
      </div>
      <div className="accounts-summary" aria-label={`Resumen de ${account.name}`}><dl>
        <div><dt>Saldo actual</dt><dd><MoneyAmount value={account.balance} privateAmounts={privateAmounts} label="Saldo actual" /></dd></div>
        <div><dt>Saldo inicial</dt><dd><MoneyAmount value={account.opening_balance} privateAmounts={privateAmounts} label="Saldo inicial" /></dd></div>
        <div><dt>Ingresos del periodo</dt><dd><MoneyAmount value={period.income} privateAmounts={privateAmounts} label="Ingresos del periodo" /></dd></div>
        <div><dt>Gastos del periodo</dt><dd><MoneyAmount value={period.expense} privateAmounts={privateAmounts} label="Gastos del periodo" /></dd></div>
      </dl></div>
      <nav className="inline-actions account-detail-actions" aria-label="Acciones de la cuenta">
        <Button variant="primary" className="account-detail-open-ledger" onClick={onOpenTransactions}>Ver movimientos</Button>
        <OverflowMenu className="account-detail-more-actions" label={`Acciones de ${account.name}`} triggerText="Más acciones" align="start">
          {connection ? <OverflowMenuItem disabled={syncing} onClick={syncAccount}><RefreshCw aria-hidden="true" />{syncing ? "Sincronizando…" : "Sincronizar"}</OverflowMenuItem> : null}
          <OverflowMenuItem onClick={() => onEdit(account)}><Pencil aria-hidden="true" />Editar</OverflowMenuItem>
          <OverflowMenuItem as="a" href={`/exportar/excel/?account=${account.id}`}><Download aria-hidden="true" />Exportar</OverflowMenuItem>
        </OverflowMenu>
      </nav>
    </header>
    {error ? <div className="account-detail-error"><ErrorBanner message={`${error} Se mantienen los datos anteriores.`} /><Button variant="secondary" onClick={() => {void load();}}>Reintentar</Button></div> : null}
    <div className="account-detail-workbench">
      <Panel className={`account-detail-bank ${connectionNeedsAttention || syncError ? "needs-attention" : ""}`}>
        <SectionHeader title="Estado bancario" detail={connection ? `${connection.bank_name} · ${connection.sync_status_display}` : "Sin conexión bancaria"} />
        <div className="account-detail-status" aria-live="polite"><i aria-hidden="true" />
          <div><strong className="account-detail-status-label">{connection ? `${connection.bank_name} · ${connection.sync_status_display}` : "Sin conexión bancaria"}</strong><p>{syncError || (connection ? connection.last_error || `Última sincronización: ${connection.last_synced_at_display || "sin datos"}` : "Los movimientos y el saldo se actualizan manualmente.")}</p>{syncError ? <TextButton disabled={syncing} onClick={syncAccount}>Reintentar sincronización</TextButton> : null}</div>
        </div>
        {bankLink ? <dl className="account-detail-bank-balance" aria-label="Saldo informado por el banco">
          {!hasVerifiableBankBalance ? <div><dt>Saldo informado por el banco</dt><dd>No disponible con procedencia verificable.</dd></div> : <>
            <div><dt>Saldo informado por el banco</dt><dd><MoneyAmount value={bankLink.remote_balance!} privateAmounts={privateAmounts} label="Saldo informado por el banco" /></dd></div>
            <div><dt>Tipo</dt><dd>{bankBalanceTypeLabels[bankLink.remote_balance_type] || "No informado"}</dd></div>
            <div><dt>Fecha de referencia</dt><dd>{bankLink.remote_balance_reference_date ? formatDate(bankLink.remote_balance_reference_date) : "No informada"}</dd></div>
            <div><dt>Consultado</dt><dd>{formatObservedAt(bankLink.balance_updated_at)}</dd></div>
          </>}
        </dl> : null}
      </Panel>
      <Panel className={`account-detail-reconciliation ${latestReconciliation?.status !== "reconciled" ? "needs-attention" : ""}`}>
        <SectionHeader title="Reconciliación" detail={latestReconciliation ? `Último extracto: ${formatDate(latestReconciliation.date)}` : "Verifica el saldo sin alterar movimientos"} />
        <form className="account-detail-reconciliation-form" onSubmit={saveReconciliation}>
          <FormField label="Fecha del extracto"><Input type="date" value={statementDate} max={localDate()} onChange={(event) => setStatementDate(event.target.value)} required /></FormField>
          <FormField label="Saldo según el extracto"><Input type="number" inputMode="decimal" step="0.01" value={statementBalance} onChange={(event) => setStatementBalance(event.target.value)} required /></FormField>
          <Button variant="secondary" type="submit" aria-disabled={savingReconciliation || undefined} aria-busy={savingReconciliation || undefined} onClick={(event) => event.currentTarget.focus({preventScroll: true})}>{savingReconciliation ? "Guardando…" : "Comprobar saldo"}</Button>
        </form>
        {reconciliationError ? <ErrorBanner message={reconciliationError} /> : null}
        <AnimatePresence initial={false} mode="wait">
          {latestReconciliation ? <motion.div key={`reconciliation-${latestReconciliation.id}`} className="account-detail-reconciliation-transition" initial={reduceMotion ? false : {height: 0, opacity: 0}} animate={{height: "auto", opacity: 1}} exit={{height: 0, opacity: 0}} transition={reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase}}>
            <div className="account-detail-reconciliation-result" aria-live="polite">
              <strong className={latestReconciliation.status === "reconciled" ? "positive" : "negative"}>{latestReconciliation.status === "reconciled" ? "El extracto cuadra con el ledger." : latestReconciliation.status === "stale" ? "El ledger histórico cambió; vuelve a conciliar." : "Hay una diferencia pendiente de revisar."}</strong>
              <dl>
                <div><dt>Extracto</dt><dd>{euro(latestReconciliation.statement_balance)}</dd></div>
                <div><dt>Ledger al comprobar</dt><dd>{euro(latestReconciliation.ledger_balance)}</dd></div>
                {latestReconciliation.stale ? <div><dt>Cambio posterior</dt><dd className="negative">{euro(latestReconciliation.ledger_change)}</dd></div> : null}
                <div><dt>Diferencia</dt><dd className={latestReconciliation.difference === 0 ? "positive" : "negative"}>{euro(latestReconciliation.difference)}</dd></div>
              </dl>
              {(diagnosis?.pending_bank || diagnosis?.pending_imports || diagnosis?.possible_duplicates) ? <>
                <p className="account-detail-reconciliation-hint">Candidatos: {diagnosis.pending_bank} bancarios pendientes, {diagnosis.pending_imports} importaciones pendientes y {diagnosis.possible_duplicates} posibles duplicados.</p>
                <nav className="account-detail-reconciliation-actions" aria-label="Colas relacionadas con la conciliación">
                  {diagnosis.pending_bank > 0 ? <TextButton onClick={() => onOpenReview(new URLSearchParams("focus=bank-review"))}>Revisar movimientos bancarios pendientes ({diagnosis.pending_bank})</TextButton> : null}
                  {diagnosis.pending_imports > 0 ? <TextButton onClick={() => onOpenReview(new URLSearchParams("focus=csv-review"))}>Revisar importaciones pendientes ({diagnosis.pending_imports})</TextButton> : null}
                  {diagnosis.possible_duplicates > 0 ? <TextButton onClick={() => onOpenReview(new URLSearchParams("focus=review-attention"))}>Revisar posibles duplicados ({diagnosis.possible_duplicates})</TextButton> : null}
                </nav>
              </> : null}
              <TextButton onClick={onOpenTransactions}>Revisar movimientos de esta cuenta</TextButton>
            </div>
          </motion.div> : <motion.div key="reconciliation-empty" className="account-detail-reconciliation-transition" initial={reduceMotion ? false : {height: 0, opacity: 0}} animate={{height: "auto", opacity: 1}} exit={{height: 0, opacity: 0}} transition={reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase}}>
            <p className="account-detail-reconciliation-hint">Introduce el saldo de un extracto para registrar una comprobación reproducible.</p>
          </motion.div>}
        </AnimatePresence>
      </Panel>
      <Panel className="account-detail-activity">
        <SectionHeader title="Movimientos recientes" detail={`${formatDate(period.start)} a ${formatDate(period.end)}`} />
        {recent.length ? <div data-account-recent-transactions>{recent.map((transaction) => <TransactionRow key={transaction.id} item={toLedgerItem(transaction)} capabilities={readOnlyLedgerCapabilities} compact privateAmounts={privateAmounts} />)}</div> : <div className="empty-state empty-state--plain">No hay movimientos confirmados todavía.</div>}
      </Panel>
    </div>
  </div>;
}
