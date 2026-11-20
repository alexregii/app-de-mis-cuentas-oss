import {mkdir} from "node:fs/promises";
import {Buffer} from "node:buffer";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {expect, test, type Page, type TestInfo} from "playwright/test";
import type {ImportPayload} from "../src/shared/model/imports";
import type {PlanningCalendarPayload} from "../src/shared/model/planning";
import type {BootstrapPayload} from "../src/shared/model/bootstrap";
import {defaultDashboardPreferences} from "../src/features/dashboard/dashboardModel";
import {focusMotionPairwiseStates, installPageErrorGuard, openApp} from "./helpers";

const evidenceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".e2e", "u6-global-closure");

const sections = [
  {slug: "dashboard", path: "/", heading: "Resumen"},
  {slug: "transactions", path: "/?tab=transactions", heading: "Movimientos"},
  {slug: "review", path: "/?tab=review", heading: "Revisión"},
  {slug: "planning", path: "/?tab=planning", heading: "Plan"},
  {slug: "accounts", path: "/?tab=accounts", heading: "Cuentas"},
  {slug: "statistics", path: "/?tab=statistics", heading: "Estadísticas"},
  {slug: "settings", path: "/?tab=settings", heading: "Ajustes"},
] as const;

const viewports = [
  {slug: "desktop-1440x1000", width: 1440, height: 1000},
  {slug: "mobile-390x844", width: 390, height: 844},
] as const;

const globalPairwiseMatrix = {
  dashboard: [
    {viewport: viewports[1], theme: "mineral", privacyMode: true},
    {viewport: viewports[0], theme: "mineral", privacyMode: false},
  ],
  transactions: [
    {viewport: viewports[1], theme: "basalt", privacyMode: false},
    {viewport: viewports[0], theme: "basalt", privacyMode: false},
  ],
  review: [{viewport: viewports[1], theme: "basalt", privacyMode: true}],
  planning: [{viewport: viewports[0], theme: "mineral", privacyMode: true}],
  accounts: [{viewport: viewports[0], theme: "basalt", privacyMode: true}],
  statistics: [{viewport: viewports[0], theme: "mineral", privacyMode: true}],
} as const;

const settingsCategoriesPath = "/?tab=settings&settings_section=classification";
const settingsGeneralPath = "/?tab=settings&settings_section=general";
const settingsRulesPath = "/?tab=settings&settings_section=classification&focus=rules";
const settingsNewRulePath = "/?tab=settings&settings_section=classification&focus=new-rule";
const settingsImportsPath = "/?tab=settings&settings_section=imports";

function assignedBrowser(viewport: {width: number}, reducedMotion?: boolean) {
  if (reducedMotion === undefined) return viewport.width <= 480 ? "@webkit-only" : "@chromium-only";
  return (viewport.width <= 480) !== reducedMotion ? "@chromium-only" : "@webkit-only";
}

async function setAppPreferences(page: Page, theme: "mineral" | "basalt", privacyMode: boolean) {
  await page.addInitScript(({theme: storedTheme, privacyMode: storedPrivacyMode}) => {
    window.localStorage.removeItem("app.privacy-mode");
    window.localStorage.setItem("app.preferences.v1", JSON.stringify({
      version: 1,
      theme: storedTheme,
      privacyMode: storedPrivacyMode,
    }));
  }, {theme, privacyMode});
}

async function navigateToTabFromShell(page: Page, label: string) {
  const desktopNavigation = page.getByRole("navigation", {name: "Navegación principal de escritorio"});
  if (await desktopNavigation.isVisible()) {
    await desktopNavigation.getByRole("button", {name: label, exact: true}).click();
  } else {
    await page.getByRole("button", {name: "Más", exact: true}).click();
    await page.getByRole("dialog", {name: "Más secciones"}).getByRole("button", {name: label, exact: true}).click();
  }
}

async function setMountedThemeThroughSettings(page: Page, theme: "mineral" | "basalt") {
  const frame = page.locator(".app-frame");
  if (await frame.getAttribute("data-theme") === theme) return;
  await navigateToTabFromShell(page, "Ajustes");
  await page.getByRole("button", {name: /General Apariencia y privacidad/}).click();
  await page.getByRole("group", {name: "Tema de la aplicación"})
    .getByRole("button", {name: theme === "mineral" ? "Mineral" : "Basalt", exact: true}).click();
  await expect(frame).toHaveAttribute("data-theme", theme);
  await navigateToTabFromShell(page, "Estadísticas");
  await waitForSection(page, "Estadísticas");
}

async function installPwaUpdateFixture(page: Page) {
  await page.addInitScript(() => {
    type Listener = (event: Event) => void;
    const listeners = new Map<string, Set<Listener>>();
    const workerListeners = new Map<string, Set<Listener>>();
    const addListener = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => {
      const entries = map.get(type) || new Set<Listener>();
      entries.add(listener);
      map.set(type, entries);
    };
    const emit = (map: Map<string, Set<Listener>>, type: string, target: object) => {
      map.get(type)?.forEach((listener) => listener.call(target, new Event(type)));
    };
    const worker = {
      state: "installing",
      addEventListener: (type: string, listener: Listener) => addListener(workerListeners, type, listener),
      removeEventListener: (type: string, listener: Listener) => workerListeners.get(type)?.delete(listener),
    };
    const registration = {
      installing: null as typeof worker | null,
      waiting: null as {postMessage: (message: {type: string}) => void} | null,
      addEventListener: (type: string, listener: Listener) => addListener(listeners, type, listener),
      removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
    };
    const serviceWorker = navigator.serviceWorker;
    Object.defineProperty(serviceWorker, "controller", {configurable: true, value: {}});
    Object.defineProperty(serviceWorker, "register", {configurable: true, value: async () => registration as unknown as ServiceWorkerRegistration});
    Object.defineProperty(window, "__triggerPwaUpdate", {configurable: true, value: () => {
      (window as Window & {__pwaUpdateMessages?: unknown[]}).__pwaUpdateMessages = [];
      registration.waiting = {postMessage: (message) => {
        (window as Window & {__pwaUpdateMessages?: unknown[]}).__pwaUpdateMessages?.push(message);
      }};
      registration.installing = worker;
      emit(listeners, "updatefound", registration);
      worker.state = "installed";
      emit(workerListeners, "statechange", worker);
    }});
  });
}

async function waitForStableScroll(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let previous = window.scrollY;
    let stableFrames = 0;
    let frames = 0;
    const sample = () => {
      const current = window.scrollY;
      stableFrames = Math.abs(current - previous) < 1 ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 3 || frames++ >= 120) resolve();
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

async function installDashboardSnapshotFixture(page: Page) {
  await page.route("**/api/bootstrap/", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json() as BootstrapPayload;
    bootstrap.preferences = {...defaultDashboardPreferences(), last_snapshot_month: "2026-09"};
    await route.fulfill({response, body: JSON.stringify(bootstrap)});
  });
  await page.route("**/api/dashboard/snapshot/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({snapshot: {
      month: "2026-09",
      captured_at: "2026-09-24T00:00:00Z",
      payload: {metrics: {total_balance: 1234, income: 4567, expense: 3333}},
    }}),
  }));
}

async function installPlanningCalendarFixture(page: Page, fixtureState: {activeDate: string}) {
  await page.route("**/api/planning/calendar/**", async (route) => {
    const response = await route.fetch();
    const calendar = await response.json() as PlanningCalendarPayload;
    const activeDay = calendar.days.find((day) => day.in_month);
    if (!activeDay) throw new Error("La fixture E2E de calendario no contiene días del mes");
    fixtureState.activeDate = activeDay.date;
    activeDay.confirmed = [{
      id: "global-preferences-calendar-e2e",
      date: activeDay.date,
      description: "Pago protegido E2E",
      amount: -12.34,
      kind: "expense",
      state: "confirmed",
      account: "Cuenta diaria E2E",
      is_transfer: false,
    }];
    activeDay.income = 0;
    activeDay.expense = -12.34;
    activeDay.actual_count = 1;
    activeDay.has_income = false;
    activeDay.has_expense = true;
    activeDay.has_transfer = false;
    await route.fulfill({response, body: JSON.stringify(calendar)});
  });
}

async function installSettingsImportsFixture(page: Page, fixtureState: {profileCreated?: boolean}) {
  await page.route("**/api/imports/", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as ImportPayload;
    const createdProfile = fixtureState.profileCreated ? {
        id: 9730,
        name: "Perfil creado E2E",
        delimiter: ",",
        date_format: "%Y-%m-%d",
        date_column: "date",
        description_column: "description",
        amount_column: "amount",
        category_column: "category",
        subcategory_column: "subcategory",
      } : null;
    payload.profiles = createdProfile ? [createdProfile] : [];
    payload.default_profile_id = createdProfile?.id || null;
    payload.batches = [];
    await route.fulfill({response, body: JSON.stringify(payload)});
  });
}

async function installSettingsProfileCreateFixture(page: Page, fixtureState: {profileCreated?: boolean}) {
  const requests: Array<{contentType: string; body: string}> = [];
  let releaseFirstResponse!: () => void;
  let notifyFirstRequest!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {releaseFirstResponse = resolve;});
  const firstRequestArrived = new Promise<void>((resolve) => {notifyFirstRequest = resolve;});
  const profile = {
    id: 9730,
    name: "Perfil creado E2E",
    delimiter: ",",
    date_format: "%Y-%m-%d",
    date_column: "date",
    description_column: "description",
    amount_column: "amount",
    category_column: "category",
    subcategory_column: "subcategory",
  };

  await page.route("**/api/import-profiles/", async (route) => {
    const request = route.request();
    requests.push({contentType: request.headers()["content-type"] || "", body: request.postData() || ""});
    if (requests.length === 1) {
      notifyFirstRequest();
      await firstResponseGate;
      await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({error: "Ya existe un perfil con ese nombre."})});
      return;
    }
    if (requests.length === 2) {
      fixtureState.profileCreated = true;
      await route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({ok: true, profile})});
      return;
    }
    await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Creación inesperada en fixture."})});
  });

  return {requests, firstRequestArrived, releaseFirstResponse};
}

async function installCategoryFormFixture(page: Page) {
  const root = {id: 2, name: "Comida", display_name: "Comida", kind: "expense", color: "#ff9500", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false, transaction_count: 4, child_count: 0};
  const state: {category: typeof root | null} = {category: null};
  const createRequests: Array<Record<string, unknown>> = [];
  const updateRequests: Array<Record<string, unknown>> = [];
  let bootstrapPromise: Promise<Record<string, unknown>> | null = null;
  let releaseFirstResponse!: () => void;
  let notifyFirstRequest!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {releaseFirstResponse = resolve;});
  const firstRequestArrived = new Promise<void>((resolve) => {notifyFirstRequest = resolve;});
  await page.route("**/api/bootstrap/", async (route) => {
    if (!bootstrapPromise) bootstrapPromise = route.fetch().then((response) => response.json() as Promise<Record<string, unknown>>);
    const payload = structuredClone(await bootstrapPromise) as Record<string, unknown> & {categories: unknown[]};
    payload.categories = state.category ? [root, state.category] : [root];
    await route.fulfill({json: payload});
  });
  await page.route("**/api/categories/", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    createRequests.push(body);
    if (createRequests.length === 1) {
      notifyFirstRequest();
      await firstResponseGate;
      await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({ok: false, error: "Nombre duplicado por fixture."})});
      return;
    }
    state.category = {
      ...root,
      id: 9030,
      name: String(body.name),
      display_name: `Comida · ${String(body.name)}`,
      color: String(body.color),
      icon: String(body.icon),
      parent_id: Number(body.parent),
      exclude_from_analytics: Boolean(body.exclude_from_analytics),
    };
    await route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({ok: true, category: state.category})});
  });
  await page.route("**/api/categories/9030/", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    updateRequests.push(body);
    if (state.category) {
      state.category = {...state.category, name: String(body.name), display_name: `Comida · ${String(body.name)}`, icon: String(body.icon)};
    }
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, category: state.category})});
  });
  return {state, createRequests, updateRequests, firstRequestArrived, releaseFirstResponse};
}

async function installCategoryCatalogFixture(page: Page, orderOnly = false) {
  const root = {id: 9041, name: "Comida", display_name: "Comida", kind: "expense", color: "#ff9500", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false, transaction_count: 4, child_count: 1};
  const categories = orderOnly ? [
    {...root, child_count: 0},
    {...root, id: 9044, name: "Bebidas", display_name: "Bebidas", sort_order: 2, child_count: 0},
    {...root, id: 9045, name: "Hogar", display_name: "Hogar", sort_order: 3, transaction_count: 0, child_count: 0},
  ] : [
    root,
    {...root, id: 9042, name: "Gas", display_name: "Comida · Gas", parent_id: root.id, sort_order: 0, transaction_count: 0, child_count: 0},
    {...root, id: 9043, name: "Inactiva", display_name: "Inactiva", active: false, parent_id: null, sort_order: 2, child_count: 0},
    {...root, id: 9044, name: "Favorita", display_name: "Favorita", is_favorite: true, parent_id: null, sort_order: 3, child_count: 0},
    {...root, id: 9045, name: "Sin uso", display_name: "Sin uso", parent_id: null, sort_order: 4, transaction_count: 0, child_count: 0},
  ];
  let bootstrapPromise: Promise<Record<string, unknown>> | null = null;
  await page.route("**/api/bootstrap/", async (route) => {
    if (!bootstrapPromise) bootstrapPromise = route.fetch().then((response) => response.json() as Promise<Record<string, unknown>>);
    const payload = structuredClone(await bootstrapPromise);
    payload.categories = categories;
    await route.fulfill({json: payload});
  });
  return {categories};
}

async function installAutomationRuleFixture(page: Page, initialRules = [{
    id: 80311,
    description: "Regla estabilidad E2E",
    kind: "expense",
    category: {id: 2, name: "Comida", display_name: "Comida", kind: "expense", color: "#ff9500", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false, transaction_count: 1, child_count: 0},
    active: true,
    updated_at: "2026-09-24T00:00:00Z",
    priority: 1,
    match_mode: "contains",
    account: null,
    amount_min: null,
    amount_max: null,
    last_tested_at: "",
    last_test_result: {},
    application_count: 0,
  }]) {
  const state = {rules: initialRules};
  await page.route("**/api/category-rules/", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({json: {rules: state.rules}});
  });
  await page.route("**/api/category-rules/conflicts/", (route) => route.fulfill({json: {conflicts: []}}));
  return state;
}

