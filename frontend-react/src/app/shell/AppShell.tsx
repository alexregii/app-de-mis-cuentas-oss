import {useLayoutEffect, useState} from "react";
import {useReducedMotion} from "motion/react";
import type {AppBootstrapController} from "../hooks/useAppBootstrap";
import type {AppNavigationState} from "../hooks/useAppNavigation";
import {motionEase} from "../../shared/lib/motion";
import {useStoredBoolean} from "../../shared/hooks/useStoredBoolean";
import {setPrivacyMode} from "../../shared/lib/privacy";
import {sectionById, sectionDefinitions} from "../sections";
import {parseRoute} from "../navigation";
import {isTransactionIntentHref} from "../../shared/lib/transactionIntent";
import type {SectionActionRuntime, SectionRuntime} from "../contracts";
import {AppContent} from "./AppContent";
import {AppHeader} from "./AppHeader";
import {DesktopRail} from "./DesktopRail";
import {MobileNavigation} from "./MobileNavigation";
import {MoreSheet} from "./MoreSheet";
import {CommandPalette} from "./CommandPalette";
import {useInputModality} from "../../ui/foundations/useInputModality";
import {readAppPreferences, writeAppPreferences} from "../preferences/appPreferences";

export interface AppShellProps {
  bootstrapState: AppBootstrapController;
  navigation: AppNavigationState;
  offlineMessage: string;
  pwaUpdate: {
    applying: boolean;
    applyUpdate: () => void;
    hasDirtyForm: boolean;
    updateAvailable: boolean;
  };
  more: {
    open: boolean;
    close: () => void;
    toggle: () => void;
    triggerRef: React.RefObject<HTMLButtonElement | null>;
    sheetRef: React.RefObject<HTMLElement | null>;
  };
  onLogout: () => Promise<void>;
}

