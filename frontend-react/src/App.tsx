import {useCallback, useEffect} from "react";
import {useAppBootstrap} from "./app/hooks/useAppBootstrap";
import {useAppNavigation} from "./app/hooks/useAppNavigation";
import {prefetchDatabaseScreen} from "./app/prefetchScreenData";
import {useMoreSheet} from "./app/hooks/useMoreSheet";
import {useOfflineStatus} from "./app/hooks/useOfflineStatus";
import {usePwaUpdate} from "./app/hooks/usePwaUpdate";
import {useUnhandledAppError} from "./app/hooks/useUnhandledAppError";
import {AuthGate} from "./app/auth/AuthGate";
import {AppShell} from "./app/shell/AppShell";

export function App() {
  return <AuthGate>{(logout) => <AuthenticatedApp onLogout={logout} />}</AuthGate>;
}

function AuthenticatedApp({onLogout}: {onLogout: () => Promise<void>}) {
  const offline = useOfflineStatus();
  const pwaUpdate = usePwaUpdate();
  const bootstrapState = useAppBootstrap(offline.clear);
  const more = useMoreSheet();
  const onNavigate = useCallback(() => {
    bootstrapState.clearError();
    more.close();
  }, [bootstrapState.clearError, more.close]);
  const onPreload = useCallback((tab: Parameters<typeof prefetchDatabaseScreen>[0]) => tab === "transactions"
    ? Promise.all([bootstrapState.ensureOptions(), prefetchDatabaseScreen(tab)])
    : prefetchDatabaseScreen(tab), [bootstrapState.ensureOptions]);
  const navigation = useAppNavigation({
    ready: Boolean(bootstrapState.bootstrap),
    onNavigate,
    onOpenNewMovement: more.close,
    onPreload,
  });
  useEffect(() => {
    if (navigation.activeTab === "transactions") {
      bootstrapState.ensureOptions().catch((reason) => bootstrapState.reportError(reason instanceof Error ? reason.message : "No se pudieron cargar las opciones de movimientos."));
    }
  }, [bootstrapState, navigation.activeTab]);
  useUnhandledAppError(bootstrapState.reportError);

  return (
    <AppShell
      bootstrapState={bootstrapState}
      navigation={navigation}
      offlineMessage={offline.message}
      pwaUpdate={pwaUpdate}
      more={more}
      onLogout={onLogout}
    />
  );
}
