import {createHash} from "node:crypto";
import {chromium} from "playwright";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};

const baseUrl = argument("--base-url", "http://127.0.0.1:15177").replace(/\/$/, "");
const iterations = Number(argument("--iterations", "10"));
const traceFirst = process.argv.includes("--trace-first");
const reducedMotion = process.argv.includes("--reduced-motion");
const waitPrefetch = process.argv.includes("--wait-prefetch");
const waitAllPreloaded = process.argv.includes("--wait-all-preloaded");
const hoverMs = Number(argument("--hover-ms", "0"));
const selectedScreen = argument("--screen", "");
if (!Number.isInteger(iterations) || iterations < 3) throw new Error("--iterations debe ser >= 3");
if (!Number.isFinite(hoverMs) || hoverMs < 0) throw new Error("--hover-ms debe ser >= 0");

const screens = [
  {
    name: "transactions",
    label: "Movimientos",
    api: [/^\/api\/transactions\/$/],
    ready: async (page) => {
      await page.getByRole("heading", {name: "Movimientos", exact: true}).waitFor({state: "visible"});
      await page.getByText(/\d+ resultados en el registro/).waitFor({state: "visible"});
      await page.locator(".ui-ledger-loading-state").waitFor({state: "detached"});
    },
  },
  {
    name: "review",
    label: "Revisión",
    api: [/^\/api\/bank-review\/$/, /^\/api\/imports\/$/, /^\/api\/imports\/\d+\/rows\/$/],
    ready: async (page) => {
      await page.getByRole("heading", {name: "Revisión", exact: true}).waitFor({state: "visible"});
      await page.locator(".review-bank-workspace .loading-panel").waitFor({state: "detached"});
      await page.locator(".review-csv-workspace .loading-panel").waitFor({state: "detached"});
    },
  },
  {
    name: "statistics",
    label: "Estadísticas",
    api: [/^\/api\/statistics\/$/],
    ready: async (page) => {
      await page.getByRole("heading", {name: "Estadísticas", exact: true}).waitFor({state: "visible"});
      await page.locator('.stats-view[aria-busy="false"]').waitFor({state: "visible"});
      const engine = await page.locator(".stats-view").getAttribute("data-chart-engine");
      if (engine === "ag-charts") {
        await page.locator(".ag-chart-shell canvas").first().waitFor({state: "visible"});
      } else {
        await page.locator(".uplot-chart-shell canvas").first().waitFor({state: "visible"});
      }
      await page.getByRole("navigation", {name: "Abrir movimientos por familia principal"}).waitFor({state: "visible"});
    },
  },
];

const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))];
};
const summarize = (values) => ({
  samples: values.length,
  p50_ms: Number(percentile(values, 0.5).toFixed(1)),
  p95_ms: Number(percentile(values, 0.95).toFixed(1)),
  mean_ms: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
  min_ms: Number(Math.min(...values).toFixed(1)),
  max_ms: Number(Math.max(...values).toFixed(1)),
});

const contentSnapshot = async (page, screen) => {
  const screenKey = screen === "transactions" ? "transactions" : screen === "review" ? "review" : "statistics";
  const cachedRoot = page.locator(`[data-cached-tab="${screenKey}"]`);
  const root = await cachedRoot.count() ? cachedRoot : page.locator("main");
  if (screen === "transactions") return root.evaluate((element) => ({
    ledgerRows: element.querySelectorAll(".ui-statement-ledger__row").length,
    paginationControls: element.querySelectorAll(".ui-ledger-pagination__nav-button").length,
  }));
  if (screen === "review") {
    const bankReviewItems = await root.locator(".review-bank-workspace [data-review-item]").count();
    const batchButtons = root.locator(".review-csv-workspace .batch-select-button");
    const csvBatches = await batchButtons.count();
    if (csvBatches) {
      await batchButtons.first().click();
      await root.locator(".review-csv-workspace .import-row-list").waitFor({state: "visible"});
    }
    return {
      bankReviewItems,
      csvBatches,
      csvRows: await root.locator(".review-csv-workspace .import-row-list > *").count(),
    };
  }
  return root.evaluate((element) => ({
    chartCanvasCount: element.querySelectorAll("canvas").length,
    monthlyDisclosureRows: element.querySelectorAll(".stats-month-table-disclosure tbody tr").length,
    categoryDisclosureRows: element.querySelectorAll(".stats-category-table-disclosure tbody tr").length,
    categoryMatrixRows: element.querySelectorAll(".stats-category-matrix tbody tr").length,
    advancedAnalysisSections: element.querySelectorAll(".stats-advanced-analysis-content > *").length,
  }));
};

