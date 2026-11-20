import type {ReactNode} from "react";
import type {LucideIcon} from "lucide-react";
import type {BootstrapPayload, OptionsPayload} from "../shared/model/bootstrap";
import type {TransactionIntent} from "../shared/lib/transactionIntent";
import type {AppPreferences, AppPreferencesWriteResult} from "./preferences/appPreferences";

export type Tab = "dashboard" | "transactions" | "review" | "planning" | "accounts" | "statistics" | "settings";

export type NavigationGroup = "primary" | "secondary";

export interface AppBootstrapState {
  bootstrap: BootstrapPayload | null;
  options: OptionsPayload | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  ensureOptions: () => Promise<OptionsPayload>;
}

export interface AppNavigation {
  activeTab: Tab;
  navigate: (tab: Tab, transition?: {search?: URLSearchParams; hash?: string; history?: "push" | "replace"}) => void;
  openNewMovement: () => void;
  openPlanningComposer: () => void;
  openTransactionIntent: (intent: TransactionIntent, options?: {history?: "push" | "replace"}) => void;
}

export interface SectionActionRuntime extends AppNavigation {
  reload: () => Promise<void>;
}

export interface SectionRuntime extends SectionActionRuntime {
  bootstrap: BootstrapPayload;
  options: OptionsPayload | null;
  routeKey: string;
  newMovementToken: number;
  planningComposerToken: number;
  privacyMode: boolean;
  appPreferences: AppPreferences;
  updateAppPreferences: (preferences: AppPreferences) => AppPreferencesWriteResult;
}

export interface SectionAction {
  label: string;
  Icon: LucideIcon;
  onClick: (runtime: SectionActionRuntime) => void | Promise<void>;
}

export interface SectionDefinition {
  id: Tab;
  label: string;
  shortLabel?: string;
  Icon: LucideIcon;
  navigationGroup: NavigationGroup;
  action: SectionAction;
  render: (runtime: SectionRuntime) => ReactNode;
  preload?: () => Promise<unknown>;
}