async function installRecoveryFixture(page: Page) {
  const backup = {name: "manual-fixture.zip", created_at: "2026-09-24T10:00:00Z", size: 2048, destination: "fixture"};
  const state: {latestBackup: typeof backup | null; restoreRequested: boolean; restoreBody: Record<string, unknown> | null; previewCalls: number} = {
    latestBackup: null,
    restoreRequested: false,
    restoreBody: null,
    previewCalls: 0,
  };
  await page.route("**/api/recovery/", async (route) => {
    if (route.request().method() === "POST") state.latestBackup = backup;
    const status = state.restoreRequested ? {status: "completed", message: "Restauración completada por fixture."} : null;
    await route.fulfill({json: {ok: true, latest_backup: state.latestBackup, backup_status: {worker: "healthy", schedule: "missing", heartbeat_at: "2026-10-21T10:00:00Z", last_failure_at: null, last_success_at: null}, restore: {available: true, status}}});
  });
  await page.route("**/api/recovery/restore/preview/", async (route) => {
    state.previewCalls += 1;
    if (state.previewCalls === 1) {
      await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({ok: false, error: "El ZIP fixture no es válido."})});
      return;
    }
    await route.fulfill({json: {ok: true, token: "c".repeat(32), impact: {files: 12, media_files: 3, size: 4096}}});
  });
  await page.route("**/api/recovery/restore/", async (route) => {
    state.restoreBody = route.request().postDataJSON() as Record<string, unknown>;
    state.restoreRequested = true;
    await route.fulfill({json: {ok: true, message: "Restauración solicitada; la aplicación se reiniciará."}});
  });
  return state;
}

async function installRestoreSubmissionFixture(page: Page) {
  let restoreRequests = 0;
  let restoreAccepted = false;
  let restoreBody: Record<string, unknown> | null = null;
  let releaseFailure!: () => void;
  let reachFailure!: () => void;
  let releaseSuccess!: () => void;
  let reachSuccess!: () => void;
  const failureReached = new Promise<void>((resolve) => {reachFailure = resolve;});
  const failureReleased = new Promise<void>((resolve) => {releaseFailure = resolve;});
  const successReached = new Promise<void>((resolve) => {reachSuccess = resolve;});
  const successReleased = new Promise<void>((resolve) => {releaseSuccess = resolve;});
  await page.route("**/api/recovery/", (route) => route.fulfill({json: {
    ok: true,
    latest_backup: null,
    backup_status: {worker: "healthy", schedule: "missing", heartbeat_at: "2026-10-21T10:00:00Z", last_failure_at: null, last_success_at: null},
    restore: {available: true, status: restoreAccepted ? {status: "completed", message: "Restauración completada por fixture."} : null},
  }}));
  await page.route("**/api/recovery/restore/preview/", (route) => route.fulfill({json: {
    ok: true,
    token: "d".repeat(32),
    impact: {files: 7, media_files: 2, size: 3072},
  }}));
  await page.route("**/api/recovery/restore/", async (route) => {
    restoreRequests += 1;
    restoreBody = route.request().postDataJSON() as Record<string, unknown>;
    if (restoreRequests === 1) {
      reachFailure();
      await failureReleased;
      await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo solicitar la restauración."})});
      return;
    }
    reachSuccess();
    await successReleased;
    restoreAccepted = true;
    await route.fulfill({json: {ok: true, message: "Restauración solicitada por fixture."}});
  });
  return {failureReached, releaseFailure, successReached, releaseSuccess, get restoreRequests() {return restoreRequests;}, get restoreBody() {return restoreBody;}};
}

async function installBackupPreviewFixture(page: Page) {
  const backup = {name: "manual-fixture.zip", created_at: "2026-09-24T10:00:00Z", size: 2048, destination: "fixture"};
  let backupRequests = 0;
  let backupCreated = false;
  let previewRequests = 0;
  let releaseBackupFailure!: () => void;
  let reachBackupFailure!: () => void;
  let releaseBackupSuccess!: () => void;
  let reachBackupSuccess!: () => void;
  let releasePreviewFailure!: () => void;
  let reachPreviewFailure!: () => void;
  let releasePreviewSuccess!: () => void;
  let reachPreviewSuccess!: () => void;
  const backupFailureReached = new Promise<void>((resolve) => {reachBackupFailure = resolve;});
  const backupFailureReleased = new Promise<void>((resolve) => {releaseBackupFailure = resolve;});
  const backupSuccessReached = new Promise<void>((resolve) => {reachBackupSuccess = resolve;});
  const backupSuccessReleased = new Promise<void>((resolve) => {releaseBackupSuccess = resolve;});
  const previewFailureReached = new Promise<void>((resolve) => {reachPreviewFailure = resolve;});
  const previewFailureReleased = new Promise<void>((resolve) => {releasePreviewFailure = resolve;});
  const previewSuccessReached = new Promise<void>((resolve) => {reachPreviewSuccess = resolve;});
  const previewSuccessReleased = new Promise<void>((resolve) => {releasePreviewSuccess = resolve;});
  await page.route("**/api/recovery/", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({json: {ok: true, latest_backup: backupCreated ? backup : null, backup_status: {worker: "healthy", schedule: "missing", heartbeat_at: "2026-10-21T10:00:00Z", last_failure_at: null, last_success_at: null}, restore: {available: true, status: null}}});
      return;
    }
    backupRequests += 1;
    if (backupRequests === 1) {
      reachBackupFailure();
      await backupFailureReleased;
      await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "No se pudo crear la copia de seguridad."})});
      return;
    }
    reachBackupSuccess();
    await backupSuccessReleased;
    backupCreated = true;
    await route.fulfill({json: {ok: true, latest_backup: backup, backup_status: {worker: "healthy", schedule: "missing", heartbeat_at: "2026-10-21T10:00:00Z", last_failure_at: null, last_success_at: null}, restore: {available: true, status: null}}});
  });
  await page.route("**/api/recovery/restore/preview/", async (route) => {
    previewRequests += 1;
    if (previewRequests === 1) {
      reachPreviewFailure();
      await previewFailureReleased;
      await route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({ok: false, error: "El ZIP fixture no es válido."})});
      return;
    }
    reachPreviewSuccess();
    await previewSuccessReleased;
    await route.fulfill({json: {ok: true, token: "e".repeat(32), impact: {files: 7, media_files: 2, size: 3072}}});
  });
  return {
    backupFailureReached, releaseBackupFailure, backupSuccessReached, releaseBackupSuccess,
    previewFailureReached, releasePreviewFailure, previewSuccessReached, releasePreviewSuccess,
    get backupRequests() {return backupRequests;},
    get previewRequests() {return previewRequests;},
  };
}

async function installRecoveryStatusRetryFixture(page: Page) {
  let requests = 0;
  let releaseFailure!: () => void;
  let reachFailure!: () => void;
  let releaseSuccess!: () => void;
  let reachSuccess!: () => void;
  const failureReached = new Promise<void>((resolve) => {reachFailure = resolve;});
  const failureReleased = new Promise<void>((resolve) => {releaseFailure = resolve;});
  const successReached = new Promise<void>((resolve) => {reachSuccess = resolve;});
  const successReleased = new Promise<void>((resolve) => {releaseSuccess = resolve;});
  await page.route("**/api/recovery/", async (route) => {
    requests += 1;
    if (requests === 1) {
      reachFailure();
      await failureReleased;
      await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Storage no disponible."})});
      return;
    }
    reachSuccess();
    await successReleased;
    await route.fulfill({json: {ok: true, latest_backup: null, backup_status: {worker: "healthy", schedule: "missing", heartbeat_at: "2026-10-21T10:00:00Z", last_failure_at: null, last_success_at: null}, restore: {available: true, status: null}}});
  });
  return {failureReached, releaseFailure, successReached, releaseSuccess, get requests() {return requests;}};
}

async function waitForSection(page: Page, heading: string) {
  await expect(page.getByRole("heading", {name: heading, exact: true})).toBeVisible();
  if (heading === "Estadísticas") {
    await expect(page.locator('.stats-view[aria-busy="false"]')).toBeVisible();
  }
  await expect(page.locator('#main-content [aria-busy="true"]')).toHaveCount(0);
}

async function startRecoveryHeightsProbe(page: Page, text: string) {
  const samples = page.waitForFunction(() => {
    const probe = (window as Window & {__recoveryHeightProbe?: {done: boolean}}).__recoveryHeightProbe;
    return probe?.done === true;
  }, undefined, {timeout: 8_000}).then(() => page.evaluate(() => {
    const probe = (window as Window & {__recoveryHeightProbe?: {heights: number[]}}).__recoveryHeightProbe;
    return probe?.heights ?? [];
  }));
  await page.evaluate((targetText) => {
    const details = document.querySelector<HTMLElement>(".recovery-restore");
    const state = {targetText, heights: [] as number[], done: false};
    const probeWindow = window as Window & {__recoveryHeightProbe?: typeof state};
    probeWindow.__recoveryHeightProbe = state;
    if (!details) {
      state.done = true;
      return;
    }
    let frame = 0;
    let sampling = false;
    const sample = () => {
      if (!details.isConnected) {
        state.done = true;
        return;
      }
      state.heights.push(details.getBoundingClientRect().height);
      if (frame++ < 23) requestAnimationFrame(sample);
      else state.done = true;
    };
    const observer = new MutationObserver(() => {
      if (sampling || !details.textContent?.includes(targetText)) return;
      sampling = true;
      observer.disconnect();
      requestAnimationFrame(sample);
    });
    observer.observe(details, {childList: true, subtree: true, characterData: true});
    if (details.textContent?.includes(targetText)) {
      sampling = true;
      observer.disconnect();
      requestAnimationFrame(sample);
    }
  }, text);
  return {samples};
}

async function assertNoDocumentOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth, "La vista no debe desbordar horizontalmente el documento").toBeLessThanOrEqual(geometry.clientWidth + 1);
}

async function assertNoVisibleEuroLeak(page: Page) {
  const evidence = await page.locator("#main-content").evaluate((root) => {
    const attributes = Array.from(root.querySelectorAll<HTMLElement>("[aria-label], [title]"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .flatMap((element) => [element.getAttribute("aria-label"), element.getAttribute("title")])
      .filter((value): value is string => Boolean(value));
    return [root.innerText, ...attributes];
  });
  const moneyPattern = /[-+]?\d[\d.,\s]*\s*€/u;
  expect(evidence.filter((value) => moneyPattern.test(value)), "Privacy mode no debe exponer importes numéricos en texto visible, aria-label o title").toEqual([]);
}

async function screenshotEvidence(page: Page, testInfo: TestInfo, filename: string) {
  const directory = path.join(evidenceRoot, testInfo.project.name);
  await mkdir(directory, {recursive: true});
  await page.screenshot({path: path.join(directory, filename), fullPage: true, animations: "disabled"});
}

  // DX-61 keeps the twelve pairs in the G5-G10 union; page cases are assigned by browser risk.
  test("G5 Resumen matriz pairwise global @webkit-only", async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    const states = globalPairwiseMatrix.dashboard;
    const firstState = states[0];
    await page.setViewportSize({width: firstState.viewport.width, height: firstState.viewport.height});
    await setAppPreferences(page, firstState.theme, firstState.privacyMode);
    let dashboardPreferences = {...defaultDashboardPreferences(), last_snapshot_month: "2026-09"};
    await page.route("**/api/dashboard/preferences/", async (route) => {
      if (route.request().method() === "PUT") dashboardPreferences = {...dashboardPreferences, ...route.request().postDataJSON()};
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, preferences: dashboardPreferences})});
    });
    await installDashboardSnapshotFixture(page);
    await openApp(page, "/");

    for (const [index, state] of states.entries()) {
      if (index > 0) {
        await page.setViewportSize({width: state.viewport.width, height: state.viewport.height});
        await page.getByRole("button", {name: "Mostrar importes"}).first().click();
        await expect(page.locator(".app-frame")).not.toHaveClass(/is-privacy-mode/);
      }

      const frame = page.locator(".app-frame");
      await expect(frame).toHaveAttribute("data-theme", state.theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", state.theme);
      if (state.privacyMode) {
        await expect(frame).toHaveClass(/is-privacy-mode/);
        await assertNoVisibleEuroLeak(page);
      } else {
        await expect(frame).not.toHaveClass(/is-privacy-mode/);
      }
      await assertNoDocumentOverflow(page);
      await screenshotEvidence(page, testInfo, `${state.viewport.slug}-${state.theme}-${state.privacyMode ? "privacy" : "normal"}-dashboard.png`);

      if (state.privacyMode) {
        const moreDetails = page.getByRole("button", {name: "Más información"});
        await moreDetails.click();
        const viewSnapshot = page.getByRole("button", {name: "Ver cierre"});
        await expect(viewSnapshot).toBeVisible();
        await viewSnapshot.click();
        await expect(page.locator(".snapshot-preview")).toBeVisible();
        await assertNoVisibleEuroLeak(page);
        await page.getByRole("button", {name: "Cerrar snapshot"}).click();
        await moreDetails.click();
      }
    }

    await assertNoDocumentOverflow(page);
    assertNoPageErrors();
});

test("G6 Movimientos matriz pairwise global @chromium-only", async ({page}, testInfo) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    const states = globalPairwiseMatrix.transactions;
    const firstState = states[0];
    await page.setViewportSize({width: firstState.viewport.width, height: firstState.viewport.height});
    await setAppPreferences(page, firstState.theme, firstState.privacyMode);
    await openApp(page, "/?tab=transactions&q=Ocio%20directo%20E2E");

    for (const [index, state] of states.entries()) {
      if (index > 0) await page.setViewportSize({width: state.viewport.width, height: state.viewport.height});
      await expect(page.locator(".ui-statement-ledger__row")).toHaveCount(1);

      const frame = page.locator(".app-frame");
      await expect(frame).toHaveAttribute("data-theme", state.theme);
      if (state.privacyMode) {
        await expect(frame).toHaveClass(/is-privacy-mode/);
        await assertNoVisibleEuroLeak(page);
      } else {
        await expect(frame).not.toHaveClass(/is-privacy-mode/);
        await expect(page.getByLabel(/Importe: -18,00/)).toBeVisible();
      }

      await assertNoDocumentOverflow(page);
      await screenshotEvidence(page, testInfo, `${state.viewport.slug}-${state.theme}-${state.privacyMode ? "privacy" : "normal"}-transactions.png`);
    }

    assertNoPageErrors();
});