const apiShape = (pathname, payload) => {
  if (pathname === "/api/transactions/") return {
    pageRecords: payload.results?.length ?? 0,
    totalRecords: payload.count ?? 0,
    pages: payload.num_pages ?? 0,
  };
  if (pathname === "/api/bank-review/") return {
    records: payload.rows?.length ?? 0,
    pendingRecords: payload.rows?.filter((row) => row.status === "pending").length ?? 0,
    categories: payload.categories?.length ?? 0,
  };
  if (pathname === "/api/imports/") return {batches: payload.batches?.length ?? 0};
  if (/^\/api\/imports\/\d+\/rows\/$/.test(pathname)) return {
    pageRecords: payload.results?.length ?? 0,
    totalRecords: payload.count ?? 0,
    pages: payload.num_pages ?? 0,
  };
  if (pathname === "/api/statistics/") return {
    monthlyPoints: payload.monthly_series?.length ?? 0,
    categoryFamilies: payload.categories?.length ?? 0,
    advancedFamilies: payload.analysis?.category_matrix?.rows?.length ?? 0,
    advancedMonths: payload.analysis?.category_matrix?.months?.length ?? 0,
    hasCoverage: Boolean(payload.coverage),
    hasDataQuality: Boolean(payload.data_quality),
  };
  return undefined;
};

