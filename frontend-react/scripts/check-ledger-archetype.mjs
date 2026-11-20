#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const productionPath = path.join(projectRoot, "src/features/transactions/TransactionsLedgerSection.tsx");
const labPath = path.join(projectRoot, "src/ui-lab/scenarios/LedgerPageScenario.tsx");
const archetypePath = path.join(projectRoot, "src/ui/finance/LedgerArchetype.tsx");

const [production, lab, archetype] = await Promise.all([
  readFile(productionPath, "utf8"),
  readFile(labPath, "utf8"),
  readFile(archetypePath, "utf8"),
]);

const errors = [];
const sharedImport = "../../ui/finance/LedgerArchetype";

if (!production.includes(`from "${sharedImport}"`)) errors.push("Producción no importa el LedgerArchetype estable.");
if (!lab.includes(`from "${sharedImport}"`)) errors.push("UI Lab no importa el LedgerArchetype estable.");
if (!production.includes("<LedgerArchetype")) errors.push("Producción no monta el LedgerArchetype estable.");
if (!lab.includes("<LedgerArchetype")) errors.push("UI Lab no monta el LedgerArchetype estable.");
if (/\b(?:Panel|ui-lab)\b/.test(production)) errors.push("La composición productiva conserva un Panel o dependencia del Lab.");

const slots = ["header", "selection", "filter", "results"];
let previous = -1;
for (const slot of slots) {
  const marker = `data-ledger-slot=\"${slot}\"`;
  const position = archetype.indexOf(marker);
  if (position < 0) errors.push(`Falta el slot estable ${slot}.`);
  else if (position <= previous) errors.push(`El slot estable ${slot} rompe el orden aprobado.`);
  else previous = position;
}

if (errors.length) {
  console.error("Ledger archetype check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Ledger archetype boundary OK: production and UI Lab share header → selection → filter → results.");