test("G7 Revisión matriz pairwise Bank y CSV @webkit-only", async ({page}, testInfo) => {
    test.setTimeout(120_000);
    const assertNoPageErrors = installPageErrorGuard(page);
    const state = globalPairwiseMatrix.review[0];
    await page.setViewportSize({width: state.viewport.width, height: state.viewport.height});
    await setAppPreferences(page, state.theme, state.privacyMode);
    await openApp(page, "/?tab=review");

      const frame = page.locator(".app-frame");
      await expect(frame).toHaveAttribute("data-theme", state.theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", state.theme);
      if (state.privacyMode) await expect(frame).toHaveClass(/is-privacy-mode/);
      else await expect(frame).not.toHaveClass(/is-privacy-mode/);

        const bank = page.getByRole("region", {name: "Cola bancaria"});
        const bankCards = bank.locator('[data-review-item^="bank:"]');
        await expect(bankCards).toHaveCount(2);
        const bankAmount = bankCards.first().locator(".ui-review-inline__value--amount");
        await expect(bankAmount).toBeVisible();

        const csv = page.getByRole("region", {name: "Importaciones CSV"});
        await csv.getByRole("button", {name: "Expandir CSV"}).click();
        const csvCards = csv.locator('[data-review-item^="csv:"]');
        await expect(csvCards).toHaveCount(2);
        const csvAmount = csvCards.first().locator(".ui-review-inline__value--amount");
        await expect(csvAmount).toBeVisible();

        if (state.privacyMode) {
          await expect(bankAmount).toHaveText("••••••");
          await expect(bankAmount).toHaveAttribute("aria-label", "Importe: ••••••");
          await expect(csvAmount).toHaveText("••••••");
          await expect(csvAmount).toHaveAttribute("aria-label", "Importe: ••••••");
          await assertNoVisibleEuroLeak(page);

          for (const [card, amount] of [[bankCards.first(), bankAmount], [csvCards.first(), csvAmount]] as const) {
            if (await amount.evaluate((element) => element.tagName === "BUTTON")) {
              await amount.click();
              const editor = card.locator("input[data-review-inline-editor='amount']");
              await expect(editor).toBeVisible();
              await expect(editor).toHaveValue("");
              await expect(editor).toHaveAttribute("placeholder", "••••••");
              await assertNoVisibleEuroLeak(page);
              await editor.press("Escape");
            }
          }
        } else {
          await expect(bankAmount).toContainText("€");
          await expect(csvAmount).toContainText("€");
        }

        await assertNoDocumentOverflow(page);
        await screenshotEvidence(page, testInfo, `${state.viewport.slug}-${state.theme}-${state.privacyMode ? "privacy" : "normal"}-review.png`);

    assertNoPageErrors();
});

test("G8 Plan matriz pairwise global @chromium-only", async ({page}, testInfo) => {
    test.setTimeout(120_000);
    const assertNoPageErrors = installPageErrorGuard(page);
    const fixtureState = {activeDate: ""};
    const state = globalPairwiseMatrix.planning[0];
    await page.setViewportSize({width: state.viewport.width, height: state.viewport.height});
    await setAppPreferences(page, state.theme, state.privacyMode);
    await installPlanningCalendarFixture(page, fixtureState);
    await openApp(page, "/?tab=planning");
    await waitForSection(page, "Plan");

        const frame = page.locator(".app-frame");
        await expect(frame).toHaveAttribute("data-theme", state.theme);
        if (state.privacyMode) await expect(frame).toHaveClass(/is-privacy-mode/);
        else await expect(frame).not.toHaveClass(/is-privacy-mode/);

        const occupiedDay = page.locator(`.planning-calendar-day[data-date="${fixtureState.activeDate}"]`);
        await expect(occupiedDay).toBeVisible();
        const emptyDay = page.locator(".planning-calendar-day:not(.outside-month):not(.has-amounts)").last();
        await expect(emptyDay).toBeVisible();
        if (state.privacyMode) {
          await expect(occupiedDay).not.toHaveAttribute("aria-label", /12,34/u);
          await assertNoVisibleEuroLeak(page);
        } else {
          await expect(occupiedDay).toHaveAttribute("aria-label", /12,34.*€/u);
        }

        await occupiedDay.click();
        await expect(page.getByRole("heading", {name: /Detalle del/})).toBeVisible();
        if (state.privacyMode) await assertNoVisibleEuroLeak(page);
        await page.getByRole("button", {name: "Cerrar detalle", exact: true}).click();
        await emptyDay.scrollIntoViewIfNeeded();
        await emptyDay.focus();
        await waitForStableScroll(page);
        const emptyDayScrollBefore = await page.evaluate(() => window.scrollY);
        const emptyDayTopBefore = (await emptyDay.boundingBox())?.y;
        expect(emptyDayTopBefore).not.toBeUndefined();
        await page.keyboard.press("Enter");
        await expect(emptyDay).toHaveAttribute("aria-expanded", "true");
        await expect(emptyDay).toBeFocused();
        await expect(page.getByText("No hay movimientos registrados para este día.")).toBeVisible();
        expect(await page.evaluate(() => window.scrollY)).toBe(emptyDayScrollBefore);
        expect((await emptyDay.boundingBox())?.y).toBeCloseTo(emptyDayTopBefore!, 0);
        await waitForStableScroll(page);
        await expect(page.getByText("No hay movimientos registrados para este día.")).toBeVisible();
        expect(await page.evaluate(() => window.scrollY)).toBe(emptyDayScrollBefore);
        expect((await emptyDay.boundingBox())?.y).toBeCloseTo(emptyDayTopBefore!, 0);
        const closeEmptyDetail = page.locator(".planning-calendar-detail").getByRole("button", {name: "Cerrar detalle", exact: true});
        await closeEmptyDetail.focus();
        await page.keyboard.press("Enter");
        await expect(emptyDay).toHaveAttribute("aria-expanded", "false");
        await expect(emptyDay).toBeFocused();
        await expect(page.locator(".planning-calendar-detail")).toHaveCount(0);
        await waitForStableScroll(page);
        expect(await page.evaluate(() => window.scrollY)).toBe(emptyDayScrollBefore);
        expect((await emptyDay.boundingBox())?.y).toBeCloseTo(emptyDayTopBefore!, 0);

        if (state.privacyMode) {
          const savingsGoal = page.locator(".planning-savings-goal");
          await savingsGoal.getByRole("button", {name: "Expandir objetivo de ahorro", exact: true}).click();
          await expect(page.getByLabel("Mínimo mensual")).toHaveCSS("-webkit-text-security", "disc");
          await savingsGoal.getByRole("button", {name: "Comprimir objetivo de ahorro", exact: true}).click();
          await page.getByRole("button", {name: "Añadir al plan"}).click();
          await page.getByRole("button", {name: "Presupuesto", exact: true}).click();
          await expect(page.getByLabel("Límite")).toHaveCSS("-webkit-text-security", "disc");
          await assertNoVisibleEuroLeak(page);
        }

        await assertNoDocumentOverflow(page);
        await screenshotEvidence(page, testInfo, `${state.viewport.slug}-${state.theme}-${state.privacyMode ? "privacy" : "normal"}-planning.png`);

    assertNoPageErrors();
});

test("G12-A Ajustes guarda tema y privacidad al volver a Plan @webkit-only", async ({page}) => {
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: 390, height: 844});
  await setAppPreferences(page, "mineral", false);
  await openApp(page, settingsGeneralPath);
  await waitForSection(page, "Ajustes");

  await page.getByRole("button", {name: "Ocultar", exact: true}).click();
  await expect(page.locator(".app-frame")).toHaveClass(/is-privacy-mode/);
  await expect(page.getByRole("status")).toContainText("Preferencias guardadas en este dispositivo.");
  await page.getByRole("button", {name: "Basalt", exact: true}).click();
  await expect(page.locator(".app-frame")).toHaveAttribute("data-theme", "basalt");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "basalt");
  await expect(page.getByRole("status")).toContainText("Preferencias guardadas en este dispositivo.");
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem("app.preferences.v1") || "null"))).toMatchObject({theme: "basalt", privacyMode: true});

  await navigateToTabFromShell(page, "Plan");
  await waitForSection(page, "Plan");
  const savingsGoal = page.locator(".planning-savings-goal");
  await savingsGoal.getByRole("button", {name: "Expandir objetivo de ahorro", exact: true}).click();
  await expect(page.getByLabel("Mínimo mensual")).toHaveCSS("-webkit-text-security", "disc");
  await assertNoVisibleEuroLeak(page);
  assertNoPageErrors();
});

test("G9 Cuentas matriz pairwise registry y detalle @chromium-only", async ({page}, testInfo) => {
  test.setTimeout(120_000);
  const assertNoPageErrors = installPageErrorGuard(page);
  const state = globalPairwiseMatrix.accounts[0];
  await page.setViewportSize({width: state.viewport.width, height: state.viewport.height});
  await setAppPreferences(page, state.theme, state.privacyMode);
  await openApp(page, "/?tab=accounts");
  await waitForSection(page, "Cuentas");

  const frame = page.locator(".app-frame");
  await expect(frame).toHaveAttribute("data-theme", state.theme);
  if (state.privacyMode) await expect(frame).toHaveClass(/is-privacy-mode/);
  else await expect(frame).not.toHaveClass(/is-privacy-mode/);

  const registrySummary = page.getByLabel("Resumen de cuentas");
  await expect(registrySummary.locator("[aria-label]").first()).toBeVisible();
  if (state.privacyMode) await assertNoVisibleEuroLeak(page);
  else await expect(registrySummary.locator("[aria-label]").first()).toContainText("€");

  await page.getByRole("button", {name: "Abrir detalle"}).first().click();
  await expect(page.locator(".account-detail-header h1")).toBeVisible();
  const detailSummary = page.locator(".account-detail-header .accounts-summary");
  await expect(detailSummary.locator("[aria-label]")).toHaveCount(4);
  await expect(page.locator(".account-detail-activity")).toBeVisible();
  if (state.privacyMode) await assertNoVisibleEuroLeak(page);
  else await expect(detailSummary.locator("[aria-label]").first()).toContainText("€");

  await assertNoDocumentOverflow(page);
  await screenshotEvidence(page, testInfo, `${state.viewport.slug}-${state.theme}-${state.privacyMode ? "privacy" : "normal"}-accounts-detail.png`);
  assertNoPageErrors();
});

test("G10 Estadísticas pairwise matriz global @webkit-only", async ({page}, testInfo) => {
    test.setTimeout(180_000);
    const assertNoPageErrors = installPageErrorGuard(page);
    const state = globalPairwiseMatrix.statistics[0];
    await page.setViewportSize({width: state.viewport.width, height: state.viewport.height});
    await setAppPreferences(page, state.theme, state.privacyMode);
    await openApp(page, "/?tab=statistics");
    await waitForSection(page, "Estadísticas");
    const viewport = state.viewport;
    const theme = state.theme;
    const privacyMode = state.privacyMode;
    const chartEngine = await page.locator(".stats-view").getAttribute("data-chart-engine");

        const frame = page.locator(".app-frame");
        await expect(frame).toHaveAttribute("data-theme", theme);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (privacyMode) await expect(frame).toHaveClass(/is-privacy-mode/);
        else await expect(frame).not.toHaveClass(/is-privacy-mode/);

        const accent = theme === "basalt" ? "#b3c5d0" : "#2f4d60";
        await expect(page.locator(".stats-view")).toHaveCSS("--accent-strong", accent);
        if (chartEngine === "ag-charts") {
          await expect(page.locator(".ag-chart-shell canvas").first()).toBeVisible();
          await expect(page.locator(".ag-donut-shell canvas").first()).toBeVisible();
        } else {
          await expect(page.locator(".uplot-chart-shell canvas").first()).toBeVisible();
          await expect(page.locator(".donut-svg .donut-segment")).toHaveCount(3);
        }
        await assertNoDocumentOverflow(page);

        const familyLinks = page.getByRole("navigation", {name: "Abrir movimientos por familia principal"}).getByRole("link");
        await expect(familyLinks.first()).toBeVisible();
        const markerColor = await familyLinks.first().locator("i").evaluate((marker) => getComputedStyle(marker).backgroundColor);
        await setMountedThemeThroughSettings(page, "basalt");
        await expect(page.locator(".stats-view")).toHaveCSS("--accent-strong", "#b3c5d0");
        await expect(frame).toHaveClass(/is-privacy-mode/);
        const basaltMarkerColor = await page.getByRole("navigation", {name: "Abrir movimientos por familia principal"}).getByRole("link").first().locator("i").evaluate((marker) => getComputedStyle(marker).backgroundColor);
        expect(basaltMarkerColor).not.toBe(markerColor);
        await setMountedThemeThroughSettings(page, "mineral");
        await expect(page.locator(".stats-view")).toHaveCSS("--accent-strong", "#2f4d60");
        await expect(frame).toHaveClass(/is-privacy-mode/);
        const restoredMarkerColor = await page.getByRole("navigation", {name: "Abrir movimientos por familia principal"}).getByRole("link").first().locator("i").evaluate((marker) => getComputedStyle(marker).backgroundColor);
        expect(restoredMarkerColor).toBe(markerColor);
        const togglePrivacyName = privacyMode ? "Mostrar importes" : "Ocultar importes";
        await page.getByRole("button", {name: togglePrivacyName}).first().click();
        if (privacyMode) await expect(frame).not.toHaveClass(/is-privacy-mode/);
        else await expect(frame).toHaveClass(/is-privacy-mode/);
        const markerColorAfterPrivacyToggle = await familyLinks.first().locator("i").evaluate((marker) => getComputedStyle(marker).backgroundColor);
        expect(markerColorAfterPrivacyToggle).toBe(markerColor);
        if (privacyMode) await expect(page.locator(".stats-view")).toContainText(/\d[\d.,\s]*€/u);
        else await assertNoVisibleEuroLeak(page);
        await page.getByRole("button", {name: privacyMode ? "Ocultar importes" : "Mostrar importes"}).first().click();
        if (privacyMode) await expect(frame).toHaveClass(/is-privacy-mode/);
        else await expect(frame).not.toHaveClass(/is-privacy-mode/);
        if (privacyMode) await assertNoVisibleEuroLeak(page);
        else await expect(page.locator(".stats-view")).toContainText(/\d[\d.,\s]*€/u);

        if (chartEngine === "ag-charts") {
          const monthlyChart = page.locator('.ag-chart-shell [role="img"][tabindex="0"]').first();
          await monthlyChart.focus();
          await page.keyboard.press("ArrowRight");
          await expect(page.locator(".ag-chart-shell .ag-charts-tooltip").first()).toBeVisible();
        } else {
          const monthlyChart = page.locator('.uplot-chart-shell .u-over[role="img"][tabindex="0"]').first();
          await monthlyChart.focus();
          await page.keyboard.press("ArrowRight");
          await expect(page.locator(".chart-inspector").first()).toBeVisible();
        }
        if (privacyMode) await assertNoVisibleEuroLeak(page);

        if (chartEngine === "ag-charts") {
          const donut = page.locator(".ag-donut-shell").first();
          await donut.scrollIntoViewIfNeeded();
          const donutChart = donut.locator('[role="img"][tabindex="0"]').first();
          await donutChart.focus();
          await page.keyboard.press("ArrowRight");
          await expect(donut.locator(".ag-charts-tooltip").first()).toBeVisible();
        } else {
          const donutLink = page.locator(".donut-svg .donut-segment-link").first();
          await donutLink.focus();
          await expect(donutLink).toBeFocused();
          await expect(donutLink).toHaveAttribute("href", /category_family=/);
        }
        if (privacyMode) await assertNoVisibleEuroLeak(page);

        await expect(page.locator(".stats-category-panel")).toBeVisible();
        await expect(page.locator(".stats-money-map")).toHaveCount(0);

        await page.locator(".stats-month-table-trigger").click();
        await expect(page.getByRole("table", {name: "Datos de evolución mensual"})).toBeVisible();
        if (privacyMode) await assertNoVisibleEuroLeak(page);
        else await expect(page.getByRole("table", {name: "Datos de evolución mensual"})).toContainText("€");

        await page.getByText("Importes exactos y subcategorías", {exact: true}).first().click();
        await expect(page.locator(".stats-category-table-disclosure table")).toBeVisible();
        if (privacyMode) await assertNoVisibleEuroLeak(page);

        await page.getByText("Análisis avanzado", {exact: true}).click();
        if (viewport.width > 832) {
          await expect(page.getByRole("table", {name: "Gasto neto de cada familia por mes"})).toBeVisible();
          const matrixScroller = page.locator(".stats-matrix-scroll");
          const matrixGeometry = await matrixScroller.evaluate((element) => ({
            right: element.getBoundingClientRect().right,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
          expect(matrixGeometry.right).toBeLessThanOrEqual(viewport.width + 1);
          expect(matrixGeometry.scrollWidth).toBeLessThanOrEqual(matrixGeometry.clientWidth);
        } else {
          await expect(page.locator(".stats-matrix-mobile-explorer")).toBeVisible();
          await expect(page.getByLabel("Familia para explorar")).toBeVisible();
        }
        if (privacyMode) await assertNoVisibleEuroLeak(page);
        await screenshotEvidence(page, testInfo, `${viewport.slug}-${theme}-${privacyMode ? "privacy" : "normal"}-statistics.png`);

    assertNoPageErrors();
});

const offlineSmokeSection = sections.find(({slug}) => slug === "dashboard")!;
test("G11 Reglas de categoría conserva privacidad y foco en móvil @webkit-only", async ({page}) => {
  const viewport = viewports[1];
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: viewport.width, height: viewport.height});
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.route("**/api/category-rules/", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({rules: [{
      id: 80311,
      description: "Regla protegida E2E",
      kind: "expense",
      category: {id: 2, name: "Comida", display_name: "Comida", kind: "expense", color: "#ff9500", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false, transaction_count: 1, child_count: 0},
      active: true,
      updated_at: "2026-09-24T00:00:00Z",
      priority: 1,
      match_mode: "contains",
      account: null,
      amount_min: 12.34,
      amount_max: 45.67,
      last_tested_at: "",
      last_test_result: {},
      application_count: 0,
    }]}),
  }));
  await page.route("**/api/category-rules/conflicts/", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({conflicts: []}),
  }));

  for (const {theme, privacyMode} of [{theme: "mineral", privacyMode: false}, {theme: "basalt", privacyMode: true}] as const) {
    await setAppPreferences(page, theme, privacyMode);
    await openApp(page, settingsRulesPath);
    await waitForSection(page, "Ajustes");
    const frame = page.locator(".app-frame");
    await expect(frame).toHaveAttribute("data-theme", theme);
    if (privacyMode) await expect(frame).toHaveClass(/is-privacy-mode/);
    else await expect(frame).not.toHaveClass(/is-privacy-mode/);

    const ruleRow = page.locator(".list-card").filter({hasText: "Regla protegida E2E"});
    await expect(ruleRow).toBeVisible();
    if (privacyMode) {
      await expect(ruleRow).not.toContainText(/12,34|45,67/u);
      await assertNoVisibleEuroLeak(page);
    } else await expect(ruleRow).toContainText(/12,34.*€.*45,67.*€/u);

    const editRule = ruleRow.getByRole("button", {name: "Editar", exact: true});
    await editRule.scrollIntoViewIfNeeded();
    await editRule.focus();
    await waitForStableScroll(page);
    await editRule.press("Enter");
    const editRulePanel = page.locator(".collapsible-panel").filter({has: page.getByRole("heading", {name: "Editar regla"})});
    await expect(editRulePanel.getByLabel("Texto a reconocer")).toBeVisible();
    await expect(editRule).toBeFocused();
    const fieldBox = await editRulePanel.getByLabel("Texto a reconocer").boundingBox();
    expect(fieldBox).not.toBeNull();
    expect(fieldBox!.y).toBeGreaterThanOrEqual(0);
    expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(viewport.height);
    await assertNoDocumentOverflow(page);
  }

  await page.locator(".app-frame").evaluate((frame) => {
    const element = frame as HTMLElement;
    element.style.setProperty("--accent", "rgb(21, 91, 143)");
    element.style.setProperty("--surface", "rgb(231, 233, 235)");
    element.style.setProperty("--ui-page-title-size", "33px");
    element.style.setProperty("--ui-radius-surface", "19px");
  });
  await expect(page.getByRole("button", {name: "Guardar automatización"})).toHaveCSS("background-color", "rgb(21, 91, 143)");
  await expect(page.locator(".panel").first()).toHaveCSS("background-color", "rgb(231, 233, 235)");
  await expect(page.locator(".panel").first()).toHaveCSS("border-radius", "19px");
  await expect(page.getByRole("heading", {name: "Ajustes", exact: true})).toHaveCSS("font-size", "33px");
  assertNoPageErrors();
});