const browser = await chromium.launch({headless: true});
const results = {};
try {
for (const screen of screens.filter((item) => !selectedScreen || item.name === selectedScreen)) {
    const samples = [];
    const visibleReadySamples = [];
    let trace;
    for (let index = 0; index < iterations; index += 1) {
      const context = await browser.newContext({
        viewport: {width: 1365, height: 900},
        locale: "es-ES",
        reducedMotion: reducedMotion ? "reduce" : "no-preference",
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const apiResponsePromises = [];
      const apiResponsesSeen = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (!url.pathname.startsWith("/api/")) return;
        apiResponsesSeen.push(response);
        if (traceFirst && index === 0) {
          apiResponsePromises.push((async () => {
            const body = await response.body();
            return {
              url: `${url.pathname}${url.search}`,
              status: response.status(),
              bytes: body.byteLength,
              sha256: createHash("sha256").update(body).digest("hex"),
              structure: apiShape(url.pathname, JSON.parse(body.toString("utf8"))),
            };
          })());
        }
      });
      await page.addInitScript((screenLabel) => {
        window.__screenLoadTasks = [];
        window.__screenLoadMilestones = [];
        new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => window.__screenLoadTasks.push({
            start: entry.startTime,
            duration: entry.duration,
            attribution: entry.attribution.map((item) => ({
              name: item.name,
              entryType: item.entryType,
              containerType: item.containerType,
              containerName: item.containerName,
              containerId: item.containerId,
              containerSrc: item.containerSrc,
            })),
          }));
        }).observe({type: "longtask", buffered: true});
        const recordTargetNavigation = () => {
          const active = [...document.querySelectorAll('button[aria-current="page"]')]
            .find((button) => `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""} ${button.textContent || ""}`.includes(screenLabel));
          if (active && !window.__screenLoadMilestones.some((item) => item.heading === "navigation")) {
            window.__screenLoadMilestones.push({heading: "navigation", time: performance.now()});
          }
        };
        const screenKey = ({Movimientos: "transactions", Revisión: "review", Estadísticas: "statistics"})[screenLabel];
        const recordScreenReady = () => {
          const wrapper = document.querySelector(`[data-cached-tab="${screenKey}"]`) || document.querySelector("main");
          if (!wrapper || wrapper.getAttribute("aria-hidden") === "true") return;
          const headingMatches = [...wrapper.querySelectorAll("h1")].some((heading) => heading.textContent?.trim() === screenLabel);
          if (!headingMatches) return;
          const ready = screenKey === "transactions"
            ? wrapper.querySelector('[data-screen-ready="true"]') !== null
              || (!wrapper.querySelector(".ui-ledger-loading-state") && /\d+ resultados en el registro/.test(wrapper.textContent || ""))
            : screenKey === "review"
              ? ["bank", "imports", "rows"].every((name) => wrapper.querySelector(`[data-review-${name}-ready="true"]`))
                || ([".review-bank-workspace", ".review-csv-workspace"].every((selector) => wrapper.querySelector(selector) !== null)
                  && !wrapper.querySelector(".review-bank-workspace .loading-panel")
                  && !wrapper.querySelector(".review-csv-workspace .loading-panel"))
              : wrapper.querySelector('.stats-view[aria-busy="false"]') !== null
                && [...wrapper.querySelectorAll("canvas")].some((canvas) => canvas.getBoundingClientRect().width > 0);
          if (ready && !window.__screenLoadMilestones.some((item) => item.heading === "screen-ready")) {
            window.__screenLoadMilestones.push({heading: "screen-ready", time: performance.now()});
          }
        };
        new MutationObserver(() => {
          recordTargetNavigation();
          recordScreenReady();
          const heading = document.querySelector("main h1")?.textContent?.trim();
          if (heading === screenLabel && !window.__screenLoadMilestones.some((item) => item.heading === heading)) {
            window.__screenLoadMilestones.push({heading, time: performance.now()});
          }
        }).observe(document, {
          attributes: true,
          attributeFilter: ["aria-current", "aria-busy", "aria-hidden", "data-screen-ready", "data-review-bank-ready", "data-review-imports-ready", "data-review-rows-ready"],
          childList: true,
          characterData: true,
          subtree: true,
        });
        document.addEventListener("click", (event) => {
          const button = event.target?.closest("button");
          if (button?.textContent?.trim().includes(screenLabel)) {
            performance.mark("screen-load-click");
            window.__screenLoadMilestones.push({heading: "click", time: performance.now()});
          }
        }, true);
        recordTargetNavigation();
        recordScreenReady();
      }, screen.label);
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`${baseUrl}/`, {waitUntil: "domcontentloaded"});
      await page.getByRole("heading", {name: "Resumen", exact: true}).waitFor({state: "visible"});
      if (waitAllPreloaded) {
        await page.waitForFunction(() => {
          const cache = document.querySelector(".database-screen-cache");
          const ready = (tab, selector, attribute, expected = "true") => cache
            ?.querySelector(`[data-cached-tab="${tab}"] ${selector}`)
            ?.getAttribute(attribute) === expected;
          return ready("transactions", "[data-screen-ready]", "data-screen-ready")
            && ready("review", "[data-review-bank-ready]", "data-review-bank-ready")
            && ready("review", "[data-review-imports-ready]", "data-review-imports-ready")
            && ready("review", "[data-review-rows-ready]", "data-review-rows-ready")
            && ready("statistics", ".stats-view", "aria-busy", "false")
            && Boolean(cache.querySelector('[data-cached-tab="statistics"] canvas'));
        }, null, {timeout: 30_000});
        await page.waitForFunction(() => {
          const tasks = window.__screenLoadTasks || [];
          const now = performance.now();
          return tasks.every((task) => now - (task.start + task.duration) >= 400);
        }, null, {timeout: 15_000});
      }
      const navigation = page.getByRole("navigation", {name: "Navegación principal de escritorio"});
      const expectedResponses = screen.api.map((pattern) => {
        const existing = apiResponsesSeen.find((response) => pattern.test(new URL(response.url()).pathname));
        return existing ? Promise.resolve(existing) : page.waitForResponse(
          (response) => pattern.test(new URL(response.url()).pathname),
          {timeout: 15_000},
        );
      });
      if (waitPrefetch) await Promise.all(expectedResponses);
      const target = navigation.getByRole("button", {name: screen.label, exact: true});
      if (hoverMs > 0) {
        await target.hover();
        await page.waitForTimeout(hoverMs);
      }
      const started = performance.now();
      await target.click();
      const screenResponses = await Promise.all(expectedResponses);
      const responseStatuses = screenResponses.map((response) => response.status());
      if (responseStatuses.some((status) => status !== 200)) {
        throw new Error(`${screen.name}: respuestas API ${responseStatuses.join(", ")}`);
      }
      await screen.ready(page);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      samples.push(performance.now() - started);
      visibleReadySamples.push(await page.evaluate(() => {
        const click = performance.getEntriesByName("screen-load-click").at(-1)?.startTime;
        const ready = window.__screenLoadMilestones.find((item) => item.heading === "screen-ready")?.time;
        return click === undefined || ready === undefined ? Number.NaN : ready - click;
      }));
      if (traceFirst && index === 0) {
        const apiResponses = await Promise.all(apiResponsePromises);
        trace = await page.evaluate(() => {
          const start = performance.getEntriesByName("screen-load-click").at(-1)?.startTime ?? 0;
          return {
            browser_elapsed_ms: Number((performance.now() - start).toFixed(1)),
            screen_ready_ms: (() => {
              const ready = window.__screenLoadMilestones.find((item) => item.heading === "screen-ready");
              return ready ? Number((ready.time - start).toFixed(1)) : null;
            })(),
            long_tasks: window.__screenLoadTasks.map(({start: taskStart, duration, attribution}) => ({
              start_ms: Number((taskStart - start).toFixed(1)),
              duration_ms: Number(duration.toFixed(1)),
              attribution,
            })),
            milestones: window.__screenLoadMilestones.map(({heading, time}) => ({
              event: heading,
              start_ms: Number((time - start).toFixed(1)),
            })),
            resources: performance.getEntriesByType("resource")
              .filter((entry) => entry.startTime >= Math.max(0, start - 1_500) && entry.responseEnd >= start)
              .map((entry) => ({
                path: new URL(entry.name).pathname,
                type: entry.initiatorType,
                start_ms: Number((entry.startTime - start).toFixed(1)),
                duration_ms: Number(entry.duration.toFixed(1)),
                transfer_bytes: entry.transferSize,
              })),
          };
        });
        trace.api_responses = apiResponses.filter((item) => screen.api.some((pattern) => pattern.test(new URL(`http://local${item.url}`).pathname)));
      }
      if (pageErrors.length) throw new Error(`${screen.name}: ${pageErrors.join(" | ")}`);
      if (index === 0) screen.content = await contentSnapshot(page, screen.name);
      await context.close();
    }
    results[screen.name] = {
      ...summarize(samples),
      browser_visible_ready: summarize(visibleReadySamples.filter(Number.isFinite)),
      ...(screen.content ? {content: screen.content} : {}),
      ...(trace ? {trace} : {}),
    };
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({generated_at: new Date().toISOString(), base_url: baseUrl, iterations, awaited_prefetch: waitPrefetch, waited_all_preloaded: waitAllPreloaded, hover_ms: hoverMs, screens: results}, null, 2));
