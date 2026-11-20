import {chromium} from "playwright";

class SmokeError extends Error {}

const fail = (message) => { throw new SmokeError(message); };

async function runSmoke() {
  const configuredOrigin = process.argv[2];
  if (!configuredOrigin) fail("Uso: node scripts/smoke-release.mjs <origin>");

  const expectedChartEngine = process.env.EXPECTED_CHART_ENGINE || "";
  const smokeUsername = process.env.RELEASE_SMOKE_USERNAME || "";
  const smokePassword = process.env.RELEASE_SMOKE_PASSWORD || "";
  if (Boolean(smokeUsername) !== Boolean(smokePassword)) {
    fail("Configura juntos RELEASE_SMOKE_USERNAME y RELEASE_SMOKE_PASSWORD.");
  }
  if (expectedChartEngine && !["uplot", "ag-charts"].includes(expectedChartEngine)) {
    fail("EXPECTED_CHART_ENGINE debe ser uplot o ag-charts.");
  }

  let configuredUrl;
  try {
    configuredUrl = new URL(configuredOrigin);
  } catch {
    fail("RELEASE_ORIGIN no es una URL válida.");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const loopbackHttp = configuredUrl.protocol === "http:" && loopbackHosts.has(configuredUrl.hostname);
  if (configuredUrl.username || configuredUrl.password || configuredUrl.pathname !== "/" || configuredUrl.search || configuredUrl.hash) {
    fail("RELEASE_ORIGIN debe contener solo el origen del host.");
  }
  if (configuredUrl.protocol !== "https:" && !loopbackHttp) {
    fail("El smoke externo requiere HTTPS; HTTP solo se permite en loopback.");
  }

  const expectedOrigin = configuredUrl.origin;
  const resolverRule = process.env.RELEASE_HOST_IP
    ? [`--host-resolver-rules=MAP ${configuredUrl.hostname} ${process.env.RELEASE_HOST_IP}`]
    : [];
  let browser;
  try {
    browser = await chromium.launch({headless: true, args: resolverRule});
    const page = await browser.newPage({locale: "es-ES", reducedMotion: "reduce"});
    page.setDefaultTimeout(8_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => errors.push(request.failure()?.errorText || "fallo de red"));

    const assertExpectedOrigin = () => {
      let currentOrigin;
      try {
        currentOrigin = new URL(page.url()).origin;
      } catch {
        fail("No se pudo confirmar el origen cargado; se canceló el smoke.");
      }
      if (currentOrigin !== expectedOrigin) {
        fail("El host redirigió fuera del origen de release; se canceló el login.");
      }
    };

    const sections = [
      ["", "Resumen"],
      ["transactions", "Movimientos"],
      ["review", "Revisión"],
      ["planning", "Plan"],
      ["accounts", "Cuentas"],
      ["statistics", "Estadísticas"],
      ["settings", "Ajustes"],
    ];

    for (const [tab, heading] of sections) {
      const url = new URL(tab ? `/?tab=${tab}` : "/", expectedOrigin).toString();
      await page.goto(url, {waitUntil: "networkidle"});
      assertExpectedOrigin();
      const login = page.getByRole("heading", {name: "Inicia sesión", exact: true});
      if (await login.isVisible().catch(() => false)) {
        if (!smokeUsername || !smokePassword) {
          fail("El host exige sesión; proporciona RELEASE_SMOKE_USERNAME y RELEASE_SMOKE_PASSWORD al proceso de release.");
        }
        assertExpectedOrigin();
        let usernameField;
        let passwordField;
        try {
          usernameField = await page.getByLabel("Usuario").elementHandle();
          passwordField = await page.getByLabel("Contraseña").elementHandle();
        } catch {
          fail("No se pudo completar el formulario de acceso del smoke.");
        }
        if (!usernameField || !passwordField) fail("No se pudo completar el formulario de acceso del smoke.");
        assertExpectedOrigin();
        try {
          await usernameField.fill(smokeUsername);
        } catch {
          fail("No se pudo completar el formulario de acceso del smoke.");
        }
        assertExpectedOrigin();
        try {
          await passwordField.fill(smokePassword);
        } catch {
          fail("No se pudo completar el formulario de acceso del smoke.");
        }
        assertExpectedOrigin();
        await page.getByRole("button", {name: "Entrar"}).click();
        assertExpectedOrigin();
        await page.getByRole("heading", {name: "Resumen", exact: true}).waitFor();
      }
      await page.getByRole("heading", {name: heading, exact: true}).waitFor();
      if (tab === "statistics" && expectedChartEngine) {
        await page
          .locator(`.stats-view[data-chart-engine="${expectedChartEngine}"][aria-busy="false"]`)
          .waitFor();
      }
    }

    if (errors.length) fail("La aplicación emitió errores de consola o red durante el smoke.");
    const engineResult = expectedChartEngine ? `; motor ${expectedChartEngine} verificado` : "";
    console.log(`Smoke de release: 7 vistas sin errores de consola o red${engineResult}.`);
  } finally {
    try {
      await browser?.close();
    } catch {
      // A close failure must not print browser logs that could include secrets.
      if (!process.exitCode) process.exitCode = 1;
    }
  }
}

runSmoke().catch((error) => {
  if (error instanceof SmokeError) console.error(`Smoke de release fallido: ${error.message}`);
  else console.error("Smoke de release fallido; se ocultaron detalles internos para proteger credenciales.");
  process.exitCode = 1;
});