test("G12-C2 Ajustes móvil conserva el ancla al vaciar búsqueda @webkit-only", async ({page}) => {
  const viewport = viewports[1];
  const assertNoPageErrors = installPageErrorGuard(page);
  await page.setViewportSize({width: viewport.width, height: viewport.height});
  await installCategoryCatalogFixture(page);
  await setAppPreferences(page, "mineral", false);
  await openApp(page, settingsCategoriesPath);
  await waitForSection(page, "Ajustes");

  const tree = page.getByRole("region", {name: "Árbol de categorías"});
  const search = page.getByRole("textbox", {name: "Buscar categorías"});
  await search.fill("Comida");
  await expect(tree.locator(".catalog-row")).toHaveCount(2);
  await search.focus();
  const searchDocumentTop = await search.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  const scrollLimit = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await page.evaluate((target) => window.scrollTo(0, target), Math.min(Math.max(0, searchDocumentTop - 120), scrollLimit));
  const scrollBeforeEmpty = await page.evaluate(() => window.scrollY);
  const searchTopBeforeEmpty = (await search.boundingBox())?.y;
  expect(scrollBeforeEmpty).toBeGreaterThan(0);
  expect(searchTopBeforeEmpty).not.toBeUndefined();

  await search.fill("No existe");
  await expect(tree).toContainText("No hay categorías para este filtro.");
  await expect(tree.locator(".catalog-row")).toHaveCount(0);
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeEmpty);
  expect((await search.boundingBox())?.y).toBeCloseTo(searchTopBeforeEmpty!, 0);
  await assertNoDocumentOverflow(page);
  assertNoPageErrors();
});

