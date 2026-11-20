import type {ComponentType} from "react";
import type {AppNavigation} from "../../app/contracts";
import type {AppTheme} from "../../app/preferences/appPreferences";

export interface StatisticsViewModule {
  StatisticsView: ComponentType<{isActive?: boolean; privateAmounts?: boolean; theme: AppTheme; navigate?: AppNavigation["navigate"]}>;
}

type StatisticsViewImporter = () => Promise<StatisticsViewModule>;

export function createStatisticsViewLoader(importer: StatisticsViewImporter) {
  let pending: Promise<StatisticsViewModule> | null = null;

  return () => {
    if (!pending) {
      pending = importer().catch((error: unknown) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}

export const loadStatisticsView = createStatisticsViewLoader(() => import("./StatisticsView"));
