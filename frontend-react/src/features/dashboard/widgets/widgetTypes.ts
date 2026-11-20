import type {ReactNode} from "react";
import type {BootstrapPayload} from "../../../shared/model/bootstrap";
import type {DashboardData} from "../../../shared/model/dashboard";

export interface DashboardWidgetProps {
  data: BootstrapPayload;
  bootstrap: DashboardData;
  compact: boolean;
  privateAmounts: boolean;
  onAddTransaction: () => void;
  onOpenAccounts: () => void;
  onCreateObjective: () => void;
  onHideActivation: () => void;
  onOpenTransactions: () => void;
  onReview: () => void;
  onImport: () => void;
  onPlanning: () => void;
  onStats: () => void;
}

export type DashboardWidgetRegion = "hero" | "decision" | "activity" | "more";

export type DashboardWidgetMode = "full" | "balance" | "review";

export interface DashboardWidgetDefinition {
  id: string;
  title: string;
  region: DashboardWidgetRegion;
  modes: readonly DashboardWidgetMode[];
  /**
   * Controls only this widget's representation in the customizable layout.
   * It must never be used to suppress an operational decision or its action.
   */
  hideable: boolean;
  reorderable: boolean;
  priority: number;
  available: (props: Pick<DashboardWidgetProps, "data" | "bootstrap">) => boolean;
  render: (props: DashboardWidgetProps) => ReactNode;
}