for (const viewport of viewports) {
  test(`U6 offline conserva lectura y foco de la shell en ${viewport.slug} ${assignedBrowser(viewport)}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await setAppPreferences(page, "mineral", false);

    await openApp(page, offlineSmokeSection.path);
    await waitForSection(page, offlineSmokeSection.heading);
    await page.waitForLoadState("networkidle");
    const main = page.locator("#main-content");
    const heading = main.getByRole("heading", {name: offlineSmokeSection.heading, exact: true}).first();
    await expect(heading).toBeVisible();
    await main.evaluate((element) => (element as HTMLElement).focus({preventScroll: true}));
    await page.evaluate(() => window.scrollTo(0, Math.min(120, document.documentElement.scrollHeight - innerHeight)));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const headingTopBefore = (await heading.boundingBox())?.y;
    expect(headingTopBefore).not.toBeUndefined();

    await page.context().setOffline(true);
    await expect(page.getByRole("status", {name: /Sin conexión/}).first()).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(main).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await heading.boundingBox())?.y).toBeCloseTo(headingTopBefore!, 0);
    await assertNoDocumentOverflow(page);

    await page.context().setOffline(false);
    await expect(page.getByRole("status", {name: /Sin conexión/})).toHaveCount(0);
    await expect(main).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect((await heading.boundingBox())?.y).toBeCloseTo(headingTopBefore!, 0);

    assertNoPageErrors();
  });
}

for (const reducedMotion of [false, true] as const) {
  test(`U6 fallo de actualización manual conserva la lectura ${reducedMotion ? "reduced-motion" : "motion"} ${reducedMotion ? "@webkit-only" : "@chromium-only"}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
    await setAppPreferences(page, "mineral", false);
    await openApp(page, "/?tab=transactions");
    await waitForSection(page, "Movimientos");
    const main = page.locator("#main-content");
    const heading = main.getByRole("heading", {name: "Movimientos", exact: true}).first();
    await expect(heading).toBeVisible();
    await main.evaluate((element) => (element as HTMLElement).focus({preventScroll: true}));
    await expect.poll(async () => {
      const before = (await heading.boundingBox())?.y;
      await page.waitForTimeout(50);
      const after = (await heading.boundingBox())?.y;
      return before === undefined || after === undefined ? Number.POSITIVE_INFINITY : Math.abs(after - before);
    }, {timeout: 3000}).toBeLessThanOrEqual(0.5);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const headingTopBefore = (await heading.boundingBox())?.y;
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    let refreshAttempts = 0;
    const refreshGate = new Promise<void>((resolve) => {releaseRefresh = resolve;});
    const refreshStarted = new Promise<void>((resolve) => {markRefreshStarted = resolve;});
    await page.route("**/api/bootstrap/", async (route) => {
      refreshAttempts += 1;
      if (refreshAttempts > 1) {
        await route.continue();
        return;
      }
      markRefreshStarted();
      await refreshGate;
      await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Servidor temporalmente indisponible."})});
    });

    try {
      const zone = page.locator(".pull-zone");
      await zone.evaluate((element) => {
        const dispatch = (type: string, clientY: number) => {
          const event = new Event(type, {bubbles: true, cancelable: true});
          const touches = type === "touchend" ? [] : [{clientY}];
          Object.defineProperty(event, "touches", {value: touches});
          Object.defineProperty(event, "targetTouches", {value: touches});
          Object.defineProperty(event, "changedTouches", {value: [{clientY}]});
          element.dispatchEvent(event);
        };
        dispatch("touchstart", 100);
        dispatch("touchmove", 260);
      });
      await expect(page.locator(".pull-indicator.ready")).toBeVisible();
      await zone.evaluate((element) => {
        const event = new Event("touchend", {bubbles: true, cancelable: true});
        Object.defineProperty(event, "touches", {value: []});
        Object.defineProperty(event, "targetTouches", {value: []});
        Object.defineProperty(event, "changedTouches", {value: [{clientY: 260}]});
        element.dispatchEvent(event);
      });
      await refreshStarted;
      await expect(page.locator(".pull-indicator.refreshing")).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      expect((await heading.boundingBox())?.y).toBeCloseTo(headingTopBefore!, 0);
      await expect(main).toBeFocused();

      releaseRefresh();
      const offlineStatus = page.locator(".app-offline-indicator");
      await expect(offlineStatus).toBeVisible();
      await expect(offlineStatus).toContainText("Sin conexión");
      await expect(offlineStatus).toHaveAttribute("aria-label", /Mostrando datos guardados del/);
      expect(Math.abs((await heading.boundingBox())!.y - headingTopBefore!)).toBeLessThanOrEqual(2);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);
      await expect(main).toBeFocused();
      await expect(page.locator("#main-content > .message.error")).toHaveCount(0);
      await expect(page.locator(".app-refresh-error-indicator")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await zone.evaluate((element) => {
        const dispatch = (type: string, clientY: number) => {
          const event = new Event(type, {bubbles: true, cancelable: true});
          const touches = type === "touchend" ? [] : [{clientY}];
          Object.defineProperty(event, "touches", {value: touches});
          Object.defineProperty(event, "targetTouches", {value: touches});
          Object.defineProperty(event, "changedTouches", {value: [{clientY}]});
          element.dispatchEvent(event);
        };
        dispatch("touchstart", 100);
        dispatch("touchmove", 260);
      });
      await expect(page.locator(".pull-indicator.ready")).toBeVisible();
      await zone.evaluate((element) => {
        const event = new Event("touchend", {bubbles: true, cancelable: true});
        Object.defineProperty(event, "touches", {value: []});
        Object.defineProperty(event, "targetTouches", {value: []});
        Object.defineProperty(event, "changedTouches", {value: [{clientY: 260}]});
        element.dispatchEvent(event);
      });
      await expect.poll(() => refreshAttempts).toBe(2);
      await expect(page.locator(".app-offline-indicator")).toHaveCount(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      expect((await heading.boundingBox())?.y).toBeCloseTo(headingTopBefore!, 0);
      await expect(main).toBeFocused();
      assertNoPageErrors();
    } finally {
      releaseRefresh();
    }
  });
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    test(`U6 fallback 5xx conserva la vista ${viewport.slug} ${reducedMotion ? "reduced-motion" : "motion"} ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await setAppPreferences(page, "mineral", false);
      let failNextRefresh = false;
      await page.route("**/api/bootstrap/", async (route) => {
        if (!failNextRefresh) {
          await route.continue();
          return;
        }
        failNextRefresh = false;
        await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Servidor temporalmente indisponible."})});
      });

      // AppShell's 5xx fallback is shared; feature-specific API errors remain in domain suites.
      const section = sections.find(({slug}) => slug === "transactions")!;
      await openApp(page, section.path);
      await waitForSection(page, section.heading);
      await page.waitForLoadState("networkidle");
      const main = page.locator("#main-content");
      const heading = main.getByRole("heading", {name: section.heading, exact: true}).first();
      await expect(heading).toBeVisible();
      await main.evaluate((element) => (element as HTMLElement).focus({preventScroll: true}));
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForStableScroll(page);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const headingTopBefore = (await heading.boundingBox())?.y;
      failNextRefresh = true;

      const zone = page.locator(".pull-zone");
      await zone.evaluate((element) => {
        const dispatch = (type: string, clientY: number) => {
          const event = new Event(type, {bubbles: true, cancelable: true});
          const touches = type === "touchend" ? [] : [{clientY}];
          Object.defineProperty(event, "touches", {value: touches});
          Object.defineProperty(event, "targetTouches", {value: touches});
          Object.defineProperty(event, "changedTouches", {value: [{clientY}]});
          element.dispatchEvent(event);
        };
        dispatch("touchstart", 100);
        dispatch("touchmove", 260);
      });
      await expect(page.locator(".pull-indicator.ready")).toBeVisible();
      await zone.evaluate((element) => {
        const event = new Event("touchend", {bubbles: true, cancelable: true});
        Object.defineProperty(event, "touches", {value: []});
        Object.defineProperty(event, "targetTouches", {value: []});
        Object.defineProperty(event, "changedTouches", {value: [{clientY: 260}]});
        element.dispatchEvent(event);
      });
      await expect.poll(() => failNextRefresh).toBe(false);
      await expect(page.getByRole("status", {name: /Sin conexión/})).toBeVisible();
      expect(Math.abs((await heading.boundingBox())!.y - headingTopBefore!)).toBeLessThanOrEqual(2);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);
      await expect(main).toBeFocused();
      await expect(page.locator("#main-content > .message.error")).toHaveCount(0);
      await assertNoDocumentOverflow(page);

      assertNoPageErrors();
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    test(`U6 aviso PWA conserva lectura y foco ${viewport.slug} ${reducedMotion ? "reduced-motion" : "motion"} ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await installPwaUpdateFixture(page);
      await setAppPreferences(page, "mineral", false);
      await openApp(page, "/?tab=transactions");
      await waitForSection(page, "Movimientos");
      const main = page.locator("#main-content");
      const heading = main.getByRole("heading", {name: "Movimientos", exact: true}).first();
      await expect(heading).toBeVisible();
      await main.evaluate((element) => (element as HTMLElement).focus({preventScroll: true}));
      await expect.poll(async () => {
        const before = (await heading.boundingBox())?.y;
        await page.waitForTimeout(50);
        const after = (await heading.boundingBox())?.y;
        return before === undefined || after === undefined ? Number.POSITIVE_INFINITY : Math.abs(after - before);
      }, {timeout: 3000}).toBeLessThanOrEqual(0.5);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const headingTopBefore = (await heading.boundingBox())?.y;

      await page.evaluate(() => (window as Window & {__triggerPwaUpdate?: () => void}).__triggerPwaUpdate?.());
      const updateStatus = page.getByRole("status").filter({hasText: "Hay una actualización disponible. Puedes aplicarla ahora."});
      await expect(updateStatus).toHaveText("Hay una actualización disponible. Puedes aplicarla ahora.");
      const apply = page.getByRole("button", {name: "Actualizar ahora", exact: true});
      await expect(apply).toBeEnabled();
      await expect(page.locator(".app-update-banner")).toHaveCount(0);
      if (viewport.slug.startsWith("mobile")) {
        const contextLabel = page.locator(".app-header-context-label");
        expect(await contextLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      expect(Math.abs((await heading.boundingBox())!.y - headingTopBefore!)).toBeLessThanOrEqual(2);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);
      await expect(main).toBeFocused();
      await assertNoDocumentOverflow(page);

      await apply.evaluate((button) => (button as HTMLButtonElement).focus({preventScroll: true}));
      await expect(apply).toBeFocused();
      await apply.press("Enter");
      await expect.poll(() => page.evaluate(() => (window as Window & {__pwaUpdateMessages?: unknown[]}).__pwaUpdateMessages)).toEqual([{type: "SKIP_WAITING"}]);
      const applying = page.getByRole("button", {name: "Actualizando aplicación", exact: true});
      await expect(applying).toHaveAttribute("aria-disabled", "true");
      await expect(applying).toHaveAttribute("aria-busy", "true");
      expect(await applying.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
      await expect(applying).toBeFocused();
      await expect(page.getByRole("status").filter({hasText: "Aplicando la actualización."})).toHaveText("Aplicando la actualización.");
      await applying.press("Enter");
      await expect.poll(() => page.evaluate(() => (window as Window & {__pwaUpdateMessages?: unknown[]}).__pwaUpdateMessages)).toEqual([{type: "SKIP_WAITING"}]);
      expect((await heading.boundingBox())?.y).toBeCloseTo(headingTopBefore!, 0);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      await expect(applying).toBeFocused();
      assertNoPageErrors();
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    test(`U6 borrador bloquea la aplicación PWA sin mover la vista ${viewport.slug} ${reducedMotion ? "reduced-motion" : "motion"} ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await installPwaUpdateFixture(page);
      await setAppPreferences(page, "mineral", false);
      await openApp(page, "/?tab=transactions");
      await waitForSection(page, "Movimientos");
      const main = page.locator("#main-content");
      const heading = main.getByRole("heading", {name: "Movimientos", exact: true}).first();
      await page.getByRole("button", {name: "Añadir movimiento"}).click();
      const concept = page.locator(".composer-panel").first().locator("form").getByLabel("Concepto");
      await concept.fill("Borrador pendiente de guardar");
      await expect(concept).toBeFocused();
      await expect.poll(async () => {
        const before = {scroll: await page.evaluate(() => window.scrollY), heading: (await heading.boundingBox())?.y};
        await page.waitForTimeout(50);
        const after = {scroll: await page.evaluate(() => window.scrollY), heading: (await heading.boundingBox())?.y};
        return Math.max(Math.abs(after.scroll - before.scroll), Math.abs((after.heading ?? 0) - (before.heading ?? 0)));
      }, {timeout: 3000}).toBeLessThanOrEqual(0.5);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const headingTopBefore = (await heading.boundingBox())?.y;

      await page.evaluate(() => (window as Window & {__triggerPwaUpdate?: () => void}).__triggerPwaUpdate?.());
      const updateStatus = page.getByRole("status").filter({hasText: "Termina o descarta los cambios del formulario antes de actualizar."});
      await expect(updateStatus).toContainText("Hay una actualización disponible.");
      const updateAction = page.getByRole("button", {name: "Actualizar aplicación no disponible mientras haya cambios sin guardar"});
      await expect(updateAction).toBeDisabled();
      await expect(updateAction).toHaveAttribute("title", "Hay una actualización disponible. Termina o descarta los cambios del formulario antes de actualizar.");
      expect(await page.evaluate(() => (window as Window & {__pwaUpdateMessages?: unknown[]}).__pwaUpdateMessages)).toEqual([]);
      expect(Math.abs((await heading.boundingBox())!.y - headingTopBefore!)).toBeLessThanOrEqual(2);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);
      await expect(concept).toBeFocused();
      await expect(page.locator(".app-update-banner")).toHaveCount(0);
      assertNoPageErrors();
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    test(`U6 error global conserva lectura en Movimientos ${viewport.slug} ${reducedMotion ? "reduced-motion" : "motion"} ${assignedBrowser(viewport, reducedMotion)}`, async ({page}) => {
      test.setTimeout(120_000);
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await setAppPreferences(page, "mineral", false);

      const section = sections.find(({slug}) => slug === "transactions")!;
      await openApp(page, section.path);
      await waitForSection(page, section.heading);
      await page.waitForLoadState("networkidle");
      const main = page.locator("#main-content");
      const heading = main.getByRole("heading", {name: section.heading, exact: true}).first();
      await expect(heading).toBeVisible();
      await main.evaluate((element) => (element as HTMLElement).focus({preventScroll: true}));
      await page.evaluate(() => window.scrollTo(0, Math.min(120, Math.max(0, document.documentElement.scrollHeight - innerHeight))));
      await waitForStableScroll(page);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const headingTopBefore = (await heading.boundingBox())?.y;
      const errorMessage = "Error global de lectura E2E.";

      await page.evaluate((message) => {
        const event = new Event("unhandledrejection", {bubbles: false, cancelable: true});
        Object.defineProperty(event, "reason", {value: new Error(message)});
        window.dispatchEvent(event);
      }, errorMessage);

      const error = page.locator("#main-content > .message.error, .app-global-error-indicator");
      await expect(error).toHaveCount(1);
      await expect(error).toContainText(errorMessage);
      await expect(page.locator(".app-global-error-indicator")).toHaveAttribute("aria-label", errorMessage);
      expect(Math.abs((await heading.boundingBox())!.y - headingTopBefore!)).toBeLessThanOrEqual(2);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(2);
      await expect(main).toBeFocused();
      await expect(page.locator("#main-content > .message.error")).toHaveCount(0);
      await assertNoDocumentOverflow(page);

      assertNoPageErrors();
    });
  }
}


for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-B Ajustes ${viewport.slug} perfiles CSV ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
    const assertNoPageErrors = installPageErrorGuard(page);
    const fixtureState: {profileCreated?: boolean} = {profileCreated: false};
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
    await installSettingsImportsFixture(page, fixtureState);
    const profileCreateFixture = await installSettingsProfileCreateFixture(page, fixtureState);
    await setAppPreferences(page, "mineral", false);
    await openApp(page, settingsImportsPath);
    await waitForSection(page, "Ajustes");

    const csvPanel = page.locator(".settings-import-profiles");
    await expect(csvPanel.locator(".collapsed-summary")).toContainText("0 perfiles guardados");
    const profileDisclosure = csvPanel.getByRole("button", {name: "Expandir perfiles csv"});
    await profileDisclosure.click();
    await expect(csvPanel.getByLabel("Nombre")).toBeVisible();
    await expect(csvPanel.getByLabel("Nombre")).toHaveAttribute("required", "");
    await expect(csvPanel.getByRole("button", {name: "Guardar perfil"})).toBeDisabled();
    const profileNameInput = csvPanel.getByLabel("Nombre");
    await profileNameInput.click();
    await profileNameInput.pressSequentially("Perfil creado E2E");
    await expect(csvPanel.getByLabel("Nombre")).toHaveValue("Perfil creado E2E");
    const saveProfile = csvPanel.locator("form button[type=submit]");
    await expect(saveProfile).toBeEnabled();
    await saveProfile.scrollIntoViewIfNeeded();
    await saveProfile.focus();
    const profileScroll = await page.evaluate(() => window.scrollY);
    const profileSaveTop = (await saveProfile.boundingBox())?.y;
    await saveProfile.press("Enter");
    await profileCreateFixture.firstRequestArrived;
    await expect(csvPanel.locator("form")).toHaveAttribute("aria-busy", "true");
    const pendingProfileSave = saveProfile;
    await expect(pendingProfileSave).toHaveAttribute("aria-disabled", "true");
    await expect(pendingProfileSave).toHaveAttribute("aria-busy", "true");
    expect(await pendingProfileSave.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
    await expect(pendingProfileSave).toBeFocused();
    await expect(csvPanel.getByLabel("Nombre")).toBeDisabled();
    expect(await page.evaluate(() => window.scrollY)).toBe(profileScroll);
    expect((await pendingProfileSave.boundingBox())?.y).toBeCloseTo(profileSaveTop!, 0);
    await csvPanel.locator("form").evaluate((form) => form.requestSubmit(form.querySelector("button[type=submit]") as HTMLButtonElement));
    expect(profileCreateFixture.requests).toHaveLength(1);
    profileCreateFixture.releaseFirstResponse();
    await expect(page.getByRole("alert")).toContainText("Ya existe un perfil con ese nombre.");
    await expect(csvPanel.getByLabel("Nombre")).toHaveValue("Perfil creado E2E");
    await expect(saveProfile).toBeEnabled();
    await expect(saveProfile).toBeFocused();
    const startProfileMotionSamples = () => page.evaluate(() => {
      const auditWindow = window as typeof window & {__profileEntryHeights?: number[]};
      auditWindow.__profileEntryHeights = [];
      const begin = (element: HTMLElement) => {
        let frame = 0;
        const sample = () => {
          auditWindow.__profileEntryHeights!.push(element.getBoundingClientRect().height);
          frame += 1;
          if (frame < 24) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      };
      const mounted = document.querySelector<HTMLElement>(".csv-profile-entry-motion");
      if (mounted) begin(mounted);
      else {
        const observer = new MutationObserver(() => {
          const element = document.querySelector<HTMLElement>(".csv-profile-entry-motion");
          if (!element) return;
          observer.disconnect();
          begin(element);
        });
        observer.observe(document.body, {childList: true, subtree: true});
      }
    });
    const finishProfileMotionSamples = async () => {
      await page.waitForFunction(() => (window as typeof window & {__profileEntryHeights?: number[]}).__profileEntryHeights?.length === 24);
      const heights = await page.evaluate(() => (window as typeof window & {__profileEntryHeights?: number[]}).__profileEntryHeights || []);
      const range = Math.max(...heights) - Math.min(...heights);
      if (reducedMotion) expect(range).toBeLessThan(1);
      else expect(range).toBeGreaterThan(10);
    };
    await startProfileMotionSamples();
    await saveProfile.click();
    await expect(page.getByRole("status")).toContainText("Perfil CSV creado.");
    const createdProfile = csvPanel.getByRole("group", {name: "Perfil Perfil creado E2E"});
    await expect(createdProfile).toBeFocused();
    await expect(createdProfile).toBeInViewport();
    await finishProfileMotionSamples();
    await expect(createdProfile).toBeFocused();
    await expect(createdProfile).toBeInViewport();
    await csvPanel.getByRole("button", {name: "Comprimir perfiles csv"}).click();
    await expect(csvPanel.locator(".collapsed-summary")).toContainText("1 perfil guardado");
    await csvPanel.getByRole("button", {name: "Expandir perfiles csv"}).click();
    await expect(csvPanel.getByLabel("Nombre")).toHaveValue("");
    await expect(csvPanel.getByRole("button", {name: "Guardar perfil"})).toBeDisabled();
    await expect(csvPanel.getByText("Perfil creado E2E")).toBeVisible();
    expect(profileCreateFixture.requests).toHaveLength(2);
    for (const request of profileCreateFixture.requests) {
      expect(request.contentType).toContain("application/json");
      expect(JSON.parse(request.body)).toMatchObject({name: "Perfil creado E2E", delimiter: ",", date_column: "date", description_column: "description", amount_column: "amount"});
    }

    await openApp(page, settingsImportsPath);
    await waitForSection(page, "Ajustes");
    const populatedPanel = page.locator(".settings-import-profiles");
    await expect(populatedPanel.locator(".collapsed-summary")).toContainText("1 perfil guardado");
    await populatedPanel.getByRole("button", {name: "Expandir perfiles csv"}).click();
    await expect(populatedPanel.getByText("Perfil creado E2E")).toBeVisible();
    await assertNoDocumentOverflow(page);
    assertNoPageErrors();
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-C4 Ajustes ${viewport.slug} preview de desactivación conserva foco ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await installCategoryCatalogFixture(page);
      await setAppPreferences(page, "mineral", false);
      let releasePreview!: () => void;
      let markPreviewStarted!: () => void;
      const previewGate = new Promise<void>((resolve) => {releasePreview = resolve;});
      const previewStarted = new Promise<void>((resolve) => {markPreviewStarted = resolve;});
      let previewRequests = 0;
      await page.route("**/api/categories/*/preview-deactivate/", async (route) => {
        previewRequests += 1;
        if (previewRequests === 1) {
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Preview rechazado por fixture."})});
          return;
        }
        markPreviewStarted();
        await previewGate;
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, impact: {transactions: 1, budgets: 0, rules: 0, imports: 0}})});
      });

      try {
        await openApp(page, settingsCategoriesPath);
        await waitForSection(page, "Ajustes");
        const tree = page.getByRole("region", {name: "Árbol de categorías"});
        await expect(tree.locator(".catalog-row")).toHaveCount(4);
        const previewRow = tree.locator('.catalog-row[data-category-id="9041"]');
        const actionTrigger = previewRow.getByRole("button", {name: "Acciones de Comida"});
        await expect(actionTrigger).toBeVisible();
        await actionTrigger.click();
        const previewButton = previewRow.getByRole("button", {name: /^(Desactivar|Calculando impacto)$/});
        await expect(previewButton).toBeVisible();
        await previewButton.scrollIntoViewIfNeeded();
        await previewButton.focus();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await previewButton.press("Enter");
        await expect(previewRow.getByRole("alert")).toHaveText("No se pudo calcular el impacto de la desactivación.");
        await expect(actionTrigger).toBeFocused();
        await expect(actionTrigger).toBeInViewport();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await actionTrigger.press("Enter");
        await expect(previewButton).toBeVisible();
        await previewButton.focus();
        await previewButton.press("Enter");
        await previewStarted;
        expect(previewRequests).toBe(2);
        await expect(previewButton).toHaveAccessibleName("Calculando impacto");
        await expect(previewButton).toHaveAttribute("aria-disabled", "true");
        await expect(previewButton).toHaveAttribute("aria-busy", "true");
        expect(await previewButton.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(previewButton).toBeFocused();
        await expect(previewButton).toBeInViewport();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

        releasePreview();
        await expect(previewRow.getByText("Desactivar «Comida»?", {exact: true})).toBeVisible();
        await expect(actionTrigger).toBeFocused();
        await expect(actionTrigger).toBeInViewport();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        assertNoPageErrors();
      } finally {
        releasePreview();
      }
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-C5 Ajustes ${viewport.slug} confirmación de desactivación conserva foco ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await installCategoryCatalogFixture(page);
      await setAppPreferences(page, "mineral", false);
      let releaseDeactivation!: () => void;
      let markDeactivationStarted!: () => void;
      const deactivationGate = new Promise<void>((resolve) => {releaseDeactivation = resolve;});
      const deactivationStarted = new Promise<void>((resolve) => {markDeactivationStarted = resolve;});
      let deactivationRequests = 0;
      await page.route("**/api/categories/*/preview-deactivate/", async (route) => {
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, impact: {transactions: 1, budgets: 0, rules: 0, imports: 0}})});
      });
      await page.route("**/api/categories/*/deactivate/", async (route) => {
        deactivationRequests += 1;
        if (deactivationRequests === 1) {
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Desactivación rechazada por fixture."})});
          return;
        }
        markDeactivationStarted();
        await deactivationGate;
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true, category: {id: 9041, name: "Comida", display_name: "Comida", kind: "expense", color: "#ff9500", icon: "", active: false, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false, transaction_count: 4, child_count: 1}})});
      });

      try {
        await openApp(page, settingsCategoriesPath);
        await waitForSection(page, "Ajustes");
        const tree = page.getByRole("region", {name: "Árbol de categorías"});
        const categoryRow = tree.locator('.catalog-row[data-category-id="9041"]');
        await categoryRow.getByRole("button", {name: "Acciones de Comida"}).click();
        const previewButton = categoryRow.getByRole("button", {name: "Desactivar", exact: true});
        await previewButton.click();
        await expect(categoryRow.getByText("Desactivar «Comida»?", {exact: true})).toBeVisible();
        const confirmButton = page.getByRole("button", {name: "Confirmar desactivación"});
        await confirmButton.scrollIntoViewIfNeeded();
        await confirmButton.focus();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await confirmButton.press("Enter");
        const confirmation = page.locator(".inline-confirm");
        await expect(confirmation.getByRole("alert")).toHaveText("No se pudo desactivar la categoría. La confirmación sigue disponible.");
        await expect(confirmButton).toBeFocused();
        await expect(confirmButton).toBeInViewport();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await confirmButton.press("Enter");
        await deactivationStarted;
        expect(deactivationRequests).toBe(2);
        const pendingConfirm = page.getByRole("button", {name: "Desactivando…"});
        await expect(pendingConfirm).toHaveAttribute("aria-disabled", "true");
        await expect(pendingConfirm).toHaveAttribute("aria-busy", "true");
        expect(await pendingConfirm.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(pendingConfirm).toBeFocused();
        await expect(pendingConfirm).toBeInViewport();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await pendingConfirm.press("Enter");
        expect(deactivationRequests).toBe(2);

        releaseDeactivation();
        await expect(tree).toBeFocused();
        await expect(tree).toBeInViewport();
        await expect(tree.getByRole("status")).toHaveText("Categoría desactivada; el histórico se conserva.");
        assertNoPageErrors();
      } finally {
        releaseDeactivation();
      }
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-C6 Ajustes ${viewport.slug} favorita y mantenimiento conservan foco al reintentar ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await installCategoryCatalogFixture(page);
      await setAppPreferences(page, "mineral", false);
      const categoryRow = page.locator(".catalog-row").filter({hasText: "Comida"}).first();
      let releaseFavorite!: () => void;
      let markFavoriteStarted!: () => void;
      const favoriteGate = new Promise<void>((resolve) => {releaseFavorite = resolve;});
      const favoriteStarted = new Promise<void>((resolve) => {markFavoriteStarted = resolve;});
      let favoriteRequests = 0;
      let releaseDuplicates!: () => void;
      let markDuplicatesStarted!: () => void;
      const duplicatesGate = new Promise<void>((resolve) => {releaseDuplicates = resolve;});
      const duplicatesStarted = new Promise<void>((resolve) => {markDuplicatesStarted = resolve;});
      let duplicateRequests = 0;
      await page.route("**/api/categories/9041/", async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        favoriteRequests += 1;
        if (favoriteRequests === 1) {
          markFavoriteStarted();
          await favoriteGate;
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Favorito rechazado por fixture."})});
          return;
        }
        await route.fulfill({json: {ok: true, category: {id: 9041, name: "Comida", is_favorite: true}}});
      });
      await page.route("**/api/categories/duplicates/", async (route) => {
        duplicateRequests += 1;
        if (duplicateRequests === 1) {
          markDuplicatesStarted();
          await duplicatesGate;
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Duplicados no disponibles en fixture."})});
          return;
        }
        await route.fulfill({json: {groups: []}});
      });

      try {
        await openApp(page, settingsCategoriesPath);
        await waitForSection(page, "Ajustes");
        const favoriteButton = page.getByRole("button", {name: "Marcar Comida como favorita"});
        await favoriteButton.scrollIntoViewIfNeeded();
        await favoriteButton.focus();
        const favoriteScroll = await page.evaluate(() => window.scrollY);
        const favoriteTop = (await favoriteButton.boundingBox())?.y;
        await favoriteButton.click();
        await favoriteStarted;
        await expect(favoriteButton).toHaveAttribute("aria-disabled", "true");
        await expect(favoriteButton).toHaveAttribute("aria-busy", "true");
        expect(await favoriteButton.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(favoriteButton).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(favoriteScroll);
        expect((await favoriteButton.boundingBox())?.y).toBeCloseTo(favoriteTop!, 0);
        await favoriteButton.evaluate((button) => button.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        expect(favoriteRequests).toBe(1);
        const sampleKey = `catalog-row-feedback-${viewport.slug}-${reducedMotion ? "reduced" : "motion"}`;
        await page.evaluate((key) => {
          const auditWindow = window as typeof window & {__catalogFeedbackSamples?: Record<string, number[]>};
          auditWindow.__catalogFeedbackSamples ||= {};
          const samples = auditWindow.__catalogFeedbackSamples[key] = [];
          const followingRow = document.querySelectorAll(".catalog-row")[2];
          let frame = 0;
          const sample = () => {
            if (followingRow?.isConnected) samples.push(followingRow.getBoundingClientRect().top + window.scrollY);
            if (frame++ < 23) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, sampleKey);
        releaseFavorite();
        const favoriteError = categoryRow.getByRole("alert");
        await expect(favoriteError).toHaveText("No se pudo actualizar la categoría favorita.");
        await expect(favoriteButton).toBeFocused();
        expect(await favoriteError.evaluate((node) => node.closest(".catalog-row") !== null)).toBe(true);
        expect(await page.evaluate(() => window.scrollY)).toBe(favoriteScroll);
        expect((await favoriteButton.boundingBox())?.y).toBeCloseTo(favoriteTop!, 0);
        await page.waitForFunction((key) => ((window as typeof window & {__catalogFeedbackSamples?: Record<string, number[]>}).__catalogFeedbackSamples?.[key]?.length || 0) >= 24, sampleKey);
        const feedbackPositions = await page.evaluate((key) => (window as typeof window & {__catalogFeedbackSamples?: Record<string, number[]>}).__catalogFeedbackSamples?.[key] || [], sampleKey);
        const firstPosition = feedbackPositions[0];
        const finalPosition = feedbackPositions[feedbackPositions.length - 1];
        const hasIntermediateMovement = feedbackPositions.some((position) => Math.abs(position - firstPosition) > 1 && Math.abs(position - finalPosition) > 1);
        expect(hasIntermediateMovement).toBe(!reducedMotion);

        await favoriteButton.click();
        await expect(categoryRow.getByRole("status")).toHaveText("Categoría marcada como favorita.");
        await expect(favoriteButton).toBeFocused();

        const duplicatesButton = page.getByRole("button", {name: "Detectar duplicados"});
        const unusedButton = page.getByRole("button", {name: "Revisar sin uso"});
        await duplicatesButton.scrollIntoViewIfNeeded();
        await duplicatesButton.focus();
        await duplicatesButton.click();
        await duplicatesStarted;
        const pendingDuplicates = page.getByRole("button", {name: "Detectando duplicados…"});
        await expect(pendingDuplicates).toHaveAttribute("aria-disabled", "true");
        await expect(pendingDuplicates).toHaveAttribute("aria-busy", "true");
        expect(await pendingDuplicates.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(pendingDuplicates).toBeFocused();
        await expect(unusedButton).toHaveAttribute("aria-disabled", "true");
        const maintenanceScroll = await page.evaluate(() => window.scrollY);
        const maintenanceTop = (await pendingDuplicates.boundingBox())?.y;
        expect((await pendingDuplicates.boundingBox())?.y).toBeCloseTo(maintenanceTop!, 0);
        await pendingDuplicates.evaluate((button) => button.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        await unusedButton.evaluate((button) => button.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        expect(duplicateRequests).toBe(1);
        releaseDuplicates();
        const maintenance = page.locator(".catalog-maintenance");
        await expect(maintenance.getByRole("alert")).toHaveText("No se pudieron detectar duplicados.");
        await expect(duplicatesButton).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(maintenanceScroll);
        expect((await duplicatesButton.boundingBox())?.y).toBeCloseTo(maintenanceTop!, 0);
        await duplicatesButton.click();
        await expect(maintenance.getByRole("status")).toHaveText("0 posibles grupos duplicados detectados.");
        await expect(duplicatesButton).toBeFocused();
        assertNoPageErrors();
      } finally {
        releaseFavorite();
        releaseDuplicates();
      }
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-C6b Ajustes al retirar la última favorita conserva destino de foco ${viewport.slug} ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      const fixture = await installCategoryCatalogFixture(page);
      await setAppPreferences(page, "mineral", false);
      const favorite = fixture.categories.find((item) => item.id === 9044)!;
      await page.route("**/api/categories/9044/", async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        favorite.is_favorite = false;
        await route.fulfill({json: {ok: true, category: favorite}});
      });

      await openApp(page, settingsCategoriesPath);
      await waitForSection(page, "Ajustes");
      await page.getByRole("button", {name: "Favoritas", exact: true}).click();
      const favoriteButton = page.getByRole("button", {name: "Quitar Favorita de favoritas"});
      await favoriteButton.scrollIntoViewIfNeeded();
      await favoriteButton.focus();
      const tree = page.getByRole("region", {name: "Árbol de categorías"});
      const treeHeight = await tree.evaluate((node) => node.getBoundingClientRect().height);
      const scrollBefore = await page.evaluate(() => window.scrollY);

      await favoriteButton.click();
      await expect(favoriteButton).toHaveCount(0);
      await expect(tree).toBeFocused();
      await expect(tree.getByRole("status")).toHaveText("Categoría retirada de favoritas.");
      await expect(tree).toContainText("No hay categorías para este filtro.");
      expect(await tree.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(treeHeight);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      assertNoPageErrors();
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-F Automatizaciones ${viewport.slug} vista previa y undo de regla conservan foco ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await installAutomationRuleFixture(page);
      await setAppPreferences(page, "mineral", false);
      let releasePreview!: () => void;
      let markPreviewStarted!: () => void;
      const previewGate = new Promise<void>((resolve) => {releasePreview = resolve;});
      const previewStarted = new Promise<void>((resolve) => {markPreviewStarted = resolve;});
      let previewRequests = 0;
      let releaseUndo!: () => void;
      let markUndoStarted!: () => void;
      const undoGate = new Promise<void>((resolve) => {releaseUndo = resolve;});
      const undoStarted = new Promise<void>((resolve) => {markUndoStarted = resolve;});
      let undoRequests = 0;
      await page.route("**/api/category-rules/80311/preview/", async (route) => {
        previewRequests += 1;
        markPreviewStarted();
        await previewGate;
        await route.fulfill({json: {ok: true, result: {transactions: 1, bank_rows: 1, csv_rows: 1, total: 3, changes: 2, already_categorized: 1, examples: [{description: "Compra supermercado", amount: ""}]}}});
      });
      await page.route("**/api/category-rules/80311/apply/", (route) => route.fulfill({json: {ok: true, result: {application_id: 7, transactions: 1, bank_rows: 1, csv_rows: 1, total: 3}}}));
      await page.route("**/api/category-rules/80311/undo/7/", async (route) => {
        undoRequests += 1;
        markUndoStarted();
        await undoGate;
        await route.fulfill({json: {ok: true, partial: false}});
      });
      const startHeightSamples = async (key: string) => page.evaluate((sampleKey) => {
        const auditWindow = window as typeof window & {__ruleMotionSamples?: Record<string, Array<{height: number; connected: boolean}>>};
        auditWindow.__ruleMotionSamples ||= {};
        auditWindow.__ruleMotionSamples[sampleKey] = [];
        const beginSampling = (element: HTMLElement) => {
          let frame = 0;
          const sample = () => {
            auditWindow.__ruleMotionSamples![sampleKey].push({height: element.getBoundingClientRect().height, connected: element.isConnected});
            frame += 1;
            if (frame < 20) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        };
        const mounted = document.querySelector<HTMLElement>(".category-rule-result-motion");
        if (mounted) beginSampling(mounted);
        else {
          const observer = new MutationObserver(() => {
            const element = document.querySelector<HTMLElement>(".category-rule-result-motion");
            if (!element) return;
            observer.disconnect();
            beginSampling(element);
          });
          observer.observe(document.body, {childList: true, subtree: true});
        }
      }, key);
      const finishHeightSamples = async (key: string) => {
        await page.waitForFunction((sampleKey) => {
          const auditWindow = window as typeof window & {__ruleMotionSamples?: Record<string, Array<{height: number; connected: boolean}>>};
          return (auditWindow.__ruleMotionSamples?.[sampleKey].length || 0) >= 20;
        }, key);
        const samples = await page.evaluate((sampleKey) => {
          const auditWindow = window as typeof window & {__ruleMotionSamples?: Record<string, Array<{height: number; connected: boolean}>>};
          return auditWindow.__ruleMotionSamples?.[sampleKey] || [];
        }, key);
        const heights = samples.filter((sample) => sample.connected).map((sample) => sample.height);
        const range = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;
        if (reducedMotion) {
          // An exiting panel changes height once; only intermediate samples indicate animated movement.
          const minimum = Math.min(...heights);
          const maximum = Math.max(...heights);
          const intermediateHeights = heights.filter((height) => height > minimum + 1 && height < maximum - 1);
          expect(intermediateHeights, `reduced-motion heights: ${heights.join(", ")}`).toHaveLength(0);
        }
        else expect(range).toBeGreaterThan(10);
      };

      try {
        await openApp(page, settingsRulesPath);
        await waitForSection(page, "Ajustes");
        const ruleCard = page.locator(".list-card").filter({hasText: "Regla estabilidad E2E"});
        await expect(ruleCard).toBeVisible();
        const previewButton = ruleCard.locator('button[data-rule-preview-id="80311"]');
        await previewButton.scrollIntoViewIfNeeded();
        await previewButton.focus();
        await waitForStableScroll(page);
        const previewScroll = await page.evaluate(() => window.scrollY);
        const previewTop = (await previewButton.boundingBox())?.y;
        await previewButton.press("Enter");
        await previewStarted;
        await expect(previewButton).toHaveAttribute("aria-disabled", "true");
        await expect(previewButton).toHaveAttribute("aria-busy", "true");
        expect(await previewButton.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(previewButton).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(previewScroll);
        expect((await previewButton.boundingBox())?.y).toBeCloseTo(previewTop!, 0);
        await previewButton.evaluate((button) => button.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        expect(previewRequests).toBe(1);
        await startHeightSamples("preview");
        releasePreview();
        await expect(page.getByRole("heading", {name: "Vista previa: Regla estabilidad E2E"})).toBeVisible();
        await finishHeightSamples("preview");
        await waitForStableScroll(page);
        await expect(previewButton).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(previewScroll);

        await page.getByRole("button", {name: "Aplicar cambios", exact: true}).click();
        await page.getByRole("dialog").getByRole("button", {name: "Aplicar cambios", exact: true}).click();
        await expect(page.getByRole("heading", {name: "Regla aplicada"})).toBeVisible();
        const undoButton = page.getByRole("button", {name: "Deshacer aplicación"});
        await undoButton.scrollIntoViewIfNeeded();
        await undoButton.focus();
        await waitForStableScroll(page);
        const undoScroll = await page.evaluate(() => window.scrollY);
        const undoTop = (await undoButton.boundingBox())?.y;
        await undoButton.press("Enter");
        await undoStarted;
        const pendingUndo = page.getByRole("button", {name: "Deshaciendo…"});
        await expect(pendingUndo).toHaveAttribute("aria-disabled", "true");
        await expect(pendingUndo).toHaveAttribute("aria-busy", "true");
        expect(await pendingUndo.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(pendingUndo).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(undoScroll);
        expect(Math.abs((await pendingUndo.boundingBox())!.y - undoTop!)).toBeLessThanOrEqual(1);
        await pendingUndo.evaluate((button) => button.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        expect(undoRequests).toBe(1);
        await startHeightSamples("undo");
        releaseUndo();
        await finishHeightSamples("undo");
        await expect(page.getByRole("status").filter({hasText: "Aplicación deshecha."})).toContainText("Aplicación deshecha.");
        await expect(previewButton).toBeFocused();
        await expect(previewButton).toBeInViewport();
        assertNoPageErrors();
      } finally {
        releasePreview();
        releaseUndo();
      }
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-I0 Automatizaciones ${viewport.slug} reglas vacías conservan foco y scroll ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await setAppPreferences(page, "mineral", false);
      await installAutomationRuleFixture(page, []);
      await openApp(page, settingsRulesPath);
      await waitForSection(page, "Ajustes");

      const ruleList = page.locator(".settings-category-rules-section .automation-rule-list");
      const disclosure = ruleList.getByRole("button", {name: /^(Expandir|Comprimir)$/});
      await expect(disclosure).toBeVisible();
      await expect(disclosure).toHaveAccessibleName("Comprimir");
      await disclosure.click();
      await expect(disclosure).toHaveAccessibleName("Expandir");
      await disclosure.scrollIntoViewIfNeeded();
      await disclosure.focus({preventScroll: true});
      await waitForStableScroll(page);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const disclosureTopBefore = (await disclosure.boundingBox())?.y;
      expect(disclosureTopBefore).not.toBeUndefined();
      await disclosure.press("Enter");

      await expect(ruleList.getByText("Crea una regla arriba para asignar categorías según la descripción del movimiento.", {exact: true})).toBeVisible();
      await expect(disclosure).toHaveAccessibleName("Comprimir");
      await expect(disclosure).toBeFocused();
      const scrollAfter = await page.evaluate(() => window.scrollY);
      const disclosureTopAfter = (await disclosure.boundingBox())?.y;
      expect(disclosureTopAfter).toBeCloseTo(disclosureTopBefore!, 0);
      expect(scrollAfter, `scroll changed from ${scrollBefore} to ${scrollAfter} while the disclosure moved from ${disclosureTopBefore} to ${disclosureTopAfter}`).toBe(scrollBefore);
      await assertNoDocumentOverflow(page);
      assertNoPageErrors();
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-I1 Automatizaciones crear y editar regla conserva foco ${viewport.slug} ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await setAppPreferences(page, "mineral", false);
      await installCategoryCatalogFixture(page);
      const fixture = await installAutomationRuleFixture(page, []);
      const categoryData = {id: 9041, name: "Comida", display_name: "Comida", kind: "expense", color: "#ff9500", icon: "", active: true, parent_id: null, exclude_from_analytics: false, sort_order: 1, is_favorite: false, transaction_count: 4, child_count: 1};
      const createdRule = {id: 80312, description: "Regla E2E", kind: "expense", category: categoryData, active: true, updated_at: "2026-09-24T00:00:00Z", priority: 10, match_mode: "exact", account: null, amount_min: null, amount_max: null, last_tested_at: "", last_test_result: {}, application_count: 0};
      const updatedRule = {...createdRule, amount_max: 50};
      let releaseCreate!: () => void;
      let markCreateStarted!: () => void;
      const createGate = new Promise<void>((resolve) => {releaseCreate = resolve;});
      const createStarted = new Promise<void>((resolve) => {markCreateStarted = resolve;});
      let createRequests = 0;
      let releaseUpdate!: () => void;
      let markUpdateStarted!: () => void;
      const updateGate = new Promise<void>((resolve) => {releaseUpdate = resolve;});
      const updateStarted = new Promise<void>((resolve) => {markUpdateStarted = resolve;});
      let updateRequests = 0;
      await page.route("**/api/category-rules/", async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        createRequests += 1;
        markCreateStarted();
        await createGate;
        fixture.rules.push(createdRule);
        await route.fulfill({status: 201, json: {ok: true, rule: createdRule}});
      });
      await page.route("**/api/category-rules/80312/", async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        updateRequests += 1;
        markUpdateStarted();
        await updateGate;
        fixture.rules[0] = updatedRule;
        await route.fulfill({json: {ok: true, rule: updatedRule}});
      });

      try {
      await openApp(page, settingsNewRulePath);
        await waitForSection(page, "Ajustes");
        const ruleList = page.locator(".settings-category-rules-section .automation-rule-list");
        const form = page.locator(".settings-category-rules-section .automation-rule-entry form").last();
        const description = form.getByLabel("Texto a reconocer");
        await description.fill("Regla E2E");
        await form.getByLabel("Categoría").selectOption({label: "Comida"});
        const save = form.locator("button[type=submit]");
        await save.scrollIntoViewIfNeeded();
        await save.focus();
        await waitForStableScroll(page);
        const createScroll = await page.evaluate(() => window.scrollY);
        const createTop = (await save.boundingBox())?.y;
        await save.press("Enter");
        await createStarted;
        await expect(form).toHaveAttribute("aria-busy", "true");
        await expect(save).toHaveAttribute("aria-disabled", "true");
        await expect(save).toHaveAttribute("aria-busy", "true");
        expect(await save.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(save).toBeFocused();
        await expect(description).toBeDisabled();
        expect(await page.evaluate(() => window.scrollY)).toBe(createScroll);
        expect(Math.abs((await save.boundingBox())!.y - createTop!)).toBeLessThanOrEqual(1);
        await form.evaluate((element) => element.requestSubmit(element.querySelector("button[type=submit]") as HTMLButtonElement));
        expect(createRequests).toBe(1);

        const startRuleMotionSamples = () => page.evaluate(() => {
          const auditWindow = window as typeof window & {__savedRuleHeights?: number[]};
          auditWindow.__savedRuleHeights = [];
          const begin = (element: HTMLElement) => {
            let frame = 0;
            const sample = () => {
              auditWindow.__savedRuleHeights!.push(element.getBoundingClientRect().height);
              frame += 1;
              if (frame < 24) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          };
          const mounted = document.querySelector<HTMLElement>(".category-rule-entry-motion");
          if (mounted) begin(mounted);
          else {
            const observer = new MutationObserver(() => {
              const element = document.querySelector<HTMLElement>(".category-rule-entry-motion");
              if (!element) return;
              observer.disconnect();
              begin(element);
            });
            observer.observe(document.body, {childList: true, subtree: true});
          }
        });
        const finishRuleMotionSamples = async () => {
          await page.waitForFunction(() => (window as typeof window & {__savedRuleHeights?: number[]}).__savedRuleHeights?.length === 24);
          const heights = await page.evaluate(() => (window as typeof window & {__savedRuleHeights?: number[]}).__savedRuleHeights || []);
          const range = Math.max(...heights) - Math.min(...heights);
          if (reducedMotion) expect(range).toBeLessThan(1);
          else expect(range).toBeGreaterThan(10);
        };
        await startRuleMotionSamples();
        releaseCreate();
        await expect(page.getByRole("status")).toContainText("Regla de categoría creada.");
        const expandRuleList = ruleList.getByRole("button", {name: "Expandir", exact: true});
        await expandRuleList.focus();
        await expandRuleList.press("Enter");
        const collapseRuleList = ruleList.getByRole("button", {name: "Comprimir", exact: true});
        await expect(collapseRuleList).toBeFocused();
        const createdRow = ruleList.locator(".list-card").filter({hasText: "Regla E2E"});
        await expect(createdRow).toBeVisible();
        await finishRuleMotionSamples();
        await expect(save).toHaveAccessibleName("Guardar regla");

        await createdRow.getByRole("button", {name: "Editar", exact: true}).click();
        await expect(form.getByLabel("Importe máximo")).toBeVisible();
        await form.getByLabel("Importe máximo").fill("50");
        await save.scrollIntoViewIfNeeded();
        await save.focus();
        await waitForStableScroll(page);
        const updateScroll = await page.evaluate(() => window.scrollY);
        const updateTop = (await save.boundingBox())?.y;
        await save.press("Enter");
        await updateStarted;
        await expect(form).toHaveAttribute("aria-busy", "true");
        await expect(save).toHaveAttribute("aria-disabled", "true");
        await expect(save).toHaveAttribute("aria-busy", "true");
        expect(await save.evaluate((button) => (button as HTMLButtonElement).disabled)).toBe(false);
        await expect(save).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(updateScroll);
        expect(Math.abs((await save.boundingBox())!.y - updateTop!)).toBeLessThanOrEqual(1);
        await form.evaluate((element) => element.requestSubmit(element.querySelector("button[type=submit]") as HTMLButtonElement));
        expect(updateRequests).toBe(1);
        releaseUpdate();
        await expect(page.getByRole("status")).toContainText("Regla de categoría actualizada.");
        await expect(save).toHaveAccessibleName("Guardar regla");
        await expect(save).toBeFocused();
        assertNoPageErrors();
      } finally {
        releaseCreate();
        releaseUpdate();
      }
    });
  }
}

for (const viewport of viewports) {
  for (const reducedMotion of [false, true] as const) {
    const browser = ((viewport.slug === "desktop-1440x1000" && !reducedMotion) || (viewport.slug === "mobile-390x844" && reducedMotion)) ? "chromium" : "webkit";
    test(`G12-C3 Ajustes ${viewport.slug} reordenar conserva foco ${reducedMotion ? "reduced-motion" : "motion"} ${browser === "chromium" ? "@chromium-only" : "@webkit-only"}`, async ({page}) => {
      const assertNoPageErrors = installPageErrorGuard(page);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
      await installCategoryCatalogFixture(page, true);
      await setAppPreferences(page, "mineral", false);
      let releaseOrder!: () => void;
      let markOrderStarted!: () => void;
      const orderGate = new Promise<void>((resolve) => { releaseOrder = resolve; });
      const orderStarted = new Promise<void>((resolve) => { markOrderStarted = resolve; });
      let savedOrder: unknown;
      let orderRequests = 0;
      await page.route("**/api/categories/order/", async (route) => {
        orderRequests += 1;
        savedOrder = route.request().postDataJSON();
        if (orderRequests === 1) {
          await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Orden rechazado por fixture."})});
          return;
        }
        markOrderStarted();
        await orderGate;
        await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: true})});
      });

      try {
        await openApp(page, settingsCategoriesPath);
        await waitForSection(page, "Ajustes");
        const tree = page.getByRole("region", {name: "Árbol de categorías"});
        const movingRow = tree.locator('.catalog-row[data-category-id="9041"]');
        const moveMenuTrigger = movingRow.getByRole("button", {name: "Acciones de Comida"});
        const targetRow = tree.locator('.catalog-row[data-category-id="9044"]');
        await expect(movingRow).toBeVisible();
        await expect(tree.locator(".catalog-row")).toHaveCount(3);
        await moveMenuTrigger.scrollIntoViewIfNeeded();
        await moveMenuTrigger.focus();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const movingTopBefore = (await movingRow.boundingBox())?.y;
        const targetTopBefore = (await targetRow.boundingBox())?.y;
        expect(movingTopBefore).not.toBeUndefined();
        expect(targetTopBefore).not.toBeUndefined();

        await moveMenuTrigger.press("Enter");
        const moveDown = movingRow.getByRole("button", {name: "Bajar posición", exact: true});
        await expect(moveDown).toBeVisible();
        await moveDown.press("Enter");
        await expect(tree.getByRole("alert")).toHaveText("No se pudo guardar el orden. Se restauró la posición anterior.");
        await expect(moveMenuTrigger).toBeFocused();
        await page.waitForFunction(() => {
          const names = Array.from(document.querySelectorAll<HTMLElement>(".catalog-tree .catalog-row .catalog-name strong"), (element) => element.textContent?.trim());
          return names.join("|") === "Comida|Bebidas|Hogar";
        }, undefined, {polling: "raf"});
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await expect.poll(async () => (await movingRow.boundingBox())?.y ?? Number.POSITIVE_INFINITY).toBeCloseTo(movingTopBefore!, 0);

        await moveMenuTrigger.press("Enter");
        await expect(moveDown).toBeVisible();
        const motionSamplesPromise = page.evaluate(() => new Promise<number[]>((resolve) => {
          const tree = document.querySelector(".catalog-tree");
          const samples: number[] = [];
          let started = false;
          let frame = 0;
          const sample = () => {
            const row = document.querySelector<HTMLElement>('.catalog-tree .catalog-row[data-category-id="9041"]');
            if (row) samples.push(row.getBoundingClientRect().top);
            if (frame++ < 23) requestAnimationFrame(sample);
            else resolve(samples);
          };
          const startWhenReordered = () => {
            if (started) return;
            const names = Array.from(document.querySelectorAll<HTMLElement>(".catalog-tree .catalog-row .catalog-name strong"), (element) => element.textContent?.trim());
            if (names.join("|") !== "Bebidas|Comida|Hogar") return;
            started = true;
            observer.disconnect();
            requestAnimationFrame(sample);
          };
          const observer = new MutationObserver(startWhenReordered);
          if (tree) observer.observe(tree, {childList: true, subtree: true});
          startWhenReordered();
        }));
        await moveDown.press("Enter");
        await orderStarted;
        expect(orderRequests).toBe(2);
        await page.waitForFunction(() => {
          const names = Array.from(document.querySelectorAll<HTMLElement>(".catalog-tree .catalog-row .catalog-name strong"), (element) => element.textContent?.trim());
          return names.join("|") === "Bebidas|Comida|Hogar";
        }, undefined, {polling: "raf"});
        const motionSamples = await motionSamplesPromise;
        await moveMenuTrigger.press("Enter");
        await expect(moveDown).toBeDisabled();
        await expect(moveMenuTrigger).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(moveMenuTrigger).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        expect(savedOrder).toEqual({order: [{id: 9044, parent_id: null}, {id: 9041, parent_id: null}, {id: 9045, parent_id: null}]});

        await expect.poll(async () => (await movingRow.boundingBox())!.y - (await targetRow.boundingBox())!.y).toBeGreaterThan(0);
        const movingTopAfter = (await movingRow.boundingBox())!.y;
        if (reducedMotion) expect(motionSamples.at(-1)).toBeCloseTo(movingTopAfter, 0);
        else expect(motionSamples.some((top) => top > movingTopBefore! + 1 && top < movingTopAfter - 1)).toBe(true);
        await assertNoDocumentOverflow(page);
      } finally {
        releaseOrder();
      }

      await expect(page.getByRole("region", {name: "Árbol de categorías"}).getByRole("status")).toHaveText("Orden de categorías guardado.");
      assertNoPageErrors();
    });
  }
}

for (const {viewport, input, reducedMotion} of focusMotionPairwiseStates(viewports)) {
  test(`Restaurar copia conserva foco ${viewport.slug} ${input} ${reducedMotion ? "reduced-motion" : "motion"}`, async ({page}) => {
        const assertNoPageErrors = installPageErrorGuard(page);
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
        const fixture = await installRestoreSubmissionFixture(page);
        await setAppPreferences(page, "mineral", false);
          await openApp(page, "/?tab=settings");
        await waitForSection(page, "Ajustes");
        await page.getByRole("button", {name: /Datos y recuperación/}).click();

        const panel = page.locator(".recovery-panel");
        await panel.locator("summary").getByText("Restaurar una copia").click();
        await panel.getByLabel("Archivo ZIP de copia").setInputFiles({name: "valida.zip", mimeType: "application/zip", buffer: Buffer.from("valid fixture")});
        await expect(panel).toContainText("Copia validada:");
        await panel.getByLabel("Escribe RESTAURAR para confirmar").fill("RESTAURAR");
        const restore = panel.locator(".recovery-restore .ui-button--danger");
        await restore.scrollIntoViewIfNeeded();
        await restore.focus();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const restoreTop = (await restore.boundingBox())?.y;
        if (input === "teclado") await restore.press("Enter");
        else await restore.click();
        await fixture.failureReached;

        await expect(restore).toHaveAttribute("aria-busy", "true");
        await expect(restore).toHaveAttribute("aria-disabled", "true");
        expect(await restore.evaluate((button: HTMLButtonElement) => button.disabled)).toBe(false);
        await expect(restore).toBeFocused();
        await restore.evaluate((button) => button.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        expect(fixture.restoreRequests).toBe(1);
        const errorHeightProbe = await startRecoveryHeightsProbe(page, "No se pudo solicitar la restauración.");
        fixture.releaseFailure();

        await expect(panel.getByRole("alert")).toContainText("No se pudo solicitar la restauración.");
        const errorHeights = await errorHeightProbe.samples;
        expect(errorHeights).toHaveLength(24);
        const errorHeightRange = Math.max(...errorHeights) - Math.min(...errorHeights);
        const intermediateErrorHeights = errorHeights.filter((height) => height > Math.min(...errorHeights) + 1 && height < Math.max(...errorHeights) - 1);
        if (reducedMotion) expect(intermediateErrorHeights).toHaveLength(0);
        else if (errorHeightRange > 2) expect(intermediateErrorHeights.length).toBeGreaterThan(0);
        await expect(panel.getByLabel("Escribe RESTAURAR para confirmar")).toHaveValue("RESTAURAR");
        await expect(restore).toBeFocused();
        await expect(restore).not.toHaveAttribute("aria-busy", "true");
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        expect((await restore.boundingBox())?.y).toBeCloseTo(restoreTop!, 0);

        if (input === "teclado") await restore.press("Enter");
        else await restore.click();
        await fixture.successReached;
        expect(fixture.restoreRequests).toBe(2);
        await expect(restore).toHaveAttribute("aria-busy", "true");
        fixture.releaseSuccess();
        await expect(restore).toHaveAccessibleName("Restauración solicitada");
        await expect(restore).toHaveAttribute("aria-disabled", "true");
        await expect(restore).toBeFocused();
        await expect(panel.locator(".recovery-note")).toContainText("Restauración solicitada por fixture.");
        expect(fixture.restoreBody).toEqual({token: "d".repeat(32), confirmation: "RESTAURAR"});
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        assertNoPageErrors();
  });
}

for (const {viewport, input, reducedMotion} of focusMotionPairwiseStates(viewports)) {
  test(`Crear copia y validar ZIP conservan foco ${viewport.slug} ${input} ${reducedMotion ? "reduced-motion" : "motion"}`, async ({page}) => {
        const assertNoPageErrors = installPageErrorGuard(page);
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        await page.emulateMedia({reducedMotion: reducedMotion ? "reduce" : "no-preference"});
        const fixture = await installBackupPreviewFixture(page);
        await setAppPreferences(page, "mineral", false);
        await openApp(page, "/?tab=settings");
        await expect(page.getByRole("heading", {name: "Ajustes", exact: true})).toBeVisible();
        await page.getByRole("button", {name: /Datos y recuperación/}).click();
        const panel = page.locator(".recovery-panel");
        const create = panel.locator(".recovery-actions .ui-button").first();
        await expect(panel.locator(".recovery-status")).toContainText("Todavía no hay una copia programada");
        await create.scrollIntoViewIfNeeded();
        await create.focus();
        const backupScroll = await page.evaluate(() => window.scrollY);
        if (input === "teclado") await create.press("Enter");
        else await create.click();
        await fixture.backupFailureReached;
        await expect(create).toHaveAttribute("aria-busy", "true");
        await expect(create).toHaveAttribute("aria-disabled", "true");
        expect(await create.evaluate((button: HTMLButtonElement) => button.disabled)).toBe(false);
        await expect(create).toBeFocused();
        await create.evaluate((button) => button.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        expect(fixture.backupRequests).toBe(1);
        fixture.releaseBackupFailure();
        await expect(panel.getByRole("alert")).toContainText("No se pudo crear la copia de seguridad.");
        await expect(create).toBeFocused();
        await expect(create).toBeInViewport();
        expect(await page.evaluate(() => window.scrollY)).toBe(backupScroll);

        if (input === "teclado") await create.press("Enter");
        else await create.click();
        await fixture.backupSuccessReached;
        expect(fixture.backupRequests).toBe(2);
        await expect(create).toHaveAttribute("aria-busy", "true");
        await expect(create).toBeFocused();
        fixture.releaseBackupSuccess();
        await expect(panel.locator(".recovery-status")).toContainText("manual-fixture.zip");
        await expect(panel.locator(".recovery-status")).toContainText("Último archivo disponible:");
        await expect(create).toBeFocused();
        await expect(create).toBeInViewport();
        expect(await page.evaluate(() => window.scrollY)).toBe(backupScroll);

        const summary = panel.locator(".recovery-restore summary");
        if (input === "teclado") {
          await summary.focus();
          await summary.press("Enter");
        } else await summary.click();
        const fileInput = panel.getByLabel("Archivo ZIP de copia");
        await fileInput.scrollIntoViewIfNeeded();
        await fileInput.focus();
        const fileScroll = await page.evaluate(() => window.scrollY);
        const fileTop = (await fileInput.boundingBox())?.y;
        await fileInput.setInputFiles({name: "valida.zip", mimeType: "application/zip", buffer: Buffer.from("valid fixture")});
        await fixture.previewFailureReached;
        await expect(fileInput).toHaveAttribute("aria-busy", "true");
        await expect(fileInput).toHaveAttribute("aria-disabled", "true");
        expect(await fileInput.evaluate((input: HTMLInputElement) => input.disabled)).toBe(false);
        await expect(fileInput).toBeFocused();
        expect(fixture.previewRequests).toBe(1);
        fixture.releasePreviewFailure();
        await expect(panel.getByRole("alert")).toContainText("El ZIP fixture no es válido.");
        await expect(fileInput).toBeFocused();
        expect(await fileInput.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe("valida.zip");
        expect(await page.evaluate(() => window.scrollY)).toBe(fileScroll);
        expect(Math.abs((await fileInput.boundingBox())!.y - fileTop!)).toBeLessThan(8);

        const retry = panel.getByRole("button", {name: /Reintentar validación|Validando copia/});
        if (input === "teclado") await retry.press("Enter");
        else await retry.click();
        await fixture.previewSuccessReached;
        expect(fixture.previewRequests).toBe(2);
        await expect(retry).toHaveAttribute("aria-busy", "true");
        await expect(retry).toBeFocused();
        const transitionHeightProbe = await startRecoveryHeightsProbe(page, "Copia validada:");
        fixture.releasePreviewSuccess();
        await expect(panel).toContainText("Copia validada:");
        const confirmation = panel.getByLabel("Escribe RESTAURAR para confirmar");
        await expect(confirmation).toBeFocused();
        await expect(confirmation).toBeInViewport();
        await waitForStableScroll(page);
        const transitionSamples = await transitionHeightProbe.samples;
        expect(transitionSamples).toHaveLength(24);
        const heights = transitionSamples;
        const heightRange = Math.max(...heights) - Math.min(...heights);
        const intermediateHeights = heights.filter((height) => height > Math.min(...heights) + 1 && height < Math.max(...heights) - 1);
        if (reducedMotion) expect(intermediateHeights).toHaveLength(0);
        else if (heightRange > 2) expect(intermediateHeights.length).toBeGreaterThan(0);
        expect(Math.abs(await page.evaluate(() => window.scrollY) - fileScroll)).toBeLessThan(viewport.height);
        if (input === "teclado") {
          const changeCopy = panel.getByRole("button", {name: "Elegir otra copia"});
          await changeCopy.focus();
          await changeCopy.press("Enter");
        } else await panel.getByRole("button", {name: "Elegir otra copia"}).click();
        await expect(fileInput).toBeFocused();
        await expect(fileInput).toBeInViewport();
        await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - fileScroll)).toBeLessThan(viewport.height);
        assertNoPageErrors();
  });
}

for (const viewport of viewports) {
  for (const input of ["teclado", "puntero"] as const) {
    test(`Reintentar consulta de copias conserva foco ${viewport.slug} ${input}`, async ({page}) => {
        const assertNoPageErrors = installPageErrorGuard(page);
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        const fixture = await installRecoveryStatusRetryFixture(page);
        await setAppPreferences(page, "mineral", false);
        await openApp(page, "/?tab=settings");
        await expect(page.getByRole("heading", {name: "Ajustes", exact: true})).toBeVisible();
        await page.getByRole("button", {name: /Datos y recuperación/}).click();
        const panel = page.locator(".recovery-panel");
        await expect(panel).toBeVisible();
        const recoveryStatus = panel.locator(".recovery-status");
        await fixture.failureReached;
        await expect(recoveryStatus).toHaveAttribute("aria-busy", "true");
        fixture.releaseFailure();

        await expect(panel.getByRole("alert")).toContainText("No se pudo consultar el estado de las copias.");
        const retry = panel.getByRole("button", {name: /Reintentar consulta|Consultando copias/});
        await expect(retry).toBeVisible();
        await expect(page.locator(".view-stack > .message.error")).toHaveCount(0);
        await retry.scrollIntoViewIfNeeded();
        if (input === "teclado") await retry.focus();
        const retryScroll = await page.evaluate(() => window.scrollY);
        if (input === "teclado") await retry.press("Enter");
        else await retry.click();
        await fixture.successReached;
        await expect(retry).toHaveAttribute("aria-busy", "true");
        await expect(retry).toHaveAttribute("aria-disabled", "true");
        expect(await retry.evaluate((button: HTMLButtonElement) => button.disabled)).toBe(false);
        await expect(retry).toBeFocused();
        await retry.evaluate((button) => button.dispatchEvent(new MouseEvent("click", {bubbles: true})));
        expect(fixture.requests).toBe(2);
        fixture.releaseSuccess();

        await expect(recoveryStatus).toContainText("Todavía no hay una copia programada");
        await expect(recoveryStatus).toBeFocused();
        await expect(panel.getByRole("alert")).toHaveCount(0);
        await waitForStableScroll(page);
        const expectedScrollAfterAlertExit = await page.evaluate((previousScroll) => Math.min(previousScroll, Math.max(0, document.documentElement.scrollHeight - innerHeight)), retryScroll);
        expect(await page.evaluate(() => window.scrollY)).toBe(expectedScrollAfterAlertExit);
        expect(fixture.requests).toBe(2);
        assertNoPageErrors();
    });
  }
}

for (const viewport of viewports) {
  test(`U6 estado global loading ${viewport.slug} ${assignedBrowser(viewport)}`, async ({page}, testInfo) => {
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    let releaseBootstrap!: () => void;
    const bootstrapGate = new Promise<void>((resolve) => { releaseBootstrap = resolve; });
    await page.route("**/api/bootstrap/", async (route) => {
      await bootstrapGate;
      await route.continue();
    });

    const navigation = page.goto("/");
    await expect(page.getByText("Cargando la aplicación…")).toBeVisible();
    await screenshotEvidence(page, testInfo, `${viewport.slug}-global-loading.png`);
    releaseBootstrap();
    await navigation;
    await waitForSection(page, "Resumen");
  });

  test(`U6 estado global fatal ${viewport.slug} ${assignedBrowser(viewport)}`, async ({page}, testInfo) => {
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.route("**/api/bootstrap/", async (route) => {
      await route.fulfill({status: 503, contentType: "application/json", body: '{"detail":"U6 deterministic failure"}'});
    });
    await page.goto("/");
    await expect(page.getByRole("heading", {name: "No se pudo cargar la aplicación", exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: "Reintentar", exact: true})).toBeVisible();
    await screenshotEvidence(page, testInfo, `${viewport.slug}-global-fatal.png`);
    await assertNoDocumentOverflow(page);
  });
}