export function AppShell({bootstrapState, navigation, offlineMessage, pwaUpdate, more, onLogout}: AppShellProps) {
  const inputModalityRef = useInputModality<HTMLDivElement>();
  const reduceMotion = useReducedMotion();
  const [railCollapsed, setRailCollapsed] = useStoredBoolean("app.desktop-rail.collapsed", false);
  const [appPreferences, setAppPreferences] = useState(() => readAppPreferences().preferences);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const privacyMode = appPreferences.privacyMode;
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-theme");
    root.setAttribute("data-theme", appPreferences.theme);
    return () => {
      if (previousTheme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previousTheme);
    };
  }, [appPreferences.theme]);
  const updateAppPreferences = (next: typeof appPreferences) => {
    setAppPreferences(next);
    return writeAppPreferences(next);
  };
  setPrivacyMode(privacyMode);
  const togglePrivacyMode = () => updateAppPreferences({...appPreferences, privacyMode: !privacyMode});
  const activeSection = sectionById(navigation.activeTab);
  const persistentAppError = bootstrapState.bootstrap ? bootstrapState.error : "";
  const primarySections = sectionDefinitions.filter(({navigationGroup}) => navigationGroup === "primary");
  const secondarySections = sectionDefinitions.filter(({navigationGroup}) => navigationGroup === "secondary");
  const runtime: SectionRuntime | null = bootstrapState.bootstrap ? {
    bootstrap: bootstrapState.bootstrap,
    options: bootstrapState.options,
    reload: bootstrapState.reload,
    activeTab: navigation.activeTab,
    routeKey: navigation.routeKey,
    navigate: navigation.navigate,
    openNewMovement: navigation.openNewMovement,
    openPlanningComposer: navigation.openPlanningComposer,
    openTransactionIntent: navigation.openTransactionIntent,
    newMovementToken: navigation.newMovementToken,
    planningComposerToken: navigation.planningComposerToken,
    privacyMode,
    appPreferences,
    updateAppPreferences,
  } : null;
  const actionRuntime: SectionActionRuntime = {
    activeTab: navigation.activeTab,
    navigate: navigation.navigate,
    openNewMovement: navigation.openNewMovement,
    openPlanningComposer: navigation.openPlanningComposer,
    openTransactionIntent: navigation.openTransactionIntent,
    reload: bootstrapState.reload,
  };
  const pageMotion = reduceMotion
    ? {
      initial: {opacity: 1},
      animate: {opacity: 1},
      exit: {opacity: 1},
      transition: {duration: 0},
    }
    : {
      initial: {opacity: 0, y: 8},
      animate: {opacity: 1, y: 0},
      exit: {opacity: 0, y: -6},
      transition: {duration: 0.18, ease: motionEase},
    };
  const sheetTransition = reduceMotion
    ? {duration: 0}
    : {type: "spring" as const, stiffness: 520, damping: 42, mass: 0.8};
  const logout = () => {
    void onLogout().catch((reason: unknown) => {
      bootstrapState.reportError(reason instanceof Error ? reason.message : "No se pudo cerrar la sesión. Comprueba la conexión e inténtalo otra vez.");
    });
  };

  return (
    <div ref={inputModalityRef} data-theme={appPreferences.theme} className={`app-frame${railCollapsed ? " is-rail-collapsed" : ""}${privacyMode ? " is-privacy-mode" : ""}`}>
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <DesktopRail
        sections={sectionDefinitions}
        activeTab={navigation.activeTab}
        offlineMessage={offlineMessage}
        pwaUpdate={pwaUpdate}
        navigate={navigation.navigate}
        preload={navigation.preload}
        action={activeSection.action}
        actionRuntime={actionRuntime}
        collapsed={railCollapsed}
        toggleCollapsed={() => setRailCollapsed((current) => !current)}
        privacyMode={privacyMode}
        togglePrivacyMode={togglePrivacyMode}
        onLogout={logout}
      />
      <AppHeader activeLabel={activeSection.label} offlineMessage={offlineMessage} appError={persistentAppError} refreshError={refreshError} pwaUpdate={pwaUpdate} openDashboard={() => navigation.navigate("dashboard")} openCommandPalette={() => setCommandPaletteOpen(true)} privacyMode={privacyMode} togglePrivacyMode={togglePrivacyMode} />
      <AppContent
        bootstrapState={bootstrapState}
        section={activeSection}
        runtime={runtime}
        pageMotion={pageMotion}
        preloadedTabs={navigation.preloadedTabs}
        clearError={bootstrapState.clearError}
        reportError={bootstrapState.reportError}
        clearRefreshError={() => setRefreshError("")}
        reportRefreshError={setRefreshError}
        onTransactionIntent={navigation.openTransactionIntent}
      />
      <MobileNavigation
        primarySections={primarySections}
        activeTab={navigation.activeTab}
        navigate={navigation.navigate}
        preload={navigation.preload}
        action={activeSection.action}
        runtime={actionRuntime}
        moreOpen={more.open}
        moreIsActive={activeSection.navigationGroup === "secondary"}
        toggleMore={more.toggle}
        moreTriggerRef={more.triggerRef}
      />
      <MoreSheet
        open={more.open}
        close={more.close}
        sheetRef={more.sheetRef}
        sections={secondarySections}
        activeTab={navigation.activeTab}
        navigate={navigation.navigate}
        preload={navigation.preload}
        reduceMotion={Boolean(reduceMotion)}
        sheetTransition={sheetTransition}
        onLogout={logout}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onOpen={() => setCommandPaletteOpen(true)}
        onClose={() => setCommandPaletteOpen(false)}
        sections={sectionDefinitions}
        runtime={actionRuntime}
        routeKey={navigation.routeKey}
        onNavigate={navigation.navigate}
        onOpenHref={(href) => {
          if (isTransactionIntentHref(href)) {
            navigation.openTransactionIntent(href, {history: parseRoute().tab === "transactions" ? "replace" : "push"});
            return;
          }
          const route = new URL(href, window.location.origin);
          const target = parseRoute(route).tab;
          const categoryDeepLink = target === "settings" && route.searchParams.has("category");
          navigation.navigate(target, {search: route.searchParams, hash: route.hash, history: categoryDeepLink || target !== navigation.activeTab ? "push" : "replace"});
        }}
      />
      <div className="sr-status" aria-live="polite" aria-atomic="true">
        {bootstrapState.bootstrap ? "Aplicación cargada" : "Cargando…"}
      </div>
    </div>
  );
}
