import {test} from "playwright/test";
import {expectCheckpointFixes, expectCompleteArchetype, expectLedgerGeometry, expectLedgerStates, openLedger} from "./ui-lab-helpers";

const scenarios = [
  {theme: "mineral", width: 393},
  {theme: "basalt", width: 1280},
] as const;

test.describe("composición completa por riesgo M7", {tag: "@full"}, () => {
  test.use({hasTouch: true});
  for (const {theme, width} of scenarios) {
    test(theme + " " + width + " — contratos completos", async ({page}, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({width, height: 900});
      await openLedger(page, theme + "-" + width);
      await page.getByLabel("Tema del experimento").selectOption(theme);
      await expectLedgerGeometry(page);
      await expectCompleteArchetype(page, testInfo);
      await expectCheckpointFixes(page, testInfo);
      await expectLedgerStates(page);
      await testInfo.attach("matriz-m7", {body: JSON.stringify({theme, width, engine: testInfo.project.name,
        states: ["many", "few", "empty", "loading", "error", "first", "middle", "last"]}), contentType: "application/json"});
    });
  }
});
