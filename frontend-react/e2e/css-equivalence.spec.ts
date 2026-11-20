import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {expect, test, type Page} from "playwright/test";
import {openApp} from "./helpers";

const baselineRef = process.env.CSS_BASELINE_REF?.trim();
const repositoryDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stylesheetAtRepository = "frontend-react/src/styles.css";

const readGitFile = (ref: string, repositoryPath: string) => {
  try {
    return execFileSync("git", ["show", `${ref}:${repositoryPath}`], {
      cwd: repositoryDir,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo leer ${repositoryPath} en CSS_BASELINE_REF=${ref}: ${detail}`);
  }
};

const expandGitStylesheet = (ref: string, repositoryPath: string, ancestors: string[] = []): string => {
  if (ancestors.includes(repositoryPath)) {
    throw new Error(`Ciclo de @import en el CSS de referencia: ${[...ancestors, repositoryPath].join(" -> ")}`);
  }

  const source = readGitFile(ref, repositoryPath);
  const importRule = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)')(?:\s*\))?\s*([^;]*);/g;
  return source.replace(importRule, (rule, doubleQuoted: string | undefined, singleQuoted: string | undefined, condition: string) => {
    const specifier = doubleQuoted ?? singleQuoted ?? "";
    if (!specifier.startsWith(".")) return rule;
    if (condition.trim()) {
      throw new Error(`El @import local condicionado no está soportado por la prueba: ${rule}`);
    }

    const importedPath = path.posix.normalize(path.posix.join(path.posix.dirname(repositoryPath), specifier));
    if (!importedPath.startsWith("frontend-react/src/")) {
      throw new Error(`El @import de referencia sale de frontend-react/src: ${repositoryPath} -> ${specifier}`);
    }
    const expanded = expandGitStylesheet(ref, importedPath, [...ancestors, repositoryPath]);
    return `/* CSS_BASELINE_REF: ${importedPath} */\n${expanded}`;
  });
};

const baselineCss = baselineRef ? expandGitStylesheet(baselineRef, stylesheetAtRepository) : "";

// Revisión tiene un contrato visual propio; su composición se valida en los gates de UI Lab.
const sections = [
  ["/", "Resumen"],
  ["/?tab=transactions", "Movimientos"],
  ["/?tab=planning", "Plan"],
  ["/?tab=accounts", "Cuentas"],
  ["/?tab=settings", "Ajustes"],
] as const;

const viewports = [
  {name: "390", width: 390, height: 844},
  {name: "768", width: 768, height: 900},
  {name: "1280", width: 1280, height: 900},
] as const;

const comparedProperties = [
  "align-content", "align-items", "align-self", "all", "appearance",
  "animation-delay", "animation-direction", "animation-duration", "animation-fill-mode",
  "animation-iteration-count", "animation-name", "animation-play-state", "animation-timing-function",
  "aspect-ratio", "backdrop-filter", "background-attachment", "background-blend-mode",
  "background-clip", "background-color", "background-image", "background-origin",
  "background-position", "background-repeat", "background-size", "block-size",
  "border-block-color", "border-block-end-width", "border-block-start-width", "border-block-style",
  "border-bottom-color", "border-bottom-left-radius", "border-bottom-right-radius", "border-bottom-style",
  "border-bottom-width", "border-collapse", "border-inline-color", "border-inline-end-width",
  "border-inline-start-width", "border-inline-style", "border-left-color", "border-left-style",
  "border-left-width", "border-right-color", "border-right-style", "border-right-width",
  "border-spacing", "border-top-color", "border-top-left-radius", "border-top-right-radius",
  "border-top-style", "border-top-width", "bottom", "box-shadow", "box-sizing", "caret-color",
  "clip-path", "color", "color-scheme", "column-gap", "content", "cursor", "direction", "display",
  "fill", "fill-opacity", "filter", "flex-basis", "flex-direction", "flex-grow", "flex-shrink",
  "flex-wrap", "float", "font-family", "font-feature-settings", "font-kerning", "font-size",
  "font-stretch", "font-style", "font-variant", "font-weight", "gap", "grid-auto-columns",
  "grid-auto-flow", "grid-auto-rows", "grid-column-end", "grid-column-start", "grid-row-end",
  "grid-row-start", "grid-template-areas", "grid-template-columns", "grid-template-rows", "height",
  "hyphens", "inline-size", "inset-block-end", "inset-block-start", "inset-inline-end",
  "inset-inline-start", "isolation", "justify-content", "justify-items", "justify-self", "left",
  "letter-spacing", "line-height", "list-style-image", "list-style-position", "list-style-type",
  "margin-block-end", "margin-block-start", "margin-bottom", "margin-inline-end", "margin-inline-start",
  "margin-left", "margin-right", "margin-top", "max-block-size", "max-height", "max-inline-size",
  "max-width", "min-block-size", "min-height", "min-inline-size", "min-width", "object-fit",
  "object-position", "opacity", "order", "outline-color", "outline-offset", "outline-style",
  "outline-width", "overflow-anchor", "overflow-wrap", "overflow-x", "overflow-y", "overscroll-behavior-x",
  "overscroll-behavior-y", "padding-block-end", "padding-block-start", "padding-bottom",
  "padding-inline-end", "padding-inline-start", "padding-left", "padding-right", "padding-top",
  "place-content", "place-items", "pointer-events", "position", "right", "row-gap", "scroll-behavior",
  "scroll-margin-block-end", "scroll-margin-block-start", "scroll-padding-block-end", "scroll-padding-block-start",
  "scroll-snap-align", "scroll-snap-type", "shape-rendering", "stroke", "stroke-dasharray",
  "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "stroke-width", "table-layout",
  "text-align", "text-decoration-color", "text-decoration-line", "text-decoration-style", "text-indent",
  "text-overflow", "text-rendering", "text-transform", "text-wrap", "top", "touch-action", "transform",
  "transform-origin", "transition-delay", "transition-duration", "transition-property",
  "transition-timing-function", "unicode-bidi", "user-select", "vertical-align", "visibility",
  "white-space", "width", "word-break", "word-spacing", "writing-mode", "z-index",
] as const;

const settleView = async (page: Page, heading: string) => {
  await expect(page.getByRole("heading", {name: heading, exact: true})).toBeVisible();
  await expect(page.locator('#main-content [aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), {once: true});
        image.addEventListener("error", () => resolve(), {once: true});
      })));
    const dynamicFingerprint = () => {
      const scrollState = [document.scrollingElement, ...document.body.querySelectorAll("*")]
        .filter((element): element is Element => Boolean(element))
        .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
        .map((element) => `${element.scrollLeft.toFixed(3)},${element.scrollTop.toFixed(3)}`)
        .join(";");
      const svgState = [...document.querySelectorAll("svg path,svg g,svg text")].map((element) => {
        const bounds = element.getBoundingClientRect();
        return [
          element.getAttribute("d"), element.getAttribute("transform"), getComputedStyle(element).opacity,
          bounds.x.toFixed(3), bounds.y.toFixed(3), bounds.width.toFixed(3), bounds.height.toFixed(3),
        ].join(",");
      }).join(";");
      return `${scrollState}|${svgState}`;
    };
    let previousState = "";
    let stableFrames = 0;
    for (let frame = 0; frame < 180 && stableFrames < 8; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const state = dynamicFingerprint();
      if (state === previousState) stableFrames += 1;
      else stableFrames = 0;
      previousState = state;
    }
  });
};

type EquivalenceResult = {
  baselineElementCount: number;
  candidateElementCount: number;
  comparedPropertyCount: number;
  differences: string[];
  differenceCount: number;
  replacedStyleCount: number;
};

const compareWithBaseline = (page: Page) => page.evaluate(async ({css, properties, geometryTolerance}) => {
  type ElementSnapshot = {
    dimensions: Record<string, number>;
    key: string;
    label: string;
    pseudoAfter: Record<string, string>;
    pseudoBefore: Record<string, string>;
    rect: Record<string, number>;
    styles: Record<string, string>;
  };

  const styleIdentity = (node: Element) => {
    if (node instanceof HTMLStyleElement) {
      return node.dataset.viteDevId?.replaceAll("\\", "/") ?? "";
    }
    if (node instanceof HTMLLinkElement && node.rel === "stylesheet") {
      try {
        return new URL(node.href, document.baseURI).pathname;
      } catch {
        return node.getAttribute("href") ?? "";
      }
    }
    return "";
  };
  const isApplicationStyle = (node: Element) => /\/src\/styles(?:\.css|\/)/.test(styleIdentity(node));
  const applicationStyles = [...document.head.querySelectorAll("style[data-vite-dev-id],link[rel=stylesheet]")]
    .filter(isApplicationStyle) as Array<HTMLStyleElement | HTMLLinkElement>;
  if (!applicationStyles.length) {
    throw new Error("No se encontraron estilos Vite de /src/styles; la prueba no desactivará hojas desconocidas.");
  }

  const customProperties = [...getComputedStyle(document.documentElement)]
    .filter((property) => property.startsWith("--"));
  const propertyNames = [...new Set([...properties, ...customProperties])];
  const pseudoProperties = propertyNames.filter((property) => [
    "background-color", "background-image", "border-bottom-color", "border-bottom-left-radius",
    "border-bottom-right-radius", "border-bottom-style", "border-bottom-width", "border-left-color",
    "border-left-style", "border-left-width", "border-right-color", "border-right-style", "border-right-width",
    "border-top-color", "border-top-left-radius", "border-top-right-radius", "border-top-style", "border-top-width", "bottom",
    "box-shadow", "box-sizing", "color", "content", "display", "fill", "font-family", "font-size", "font-style",
    "font-weight", "height", "inset", "left", "line-height", "margin-bottom", "margin-left", "margin-right",
    "margin-top", "opacity", "padding-bottom", "padding-left", "padding-right", "padding-top", "pointer-events",
    "position", "right", "stroke", "stroke-width", "text-decoration-line", "text-transform", "top", "transform",
    "visibility", "width", "z-index",
  ].includes(property));

  const elementKey = (element: Element) => {
    if (element === document.documentElement) return "$html";
    if (element === document.body) return "$body";
    const segments: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.body) {
      const parent: Element | null = current.parentElement;
      const index = parent ? [...parent.children].indexOf(current) : -1;
      segments.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = parent;
    }
    return `$body>${segments.join(">")}`;
  };
  const elementLabel = (element: Element, key: string) => {
    const id = element.id ? `#${element.id}` : "";
    const classes = (element.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
    const classLabel = classes.length ? `.${classes.join(".")}` : "";
    const text = ["A", "BUTTON", "H1", "H2", "H3", "LABEL", "SUMMARY"].includes(element.tagName)
      ? (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 48)
      : "";
    return `${key} (${element.tagName.toLowerCase()}${id}${classLabel}${text ? ` “${text}”` : ""})`;
  };
  const readStyles = (element: Element, pseudo: string | null, names: string[]) => {
    const computed = getComputedStyle(element, pseudo);
    return Object.fromEntries(names.map((property) => [property, computed.getPropertyValue(property)]));
  };
  const capture = () => {
    const elements = [document.documentElement, document.body, ...document.body.querySelectorAll("*")]
      .filter((element) => !["SCRIPT", "STYLE"].includes(element.tagName));
    const snapshots = new Map<string, ElementSnapshot>();
    for (const element of elements) {
      const key = elementKey(element);
      const bounds = element.getBoundingClientRect();
      const htmlElement = element instanceof HTMLElement ? element : null;
      snapshots.set(key, {
        dimensions: {
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          offsetHeight: htmlElement?.offsetHeight ?? 0,
          offsetWidth: htmlElement?.offsetWidth ?? 0,
          scrollHeight: element.scrollHeight,
          scrollLeft: element.scrollLeft,
          scrollTop: element.scrollTop,
          scrollWidth: element.scrollWidth,
        },
        key,
        label: elementLabel(element, key),
        pseudoAfter: readStyles(element, "::after", pseudoProperties),
        pseudoBefore: readStyles(element, "::before", pseudoProperties),
        rect: {bottom: bounds.bottom, height: bounds.height, left: bounds.left, right: bounds.right, top: bounds.top, width: bounds.width, x: bounds.x, y: bounds.y},
        styles: readStyles(element, null, propertyNames),
      });
    }
    return snapshots;
  };

  const freezeAnimations = () => {
    for (const animation of document.getAnimations()) {
      try {
        const timing = animation.effect?.getComputedTiming();
        animation.pause();
        animation.currentTime = timing && Number.isFinite(timing.endTime) ? timing.endTime : 0;
      } catch {
        // Una animación no controlable no invalida el resto del muestreo.
      }
    }
  };

  const dynamicFingerprint = () => {
    const scrollState = [document.scrollingElement, ...document.body.querySelectorAll("*")]
      .filter((element): element is Element => Boolean(element))
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map((element) => `${element.scrollLeft.toFixed(3)},${element.scrollTop.toFixed(3)}`)
      .join(";");
    const svgState = [...document.querySelectorAll("svg path,svg g,svg text")].map((element) => {
      const bounds = element.getBoundingClientRect();
      return [
        element.getAttribute("d"), element.getAttribute("transform"), getComputedStyle(element).opacity,
        bounds.x.toFixed(3), bounds.y.toFixed(3), bounds.width.toFixed(3), bounds.height.toFixed(3),
      ].join(",");
    }).join(";");
    return `${scrollState}|${svgState}`;
  };
  const settleDynamicState = async () => {
    freezeAnimations();
    let previousState = "";
    let stableFrames = 0;
    for (let frame = 0; frame < 180 && stableFrames < 8; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      freezeAnimations();
      const state = dynamicFingerprint();
      if (state === previousState) stableFrames += 1;
      else stableFrames = 0;
      previousState = state;
    }
  };

  await settleDynamicState();
  const candidate = capture();
  const baselineStyle = document.createElement("style");
  baselineStyle.dataset.cssEquivalenceBaseline = "true";
  baselineStyle.textContent = css;
  applicationStyles[0].before(baselineStyle);
  for (const applicationStyle of applicationStyles) {
    applicationStyle.setAttribute("media", "not all");
    if (applicationStyle.sheet) applicationStyle.sheet.disabled = true;
  }

  await document.fonts.ready;
  await settleDynamicState();
  const baseline = capture();

  const differences: string[] = [];
  let differenceCount = 0;
  const record = (message: string) => {
    differenceCount += 1;
    if (differences.length < 80) differences.push(message);
  };
  const compareStringMap = (label: string, area: string, candidateValues: Record<string, string>, baselineValues: Record<string, string>) => {
    for (const property of Object.keys(candidateValues)) {
      if (candidateValues[property] !== baselineValues[property]) {
        record(`${label} ${area}.${property}: candidato=${JSON.stringify(candidateValues[property])}, baseline=${JSON.stringify(baselineValues[property])}`);
      }
    }
  };
  const compareNumberMap = (label: string, area: string, candidateValues: Record<string, number>, baselineValues: Record<string, number>) => {
    for (const property of Object.keys(candidateValues)) {
      if (Math.abs(candidateValues[property] - baselineValues[property]) > geometryTolerance) {
        record(`${label} ${area}.${property}: candidato=${candidateValues[property]}, baseline=${baselineValues[property]}`);
      }
    }
  };

  for (const [key, candidateElement] of candidate) {
    const baselineElement = baseline.get(key);
    if (!baselineElement) {
      record(`${candidateElement.label}: el elemento no existe en baseline`);
      continue;
    }
    compareStringMap(candidateElement.label, "style", candidateElement.styles, baselineElement.styles);
    compareStringMap(candidateElement.label, "::before", candidateElement.pseudoBefore, baselineElement.pseudoBefore);
    compareStringMap(candidateElement.label, "::after", candidateElement.pseudoAfter, baselineElement.pseudoAfter);
    compareNumberMap(candidateElement.label, "rect", candidateElement.rect, baselineElement.rect);
    compareNumberMap(candidateElement.label, "dimensions", candidateElement.dimensions, baselineElement.dimensions);
  }
  for (const [key, baselineElement] of baseline) {
    if (!candidate.has(key)) record(`${baselineElement.label}: el elemento solo existe en baseline`);
  }

  return {
    baselineElementCount: baseline.size,
    candidateElementCount: candidate.size,
    comparedPropertyCount: propertyNames.length,
    differences,
    differenceCount,
    replacedStyleCount: applicationStyles.length,
  } satisfies EquivalenceResult;
}, {css: baselineCss, properties: [...comparedProperties], geometryTolerance: 0.05});

const assertEquivalent = (result: EquivalenceResult, context: string) => {
  const suffix = result.differenceCount > result.differences.length
    ? `\n… y ${result.differenceCount - result.differences.length} diferencias adicionales`
    : "";
  expect.soft(
    result.differenceCount,
    [
      `${context}: candidate debe conservar estilos y geometría de baseline ${baselineRef}.`,
      `Elementos candidato/baseline: ${result.candidateElementCount}/${result.baselineElementCount}; propiedades: ${result.comparedPropertyCount}; estilos de aplicación sustituidos: ${result.replacedStyleCount}.`,
      ...result.differences,
    ].join("\n") + suffix,
  ).toBe(0);
};

test.describe("equivalencia CSS candidate frente a baseline", () => {
  test.skip(!baselineRef, "Defina CSS_BASELINE_REF para activar esta prueba diagnóstica.");

  for (const viewport of viewports) {
    test(`las vistas compartidas conservan estilos y geometría a ${viewport.name}px`, async ({page}) => {
      test.setTimeout(240_000);
      await page.setViewportSize({width: viewport.width, height: viewport.height});
      for (const [url, heading] of sections) {
        await openApp(page, url);
        await settleView(page, heading);
        const result = await compareWithBaseline(page);
        assertEquivalent(result, `${heading} a ${viewport.name}px`);
      }
    });
  }
});
