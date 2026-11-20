import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {stableBoundaryViolation} from "./check-architecture.mjs";

const sourceRoot = path.resolve("src");
const roots = {
  appRoot: path.join(sourceRoot, "app"),
  featureRoot: path.join(sourceRoot, "features"),
  sharedRoot: path.join(sourceRoot, "shared"),
  uiLabRoot: path.join(sourceRoot, "ui-lab"),
  uiRoot: path.join(sourceRoot, "ui"),
};

test("rechaza imports de ui-lab desde producción, features y stable UI", () => {
  const labFile = path.join(roots.uiLabRoot, "main.tsx");
  assert.match(
    stableBoundaryViolation(path.join(sourceRoot, "main.tsx"), labFile, roots),
    /producción no puede importar ui-lab/,
  );
  assert.match(
    stableBoundaryViolation(path.join(roots.featureRoot, "transactions", "View.tsx"), labFile, roots),
    /features no pueden importar ui-lab/,
  );
  assert.match(
    stableBoundaryViolation(path.join(roots.uiRoot, "finance", "Ledger.tsx"), labFile, roots),
    /ui no puede importar ui-lab/,
  );
});

test("permite que UI Lab consuma stable UI y bloquea las capas ascendentes", () => {
  const uiFile = path.join(roots.uiRoot, "finance", "Ledger.tsx");
  assert.equal(stableBoundaryViolation(path.join(roots.uiLabRoot, "main.tsx"), uiFile, roots), null);
  assert.match(stableBoundaryViolation(uiFile, path.join(roots.featureRoot, "transactions", "types.ts"), roots), /ui no puede importar/);
  assert.match(stableBoundaryViolation(uiFile, path.join(roots.appRoot, "AppShell.tsx"), roots), /ui no puede importar/);
  assert.match(stableBoundaryViolation(uiFile, path.join(roots.sharedRoot, "components", "Panel.tsx"), roots), /ui no puede importar shared/);
  assert.match(stableBoundaryViolation(path.join(roots.uiLabRoot, "main.tsx"), path.join(roots.featureRoot, "transactions", "types.ts"), roots), /ui-lab solo puede importar/);
  assert.equal(stableBoundaryViolation(path.join(roots.featureRoot, "transactions", "View.tsx"), uiFile, roots), null);
});

test("mantiene la frontera adapter -> UI y rechaza UI -> adapter", () => {
  const adapterFile = path.join(roots.featureRoot, "review", "adapters", "bankReviewAdapter.ts");
  const uiFile = path.join(roots.uiRoot, "finance", "ReviewItem.ts");
  assert.equal(stableBoundaryViolation(adapterFile, uiFile, roots), null);
  assert.match(stableBoundaryViolation(uiFile, adapterFile, roots), /ui no puede importar/);
});

test("mantiene los adapters puros y sin dependencias de presentación o transporte", async () => {
  const adapterDirectory = path.join(roots.featureRoot, "review", "adapters");
  const adapterFiles = ["bankReviewAdapter.ts", "csvReviewAdapter.ts", "reviewEditorAdapter.ts", "reviewAdapterSemantics.ts", "reviewAdapterTypes.ts", "reviewDraft.ts"];
  for (const filename of adapterFiles) {
    const source = await readFile(path.join(adapterDirectory, filename), "utf8");
    assert.doesNotMatch(source, /from ["'](?:react|react\/)/);
    assert.doesNotMatch(source, /from ["'][^"']*(?:\/api(?:["'/]|$)|api\.ts|bootstrapApi|navigation|ui-lab)/i);
    assert.doesNotMatch(source, /\b(?:fetch|useState|useEffect|useMemo|useCallback)\s*\(/);
  }
});
