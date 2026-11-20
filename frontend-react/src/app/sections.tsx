import {PiggyBank, Plus, RefreshCw, ShieldCheck, WalletCards} from "lucide-react";
import {lazy, Suspense} from "react";
import {DashboardView} from "../features/dashboard/DashboardView";
import {StatisticsSection} from "../features/statistics/StatisticsSection";
import {loadStatisticsView} from "../features/statistics/loadStatisticsView";
import {LoadingPanel} from "../shared/components/ui";
import type {SectionAction, SectionDefinition} from "./contracts";
import {navigationById} from "./navigationCatalog";

const loadTransactionsView = () => import("../features/transactions/TransactionsView");
const loadReviewView = () => import("../features/review/ReviewView");
const loadPlanningView = () => import("../features/planning/PlanningView");
const loadAccountsView = () => import("../features/accounts/AccountsView");
const loadSettingsView = () => import("../features/settings/SettingsView");
const TransactionsView = lazy(async () => ({default: (await loadTransactionsView()).TransactionsView}));
const ReviewView = lazy(async () => ({default: (await loadReviewView()).ReviewView}));
const PlanningView = lazy(async () => ({default: (await loadPlanningView()).PlanningView}));
const AccountsView = lazy(async () => ({default: (await loadAccountsView()).AccountsView}));
const SettingsView = lazy(async () => ({default: (await loadSettingsView()).SettingsView}));

function SectionFallback() {
  return <LoadingPanel label="Cargando sección…" />;
}

const addMovementAction: SectionAction = {
  label: "Añadir movimiento",
  Icon: Plus,
  onClick: ({openNewMovement}) => openNewMovement(),
};

export const sectionDefinitions: readonly SectionDefinition[] = [
  {
    ...navigationById.dashboard,
    action: addMovementAction,
    render: ({bootstrap, navigate, openNewMovement, openTransactionIntent, privacyMode}) => (
      <DashboardView
        data={bootstrap}
        privateAmounts={privacyMode}
        onAddTransaction={openNewMovement}
        onOpenAccounts={() => navigate("accounts")}
        onCreateObjective={() => navigate("planning", {hash: "#planning-objective-create"})}
        onOpenTransactions={(href) => openTransactionIntent(href || {})}
        onOpenReview={() => navigate("review")}
        onOpenImport={() => navigate("review", {search: new URLSearchParams("focus=csv-import")})}
        onOpenPlanning={() => navigate("planning")}
        onOpenStatistics={() => navigate("statistics")}
      />
    ),
  },
  {
    ...navigationById.transactions,
    action: addMovementAction,
    render: ({options, bootstrap, reload, newMovementToken, privacyMode, activeTab, routeKey, navigate}) => options ? (
      <Suspense fallback={<SectionFallback />}><TransactionsView
        options={options}
        bootstrap={bootstrap}
        onChanged={reload}
        openComposerToken={newMovementToken}
        privateAmounts={privacyMode}
        isActive={activeTab === "transactions"}
        routeKey={routeKey}
        onOpenSavedView={(search) => navigate("transactions", {search, history: "push"})}
      /></Suspense>
    ) : <LoadingPanel label="Cargando opciones de movimientos…" />,
    preload: loadTransactionsView,
  },
  {
    ...navigationById.review,
    action: {
      label: "Revisar banco",
      Icon: ShieldCheck,
      onClick: () => window.scrollTo({top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}),
    },
    render: ({bootstrap, privacyMode, activeTab, navigate, routeKey}) => <Suspense fallback={<SectionFallback />}><ReviewView connections={bootstrap.connections} privateAmounts={privacyMode} isActive={activeTab === "review"} routeKey={routeKey} navigateToSettings={(search) => navigate("settings", {search})} onOpenBankConnections={() => navigate("accounts", {hash: "#bank-connections"})} /></Suspense>,
    preload: loadReviewView,
  },
  {
    ...navigationById.planning,
    action: {
      label: "Añadir al plan",
      Icon: PiggyBank,
      onClick: ({openPlanningComposer}) => openPlanningComposer(),
    },
    render: ({planningComposerToken, routeKey, activeTab, navigate}) => <Suspense fallback={<SectionFallback />}><PlanningView openComposerToken={planningComposerToken} routeKey={routeKey} isActive={activeTab === "planning"} navigate={navigate} navigateToSettings={(search) => navigate("settings", {search})} /></Suspense>,
    preload: loadPlanningView,
  },
  {
    ...navigationById.accounts,
    action: {
      label: "Actualizar cuentas",
      Icon: RefreshCw,
      onClick: ({reload}) => reload(),
    },
    render: ({bootstrap, navigate, reload, routeKey, openTransactionIntent, privacyMode}) => (
      <Suspense fallback={<SectionFallback />}><AccountsView
        accounts={bootstrap.accounts}
        connections={bootstrap.connections}
        bankingConfigured={bootstrap.review.has_banking_configured}
        pendingBankReviewCount={bootstrap.review.bank_pending_count}
        privateAmounts={privacyMode}
        onOpenReview={(search) => navigate("review", {search})}
        onOpenTransactions={(href) => openTransactionIntent(href)}
        onNavigateAccount={(id, history) => navigate("accounts", {search: id ? new URLSearchParams([["account", String(id)]]) : new URLSearchParams(), history})}
        routeKey={routeKey}
        refresh={reload}
      /></Suspense>
    ),
    preload: loadAccountsView,
  },
  {
    ...navigationById.statistics,
    action: {
      label: "Ver movimientos",
      Icon: WalletCards,
      onClick: ({navigate}) => navigate("transactions"),
    },
    render: ({activeTab, privacyMode, appPreferences, navigate}) => <StatisticsSection isActive={activeTab === "statistics"} privateAmounts={privacyMode} theme={appPreferences.theme} navigate={navigate} />,
    preload: loadStatisticsView,
  },
  {
    ...navigationById.settings,
    action: addMovementAction,
    render: ({bootstrap, reload, appPreferences, updateAppPreferences, routeKey, navigate}) => <Suspense fallback={<SectionFallback />}><SettingsView categories={bootstrap.categories} accounts={bootstrap.accounts} connections={bootstrap.connections} routeKey={routeKey} navigateSettings={(search, history) => navigate("settings", {search, history})} onCategoriesChanged={reload} globalPreferences={{preferences: appPreferences, onChange: updateAppPreferences}} /></Suspense>,
    preload: loadSettingsView,
  },
];

export const sectionById = (id: SectionDefinition["id"]): SectionDefinition =>
  sectionDefinitions.find((section) => section.id === id) || sectionDefinitions[0];
