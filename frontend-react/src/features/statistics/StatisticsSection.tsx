import {Component, lazy, Suspense, useMemo, useState, type ReactNode} from "react";
import {ViewLoadError} from "../../shared/components/ViewLoadError";
import {StatisticsLoadingFallback} from "./StatisticsLoadingFallback";
import {loadStatisticsView} from "./loadStatisticsView";
import type {AppNavigation} from "../../app/contracts";
import type {AppTheme} from "../../app/preferences/appPreferences";
import {navigateRoute} from "../../app/navigation";

const fallbackNavigate: AppNavigation["navigate"] = (tab, transition = {}) => navigateRoute({tab, ...transition});

class StatisticsDownloadBoundary extends Component<{
  children: ReactNode;
  onRetry: () => void;
}, {error: unknown}> {
  state = {error: null as unknown};

  static getDerivedStateFromError(error: unknown) {
    return {error};
  }

  render() {
    if (this.state.error) {
      return (
        <ViewLoadError
          title="Estadísticas"
          message="No se pudo descargar la sección de estadísticas."
          onRetry={this.props.onRetry}
        />
      );
    }
    return this.props.children;
  }
}

export function StatisticsSection({isActive = true, privateAmounts = false, theme = "mineral", navigate}: {isActive?: boolean; privateAmounts?: boolean; theme?: AppTheme; navigate?: AppNavigation["navigate"]}) {
  const [attempt, setAttempt] = useState(0);
  const LazyStatisticsView = useMemo(() => lazy(async () => {
    const module = await loadStatisticsView();
    return {default: module.StatisticsView};
  }), [attempt]);
  const retry = () => setAttempt((current) => current + 1);

  return (
    <StatisticsDownloadBoundary key={attempt} onRetry={retry}>
      <Suspense fallback={<StatisticsLoadingFallback label="Descargando estadísticas…" />}>
        <LazyStatisticsView isActive={isActive} privateAmounts={privateAmounts} theme={theme} navigate={navigate ?? fallbackNavigate} />
      </Suspense>
    </StatisticsDownloadBoundary>
  );
}
