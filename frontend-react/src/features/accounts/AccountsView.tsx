import {useEffect, useRef, useState} from "react";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {AlertTriangle, Building2, Loader2, Plus, RefreshCw, Save, Trash2} from "lucide-react";
import {bankingApi} from "../../shared/api/banking";
import {navigateRoute} from "../../app/navigation";
import {accountsApi as api} from "./api";
import {AccountDetailRoute} from "./AccountDetailRoute";
import {AccountCard} from "./AccountCard";
import {revealAccountForm as revealManualAccountForm, useAccountFormSubmission, type AccountFormValues} from "./useAccountFormSubmission";
import {useBankConnectionConnect} from "./useBankConnectionConnect";
import {useBankConnectionRemovalAnchor} from "./useBankConnectionRemovalAnchor";
import {useBankConnectionSync} from "./useBankConnectionSync";
import {MoneyAmount} from "../../ui/finance/MoneyAmount";
import {CollapsiblePanel} from "../../shared/components/CollapsiblePanel";
import {ConfirmDialog} from "../../shared/components/ConfirmDialog";
import {ErrorBanner, LoadingPanel, Panel, SectionHeader, StatusBanner} from "../../shared/components/ui";
import {motionEase} from "../../shared/lib/motion";
import type {Account, Connection} from "../../shared/model/accounts";
import {PageHeader} from "../../ui/layout/PageHeader";
import {Button, IconButton, TextButton} from "../../ui/controls/Button";
import {FormField, Input, Select} from "../../ui/controls/FormField";
type PendingConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<void>;
};

