import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditCssOwnership,
  extractCanonicalThemeNames,
  extractLegacyVisualTokenUses,
  extractRawColorLiterals,
  extractStableUiTokenDefinitions,
  extractStableUiTokenUses,
  normalizeSelector,
  ownerForImport,
  parseLocalCssImports,
  parseCssSelectors,
  parseManifest,
  splitSelectors,
} from "./check-css-ownership.mjs";

test("extrae reglas de @media/@supports e ignora declaraciones y keyframes", () => {
  const css = `
    :root, .button { --literal: "{;}"; color: red; }
    @font-face { font-family: Test; src: url("font.woff2"); }
    @keyframes pulse { from { opacity: 0; } 50% { opacity: .5; } to { opacity: 1; } }
    @media (min-width: 40rem) {
      .button { color: blue; }
      @supports (display: grid) {
        .grid, .thing:is(.a, .b) { display: grid; }
      }
    }
  `;

  assert.deepEqual(
    parseCssSelectors(css).map((entry) => entry.normalized),
    [":root", ".button", ".button", ".grid", ".thing:is(.a,.b)"],
  );
});

test("separa y normaliza selectores sin romper comas o espacios en funciones y atributos", () => {
  assert.deepEqual(splitSelectors('.a, :is(.b, .c), [data-label="a, b"]'), [
    ".a",
    ":is(.b, .c)",
    '[data-label="a, b"]',
  ]);
  assert.equal(normalizeSelector(".card  >  .title + [data-x='a b']"), ".card>.title+[data-x='a b']");
});

test("asigna propietarios por ruta semántica", () => {
  assert.equal(ownerForImport("./styles/foundation/tokens.css"), "foundation");
  assert.equal(ownerForImport("./styles/app/shell.css"), "app");
  assert.equal(ownerForImport("./styles/shared/forms.css"), "shared");
  assert.equal(ownerForImport("./styles/features/statistics.css"), "feature/statistics");
  assert.equal(ownerForImport("./styles/features/review/tables.css"), "feature/review");
  assert.equal(ownerForImport("./styles/integrations/uplot/charts.css"), "integrations/uplot");
  assert.equal(ownerForImport("./ui/foundations/themes.css"), "ui/foundations");
  assert.equal(ownerForImport("./ui/finance/statement-ledger.css"), "ui/finance");
});

test("lee un manifiesto de imports puro", () => {
  assert.deepEqual(
    parseManifest('/* orden de cascada */\n@import "./styles/app/shell.css";\n@import \'./styles/shared/forms.css\';\n'),
    ["./styles/app/shell.css", "./styles/shared/forms.css"],
  );
  assert.throws(() => parseManifest('@import "./styles/app.css";\nbody {}'));
});

test("detecta imports locales, tokens estables y themes canónicos", () => {
  assert.deepEqual(parseLocalCssImports('@import "./ui/ui-system.css"; @import url("../ui-lab/themes.css");'), [
    "./ui/ui-system.css",
    "../ui-lab/themes.css",
  ]);
  assert.deepEqual([...extractStableUiTokenUses(".ui-row { color: var(--ui-surface); box-shadow: var(--ui-missing); }")], [
    "--ui-surface",
    "--ui-missing",
  ]);
  assert.deepEqual([...extractStableUiTokenDefinitions(":root { --ui-surface: white; }")], ["--ui-surface"]);
  assert.deepEqual([...extractCanonicalThemeNames('[data-theme="mineral"], [data-theme="basalt"] {}')], ["mineral", "basalt"]);
});

test("detecta bypasses de tokens visuales y colores literales", () => {
  assert.deepEqual(
    [...extractLegacyVisualTokenUses(".card { color: var(--secondary-label); border-color: var(--separator); }")],
    ["--secondary-label", "--separator"],
  );
  assert.deepEqual(
    [...extractRawColorLiterals(".card { color: #fff; background: rgba(0, 0, 0, .2); outline: oklch(60% .1 240); }")],
    ["#fff", "rgba(0, 0, 0, .2)", "oklch(60% .1 240)"],
  );
  assert.deepEqual(
    [...extractLegacyVisualTokenUses(".card { border-radius: var(--radius-pill); color: var(--ink); }")],
    [],
  );
});

test("audita compat y propietarios duplicados", async () => {
  const frontendRoot = await mkdtemp(path.join(tmpdir(), "css-ownership-"));
  try {
    await mkdir(path.join(frontendRoot, "src/styles/foundation"), { recursive: true });
    await mkdir(path.join(frontendRoot, "src/styles/shared"), { recursive: true });
    await mkdir(path.join(frontendRoot, "src/styles/compat"), { recursive: true });
    await writeFile(
      path.join(frontendRoot, "src/styles.css"),
      '@import "./styles/foundation/base.css";\n@import "./styles/shared/forms.css";\n',
    );
    await writeFile(path.join(frontendRoot, "src/styles/foundation/base.css"), ".same { color: red; }\n");
    await writeFile(
      path.join(frontendRoot, "src/styles/shared/forms.css"),
      ".same { color: blue; }\n",
    );
    await writeFile(path.join(frontendRoot, "src/styles/compat/legacy.css"), ".legacy {}\n");

    const report = await auditCssOwnership(frontendRoot);
    assert(report.issues.some((issue) => issue.includes("styles/compat debe estar vacío")));
    assert(report.issues.some((issue) => issue.includes("Selector productivo con más de un propietario: .same")));
  } finally {
    await rm(frontendRoot, { recursive: true, force: true });
  }
});

test("falla ante token sin foundation, CSS productivo de Lab y theme duplicado", async () => {
  const frontendRoot = await mkdtemp(path.join(tmpdir(), "css-boundaries-"));
  try {
    await mkdir(path.join(frontendRoot, "src/ui/foundations"), { recursive: true });
    await mkdir(path.join(frontendRoot, "src/ui/finance"), { recursive: true });
    await mkdir(path.join(frontendRoot, "src/ui-lab"), { recursive: true });
    await writeFile(path.join(frontendRoot, "src/styles.css"), '@import "./ui/ui-system.css";\n');
    await writeFile(path.join(frontendRoot, "src/ui/ui-system.css"), [
      '@import "./foundations/tokens.css";',
      '@import "./foundations/themes.css";',
      '@import "./finance/ledger.css";',
      '@import "../ui-lab/themes.css";',
    ].join("\n"));
    await writeFile(path.join(frontendRoot, "src/ui/foundations/tokens.css"), ":root { --ui-surface: white; }\n");
    await writeFile(path.join(frontendRoot, "src/ui/foundations/themes.css"), '[data-theme="mineral"] { --paper: white; }\n');
    await writeFile(path.join(frontendRoot, "src/ui/finance/ledger.css"), ".ui-ledger { color: var(--ui-missing); }\n");
    await writeFile(path.join(frontendRoot, "src/ui-lab/main.tsx"), 'import "../ui/ui-system.css";\n');
    await writeFile(path.join(frontendRoot, "src/ui-lab/themes.css"), '[data-theme="mineral"] { --paper: white; }\n');

    const report = await auditCssOwnership(frontendRoot);
    assert(report.issues.some((issue) => issue.includes("producción no puede importar CSS de ui-lab")));
    assert(report.issues.some((issue) => issue.includes("--ui-missing")));
    assert(report.issues.some((issue) => issue.includes("Theme mineral debe tener una única definición canónica")));
  } finally {
    await rm(frontendRoot, { recursive: true, force: true });
  }
});
