import type {ComponentType} from "react";
import {ControlsScenario} from "./ControlsScenario";
import {FoundationsScenario} from "./FoundationsScenario";
import {PageHeaderScenario} from "./PageHeaderScenario";
import {LedgerHeaderTournamentScenario} from "./LedgerHeaderTournamentScenario";
import {LedgerPageScenario} from "./LedgerPageScenario";
import {TransactionRowScenario} from "./TransactionRowScenario";
import {ReviewArchetypeScenario} from "./ReviewArchetypeScenario";
import {PreferencesScenario} from "./PreferencesScenario";

export const scenarios = [
  {id: "foundations", group: "Foundations", label: "Foundations", component: FoundationsScenario},
  {id: "controls", group: "Controls", label: "Controls", component: ControlsScenario},
  {id: "page-header", group: "Patterns", label: "Page header", component: PageHeaderScenario},
  {id: "global-preferences", group: "Patterns", label: "Global preferences", component: PreferencesScenario},
  {id: "transaction-row", group: "Financial objects", label: "TransactionRow v2", component: TransactionRowScenario},
  {id: "review-archetype", group: "Financial objects", label: "Review archetype", component: ReviewArchetypeScenario},
  {id: "ledger-archetype", group: "Page archetypes", label: "Ledger archetype", component: LedgerPageScenario},
  {id: "ledger-header-tournament", group: "Experiments", label: "Ledger header tournament", component: LedgerHeaderTournamentScenario},
] as const satisfies ReadonlyArray<{id: string; group: string; label: string; component: ComponentType}>;

export type ScenarioId = typeof scenarios[number]["id"];
export const defaultScenarioId: ScenarioId = "foundations";

const scenarioAliases: Record<string, ScenarioId> = {"statement-ledger": "ledger-archetype"};

export function findScenario(id: string | undefined) {
  return scenarios.find((scenario) => scenario.id === scenarioAliases[id ?? ""] || scenario.id === id);
}