export function AccountsView({
  accounts,
  connections,
  bankingConfigured,
  pendingBankReviewCount, privateAmounts = false,
  onOpenReview,
  onOpenTransactions = () => undefined,
  onNavigateAccount = () => undefined,
  routeKey,
  refresh,
}: {
  accounts: Account[];
  connections: Connection[];
  bankingConfigured: boolean;
  pendingBankReviewCount: number; privateAmounts?: boolean;
  onOpenReview: (search?: URLSearchParams) => void;
  onOpenTransactions?: (href: string) => void;
  onNavigateAccount?: (id: number | null, history?: "push" | "replace") => void;
  routeKey?: string;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<AccountFormValues>({name: "", kind: "checking", opening_balance: "0", color: "#3478f6", active: true});
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [showBankConnect, setShowBankConnect] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const accountFormRef = useRef<HTMLFormElement>(null);
  const focusAddAccountAfterDeleteRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const {createdAccountId: recentlyCreatedAccountId, error: accountFormError, saving: savingAccount, setError: setAccountFormError, submit: saveAccount, accountEntryComplete} = useAccountFormSubmission({accounts, editingAccountId, form, refresh, setEditingAccountId, setForm, setStatus, status});
  const {errors: connectionSyncErrors, isSyncing: isConnectionSyncing, sync: syncConnection} = useBankConnectionSync({connections, refresh, setStatus, status});
  const {authorizationError, bankDirectory, bankSelectRef, connectingBank, directoryError, directoryLoading, retryBankDirectory, selectedBankName, setSelectedBankName, startBankAuthorization} = useBankConnectionConnect({bankingConfigured, showBankConnect});
  const preserveConnectionAnchor = useBankConnectionRemovalAnchor(connections);
  const selectedAccountId = Number(new URL(routeKey || window.location.href).searchParams.get("account")) || null;
  useEffect(() => {
    if (window.location.hash === "#bank-connections") document.getElementById("bank-connections")?.scrollIntoView({block: "start", behavior: reduceMotion ? "auto" : "smooth"});
    const params = new URLSearchParams(window.location.search);
    const notice = params.get("bank_notice");
    const message = params.get("bank_message");
    if (!notice && !message) return;
    if (notice === "connected") {
      setStatus(message || "Cuenta bancaria conectada y sincronizada.");
    } else {
      setError(message || "No se pudo completar la conexión bancaria.");
    }
    params.delete("bank_notice");
    params.delete("bank_message");
    navigateRoute({tab: "accounts", search: params, history: "replace"});
  }, []);

  useEffect(() => {
    if (!connections.some((connection) => connection.sync_status === "syncing")) return;
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [connections, refresh]);

  const accountPanelOpen = accountFormOpen || Boolean(editingAccountId);
  const activeAccounts = accounts.filter((account) => account.active);
  const inactiveAccounts = accounts.filter((account) => !account.active);
  const totalActiveBalance = activeAccounts.reduce((sum, account) => sum + account.balance, 0);
  const linkedAccountCount = accounts.filter((account) => account.bank_link).length;
  const manualAccountCount = accounts.length - linkedAccountCount;
  const attentionConnections = connections.filter((connection) => (
    Boolean(connection.last_error)
      || ["error", "failed", "needs_reconnect", "reconnect_required"].includes(connection.sync_status)
      || ["error", "needs_reconnect", "reconnect_required"].includes(connection.status)
  ));
  const disclosureTransition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  const confirmAccountDeletion = (account: Account) => setPendingConfirmation({
    title: `¿Eliminar la cuenta “${account.name}”?`,
    description: "Solo se eliminará si no contiene movimientos protegidos. Esta acción no se puede deshacer.",
    confirmLabel: "Eliminar cuenta",
    action: async () => {
      await api.deleteAccount(account.id);
      setStatus("Cuenta eliminada.");
      await refresh();
      if (account.active && activeAccounts.length === 1) focusAddAccountAfterDeleteRef.current = true;
    },
  });
  const editAccount = (account: Account) => {
    setEditingAccountId(account.id);
    setAccountFormOpen(true);
    setAccountFormError("");
    setForm({name: account.name, kind: account.kind, opening_balance: String(account.opening_balance), color: account.color, active: account.active});
    revealManualAccountForm(() => accountFormRef.current, true, reduceMotion);
  };
  const confirmBankDisconnect = (connection: Connection) => setPendingConfirmation({
    title: `¿Desconectar ${connection.bank_name}?`,
    description: "La cuenta dejará de sincronizarse hasta que vuelvas a autorizarla. Los movimientos ya registrados se conservarán.",
    confirmLabel: "Desconectar banca",
    action: async () => {
      const clearAnchor = preserveConnectionAnchor(connection.id);
      try {
        await bankingApi.disconnectBank(connection.id);
        setStatus("Conexión bancaria desconectada.");
        await refresh();
      } catch (reason) {
        clearAnchor();
        throw reason;
      }
    },
  });

  if (selectedAccountId) return <AccountDetailRoute accountId={selectedAccountId} privateAmounts={privateAmounts} onBack={(history) => onNavigateAccount(null, history)} onEdit={(account) => { setEditingAccountId(account.id); setAccountFormOpen(true); setAccountFormError(""); setForm({name: account.name, kind: account.kind, opening_balance: String(account.opening_balance), color: account.color, active: account.active}); revealManualAccountForm(() => accountFormRef.current, true, reduceMotion); }} onOpenTransactions={() => onOpenTransactions(`/?tab=transactions&account=${selectedAccountId}`)} onOpenReview={onOpenReview} refresh={refresh} />;

  return (
    <div className="view-stack">
      <PageHeader title="Cuentas" description={activeAccounts.length ? `${activeAccounts.length} cuentas activas con sus saldos actuales.` : "Añade una cuenta para empezar a registrar saldos."}>
        <div className="accounts-summary" aria-label="Resumen de cuentas">
          <dl>
            <div><dt>Saldo en cuentas</dt><dd><MoneyAmount value={totalActiveBalance} privateAmounts={privateAmounts} label="Saldo en cuentas" /></dd></div>
            <div><dt>Activas</dt><dd>{activeAccounts.length}</dd></div>
            <div><dt>Manuales</dt><dd>{manualAccountCount}</dd></div>
            <div><dt>Conectadas</dt><dd>{linkedAccountCount}</dd></div>
          </dl>
          <Button variant="primary" aria-expanded={accountPanelOpen} aria-controls={accountPanelOpen ? "accounts-manual-form" : undefined} onClick={(event) => { event.currentTarget.focus({preventScroll: true}); setEditingAccountId(null); setAccountFormError(""); setAccountFormOpen(true); revealManualAccountForm(() => accountFormRef.current, true, reduceMotion); }}>
            <Plus aria-hidden="true" /> Añadir cuenta
          </Button>
        </div>
      </PageHeader>
      {error ? <ErrorBanner message={error} /> : null}
      {status && status !== "Conexión bancaria desconectada." ? <StatusBanner message={status} /> : null}

      <section className="accounts-registry" aria-labelledby="accounts-registry-title">
        <div className="accounts-section-heading"><div><h2 id="accounts-registry-title">Saldos por cuenta</h2><p>{activeAccounts.length ? "Cuentas activas y su saldo actual." : "Aún no hay cuentas activas."}</p></div><span>{accounts.length} {accounts.length === 1 ? "cuenta" : "cuentas"}</span></div>
        <div className="account-grid">
          {activeAccounts.map((account) => <AccountCard key={account.id} account={account} privateAmounts={privateAmounts} newlyCreated={account.id === recentlyCreatedAccountId} onOpenDetail={() => onNavigateAccount(account.id)} onEdit={() => editAccount(account)} onDelete={() => confirmAccountDeletion(account)} onEntryComplete={() => accountEntryComplete(account.id)} />)}
        </div>
        {inactiveAccounts.length ? <details className="inactive-accounts"><summary>Cuentas inactivas ({inactiveAccounts.length})</summary><div className="account-grid">{inactiveAccounts.map((account) => <AccountCard key={account.id} account={account} inactive privateAmounts={privateAmounts} newlyCreated={account.id === recentlyCreatedAccountId} onOpenDetail={() => onNavigateAccount(account.id)} onEdit={() => editAccount(account)} onDelete={() => confirmAccountDeletion(account)} onEntryComplete={() => accountEntryComplete(account.id)} />)}</div></details> : null}
      </section>

      <div className="accounts-management-grid">
        <Panel id="bank-connections" className={`bank-connections-panel ${attentionConnections.length ? "has-attention" : ""}`}>
          <SectionHeader
            title="Banca conectada"
            detail={connections.length ? `${connections.length} ${connections.length === 1 ? "conexión activa" : "conexiones activas"}.` : undefined}
            action={(
              <div className="inline-actions">
                {pendingBankReviewCount ? <Button variant="secondary" onClick={() => onOpenReview()}>Revisar {pendingBankReviewCount}</Button> : null}
                {bankingConfigured ? (
                  <Button variant="secondary" className="disclosure-button" aria-expanded={showBankConnect} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setShowBankConnect((current) => !current);}}>
                    <Building2 aria-hidden="true" />
                    {showBankConnect ? "Comprimir" : "Nueva banca"}
                  </Button>
                ) : null}
              </div>
            )}
          />
          {attentionConnections.length ? (
            <div className="accounts-attention" role="status">
              <AlertTriangle aria-hidden="true" />
              <div><strong>{attentionConnections.length === 1 ? "Una conexión necesita revisión" : `${attentionConnections.length} conexiones necesitan revisión`}</strong><span>Comprueba el estado antes de volver a importar movimientos.</span></div>
              {pendingBankReviewCount ? <TextButton onClick={() => onOpenReview()}>Abrir revisión</TextButton> : null}
            </div>
          ) : null}
          {!bankingConfigured && !connections.length ? <div className="empty-state empty-state--plain">La banca conectada aún no está configurada en este servidor.</div> : null}
          <AnimatePresence initial={false} mode="wait">
            {!showBankConnect && bankingConfigured && !connections.length ? (
              <motion.div key="bank-summary" className="collapsed-summary" initial={{height: 0, opacity: 0, y: -2}} animate={{height: "auto", opacity: 1, y: 0}} exit={{height: 0, opacity: 0, y: -2}} transition={disclosureTransition}>
                <span>Conecta un banco para importar movimientos sin registrarlos a mano.</span>
              </motion.div>
            ) : null}
            {showBankConnect && bankingConfigured ? (
              <motion.div key="bank-connect" className="collapsible-content" initial={{height: 0, opacity: 0, y: -4}} animate={{height: "auto", opacity: 1, y: 0}} exit={{height: 0, opacity: 0, y: -4}} transition={disclosureTransition}>
                {directoryError ? (
                  <div className="entry-form top-gap">
                    <ErrorBanner message={directoryError} />
                    <Button variant="secondary" aria-disabled={directoryLoading || undefined} aria-busy={directoryLoading || undefined} onClick={(event) => retryBankDirectory(event.currentTarget)}>{directoryLoading ? "Cargando bancos…" : "Reintentar carga de bancos"}</Button>
                  </div>
                ) : bankDirectory ? (
                  bankDirectory.banks.length ? (
                    <form className="entry-form top-gap" onSubmit={(event) => {
                      event.preventDefault();
                      event.currentTarget.querySelector<HTMLButtonElement>("button[type=submit]")?.focus({preventScroll: true});
                      void startBankAuthorization(`${window.location.origin}/?tab=accounts`);
                    }}>
                      <FormField label="Banco" fullWidth><Select ref={bankSelectRef} value={selectedBankName} onChange={(event) => setSelectedBankName(event.target.value)} disabled={connectingBank}>{bankDirectory.banks.map((bank) => <option key={`${bank.country}-${bank.name}`} value={bank.name}>{bank.name}</option>)}</Select></FormField>
                      <Button variant="primary" fullWidth type="submit" disabled={!selectedBankName} aria-disabled={connectingBank || undefined} aria-busy={connectingBank || undefined}>{connectingBank ? <Loader2 aria-hidden="true" className="spin" /> : <Building2 aria-hidden="true" />}{connectingBank ? "Redirigiendo…" : "Autorizar con mi banco"}</Button>
                      {authorizationError ? <ErrorBanner message={authorizationError} /> : null}
                    </form>
                  ) : <div className="empty-state empty-state--plain top-gap">No hay bancos disponibles ahora mismo.</div>
                ) : <LoadingPanel label="Cargando bancos…" />}
              </motion.div>
            ) : null}
          </AnimatePresence>
          {connections.map((connection) => {
            const syncing = isConnectionSyncing(connection);
            const syncError = connectionSyncErrors[connection.id];
            return <div className={`connection-row ${attentionConnections.includes(connection) || syncError ? "needs-attention" : ""}`} key={connection.id}>
              <div className="connection-main">
                <div className="connection-title"><i aria-hidden="true" /><strong>{connection.bank_name}</strong></div>
                <span role={syncing ? "status" : undefined}>{syncing ? "Sincronizando…" : `${connection.sync_status_display} · ${connection.last_synced_at_display}`}</span>
                {connection.last_error ? <small className="field-error">{connection.last_error}</small> : null}
                {syncError ? <small className="field-error" role="alert">{syncError}</small> : null}
              </div>
              <div className="inline-actions">
                <IconButton aria-label={`Sincronizar ${connection.bank_name}`} title={syncing ? `Sincronizando ${connection.bank_name}` : `Sincronizar ${connection.bank_name}`} aria-disabled={syncing || undefined} aria-busy={syncing || undefined} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); void syncConnection(connection, event.currentTarget);}}>{syncing ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}</IconButton>
                <IconButton aria-label={`Desconectar ${connection.bank_name}`} title={`Desconectar ${connection.bank_name}`} onClick={(event) => {event.currentTarget.focus({preventScroll: true}); confirmBankDisconnect(connection);}}><Trash2 aria-hidden="true" /></IconButton>
              </div>
            </div>;
          })}
          {status === "Conexión bancaria desconectada." ? <StatusBanner message={status} /> : null}
        </Panel>

        <CollapsiblePanel
          title={editingAccountId ? "Editar cuenta" : "Nueva cuenta"}
          detail="Alta manual para cuentas no conectadas."
          open={accountPanelOpen}
          onToggle={() => {
            if (accountPanelOpen) setAccountFormError("");
            if (editingAccountId) {
              setEditingAccountId(null);
              setForm({name: "", kind: "checking", opening_balance: "0", color: "#3478f6", active: true});
            }
            setAccountFormOpen(!accountPanelOpen);
          }}
          summary={<span>{accounts.length} cuentas · {accounts.filter((item) => item.active).length} activas</span>}
        >
          <form id="accounts-manual-form" ref={accountFormRef} className="entry-form" aria-busy={savingAccount || undefined} onSubmit={saveAccount}>
            <FormField label="Nombre" fullWidth>
              <Input type="text" value={form.name} readOnly={savingAccount} onChange={(event) => setForm((current) => ({...current, name: event.target.value}))} />
            </FormField>
            <FormField label="Tipo">
              <Select value={form.kind} disabled={savingAccount} onChange={(event) => setForm((current) => ({...current, kind: event.target.value}))}>
                <option value="checking">Cuenta corriente</option>
                <option value="savings">Cuenta de ahorro</option>
              </Select>
            </FormField>
            <FormField label="Saldo inicial">
              <Input type="number" step="0.01" value={form.opening_balance} readOnly={savingAccount} onChange={(event) => setForm((current) => ({...current, opening_balance: event.target.value}))} />
            </FormField>
            <label>
              Color
              <input type="color" disabled={savingAccount} value={form.color} onChange={(event) => setForm((current) => ({...current, color: event.target.value}))} />
            </label>
            <label className="check-row">
              <input type="checkbox" disabled={savingAccount} checked={form.active} onChange={(event) => setForm((current) => ({...current, active: event.target.checked}))} />
              Cuenta activa
            </label>
            <Button aria-label="Guardar cuenta" variant="primary" fullWidth type="submit" aria-disabled={savingAccount || undefined} aria-busy={savingAccount || undefined} onClick={(event) => event.currentTarget.focus({preventScroll: true})}>
              <Save aria-hidden="true" /> {savingAccount ? "Guardando cuenta…" : "Guardar cuenta"}
            </Button>
          </form>
          {accountFormError ? <ErrorBanner message={accountFormError} /> : null}
        </CollapsiblePanel>
      </div>
      {pendingConfirmation ? <ConfirmDialog {...pendingConfirmation} onConfirm={pendingConfirmation.action} onCancel={() => {
        setPendingConfirmation(null);
        if (!focusAddAccountAfterDeleteRef.current) return;
        focusAddAccountAfterDeleteRef.current = false;
        window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".accounts-summary button")?.focus({preventScroll: true}));
      }} /> : null}
    </div>
  );
}
