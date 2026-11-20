#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GROUPING_AT_RULES = new Set([
  "container",
  "document",
  "layer",
  "media",
  "scope",
  "starting-style",
  "supports",
]);

function locationFor(source, offset) {
  const prefix = source.slice(0, offset);
  const line = prefix.split("\n").length;
  const lastNewline = prefix.lastIndexOf("\n");
  return { line, column: offset - lastNewline };
}

function skipComment(source, index, end) {
  const close = source.indexOf("*/", index + 2);
  if (close === -1 || close >= end) {
    const { line, column } = locationFor(source, index);
    throw new Error(`Comentario CSS sin cerrar en ${line}:${column}`);
  }
  return close + 2;
}

function findBlockEnd(source, openingBrace, end) {
  let depth = 1;
  let quote = "";

  for (let index = openingBrace + 1; index < end; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "/" && source[index + 1] === "*") {
      index = skipComment(source, index, end) - 1;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  const { line, column } = locationFor(source, openingBrace);
  throw new Error(`Bloque CSS sin cerrar iniciado en ${line}:${column}`);
}

function readPrelude(source, start, end) {
  let quote = "";
  let parentheses = 0;
  let brackets = 0;

  for (let index = start; index < end; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "/" && source[index + 1] === "*") {
      index = skipComment(source, index, end) - 1;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets = Math.max(0, brackets - 1);
    } else if (parentheses === 0 && brackets === 0 && (character === "{" || character === ";")) {
      return { prelude: source.slice(start, index), delimiter: character, index };
    }
  }

  return { prelude: source.slice(start, end), delimiter: "", index: end };
}

function stripComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, " ");
}

export function splitSelectors(selectorList) {
  const selectors = [];
  let start = 0;
  let quote = "";
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "/" && selectorList[index + 1] === "*") {
      const close = selectorList.indexOf("*/", index + 2);
      if (close === -1) throw new Error("Comentario sin cerrar en lista de selectores");
      index = close + 1;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets = Math.max(0, brackets - 1);
    } else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(selectorList.slice(start, index));
      start = index + 1;
    }
  }

  selectors.push(selectorList.slice(start));
  return selectors.map((selector) => stripComments(selector).trim()).filter(Boolean);
}

export function normalizeSelector(selector) {
  const source = stripComments(selector).trim();
  let normalized = "";
  let quote = "";
  let pendingWhitespace = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      normalized += character;
      if (character === "\\" && index + 1 < source.length) normalized += source[++index];
      else if (character === quote) quote = "";
      continue;
    }

    if (character === '"' || character === "'") {
      if (pendingWhitespace && normalized && !/[>+~,(\[]$/.test(normalized)) normalized += " ";
      pendingWhitespace = false;
      quote = character;
      normalized += character;
    } else if (/\s/.test(character)) {
      pendingWhitespace = true;
    } else if (/[>+~]/.test(character)) {
      normalized = normalized.trimEnd() + character;
      pendingWhitespace = false;
    } else {
      if (pendingWhitespace && normalized && !/[>+~,(\[]$/.test(normalized) && !/[),\]]/.test(character)) {
        normalized += " ";
      }
      pendingWhitespace = false;
      normalized += character;
    }
  }

  return normalized.trim();
}

export function parseCssSelectors(source) {
  const selectors = [];

  function parseRange(start, end, contexts) {
    let index = start;
    while (index < end) {
      while (index < end) {
        if (/\s/.test(source[index])) index += 1;
        else if (source[index] === "/" && source[index + 1] === "*") index = skipComment(source, index, end);
        else break;
      }
      if (index >= end) break;

      const statementStart = index;
      const token = readPrelude(source, statementStart, end);
      const prelude = stripComments(token.prelude).trim();

      if (!token.delimiter) {
        if (prelude) {
          const { line, column } = locationFor(source, statementStart);
          throw new Error(`Sentencia CSS incompleta en ${line}:${column}: ${prelude.slice(0, 80)}`);
        }
        break;
      }

      if (token.delimiter === ";") {
        index = token.index + 1;
        continue;
      }

      const blockEnd = findBlockEnd(source, token.index, end);
      if (prelude.startsWith("@")) {
        const atRule = prelude.slice(1).match(/^[-\w]+/)?.[0]?.toLowerCase() ?? "";
        if (GROUPING_AT_RULES.has(atRule)) {
          parseRange(token.index + 1, blockEnd, [...contexts, prelude]);
        }
      } else if (prelude) {
        const { line, column } = locationFor(source, statementStart);
        for (const selector of splitSelectors(prelude)) {
          selectors.push({
            selector,
            normalized: normalizeSelector(selector),
            line,
            column,
            contexts,
          });
        }
      }
      index = blockEnd + 1;
    }
  }

  parseRange(0, source.length, []);
  return selectors;
}

export function ownerForImport(importPath) {
  const normalizedPath = importPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalizedPath.startsWith("ui/")) {
    const parts = normalizedPath.split("/").filter(Boolean);
    const area = parts[1] ?? "";
    if (["foundations", "finance"].includes(area)) return `ui/${area}`;
    return "ui";
  }
  const marker = "styles/";
  const markerIndex = normalizedPath.indexOf(marker);
  if (markerIndex === -1) return null;
  const relativePath = normalizedPath.slice(markerIndex + marker.length);
  const parts = relativePath.split("/").filter(Boolean);
  const root = parts[0];

  if (["foundation", "app", "shared"].includes(root)) return root;
  if (root === "integrations") {
    const integration = (parts[1] ?? "").replace(/\.css$/i, "");
    return integration ? `integrations/${integration}` : null;
  }
  if (root === "features") {
    const feature = (parts[1] ?? "").replace(/\.css$/i, "");
    return feature ? `feature/${feature}` : null;
  }
  return null;
}

async function listFiles(directory, relativeDirectory = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(absolutePath, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

async function collectCssManifestFiles(entryPath, sourceRoot) {
  const visited = new Set();
  const queue = [entryPath];

  while (queue.length) {
    const currentPath = queue.shift();
    if (visited.has(currentPath)) continue;
    visited.add(currentPath);

    let source;
    try {
      source = await readFile(currentPath, "utf8");
    } catch {
      continue;
    }

    for (const specifier of parseLocalCssImports(source)) {
      const importedPath = path.resolve(path.dirname(currentPath), specifier);
      const relativeToSource = path.relative(sourceRoot, importedPath);
      if (relativeToSource.startsWith("..") || path.isAbsolute(relativeToSource)) continue;
      queue.push(importedPath);
    }
  }

  return visited;
}

export function parseManifest(source) {
  const imports = [];
  let remaining = stripComments(source);
  const importPattern = /^\s*@import\s+(?:"([^"]+)"|'([^']+)')\s*;/;

  while (remaining.trim()) {
    const match = remaining.match(importPattern);
    if (!match) throw new Error(`styles.css debe ser un manifiesto compuesto únicamente por @import locales`);
    imports.push(match[1] ?? match[2]);
    remaining = remaining.slice(match[0].length);
  }
  return imports;
}

const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)')(?:\s*\))?\s*[^;]*;/g;

export function parseLocalCssImports(source) {
  return [...source.matchAll(CSS_IMPORT_PATTERN)]
    .map((match) => match[1] ?? match[2] ?? "")
    .filter((specifier) => specifier.startsWith("."));
}

export function extractStableUiTokenUses(source) {
  return new Set([...source.matchAll(/var\(\s*(--ui-[\w-]+)/g)].map((match) => match[1]));
}

export function extractStableUiTokenDefinitions(source) {
  return new Set([...source.matchAll(/(--ui-[\w-]+)\s*:/g)].map((match) => match[1]));
}

export function extractCanonicalThemeNames(source) {
  return new Set(
    [...source.matchAll(/\[data-theme\s*=\s*["']?(mineral|basalt)(?:-ledger)?["']?\s*\]/g)].map((match) => match[1]),
  );
}

export function extractLegacyVisualTokenUses(source) {
  const cleanSource = stripComments(source);
  const pattern = /var\(\s*(--(?:system-[\w-]+|secondary-system-background|tertiary-system-background|grouped-background|label|secondary-label|tertiary-label|separator|separator-strong|glass(?:-[\w-]+)?|shadow|shadow-tight|radius|radius-sm|radius-control))(?=\s*(?:,|\)))/g;
  return new Set([...cleanSource.matchAll(pattern)].map((match) => match[1]));
}

export function extractRawColorLiterals(source) {
  const cleanSource = stripComments(source);
  const pattern = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\(\s*[-+.]?\d[^)]*\)/gi;
  return new Set([...cleanSource.matchAll(pattern)].map((match) => match[0]));
}

function isWithin(filePath, directory) {
  const relativePath = path.relative(directory, filePath);
  return relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..");
}

async function readCssFiles(sourceRoot) {
  const files = (await listFiles(sourceRoot)).filter((file) => file.endsWith(".css"));
  return Promise.all(files.map(async (relativePath) => ({
    absolutePath: path.join(sourceRoot, relativePath),
    relativePath,
    source: await readFile(path.join(sourceRoot, relativePath), "utf8"),
  })));
}

export async function auditCssOwnership(frontendRoot) {
  const sourceRoot = path.join(frontendRoot, "src");
  const stylesRoot = path.join(sourceRoot, "styles");
  const uiRoot = path.join(sourceRoot, "ui");
  const uiLabRoot = path.join(sourceRoot, "ui-lab");
  const featureRoot = path.join(sourceRoot, "features");
  const manifestPath = path.join(sourceRoot, "styles.css");
  const issues = [];
  let imports = [];

  try {
    imports = parseManifest(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return { imports, selectors: [], issues: [`Manifiesto inválido: ${error.message}`] };
  }

  const duplicateImports = imports.filter((item, index) => imports.indexOf(item) !== index);
  if (duplicateImports.length) issues.push(`Imports duplicados: ${[...new Set(duplicateImports)].join(", ")}`);
  if (!imports.includes("./ui/ui-system.css")) {
    issues.push("El entrypoint productivo debe consumir ./ui/ui-system.css.");
  }

  const importedAbsolutePaths = await collectCssManifestFiles(manifestPath, sourceRoot);
  const occurrences = [];

  for (const absolutePath of importedAbsolutePaths) {
    const relativeToSource = path.relative(sourceRoot, absolutePath).split(path.sep).join("/");
    const importPath = `./${relativeToSource}`;
    const relativeToStyles = path.relative(stylesRoot, absolutePath);
    if (relativeToStyles.split(path.sep).includes("compat")) {
      issues.push(`R11 no permite imports desde compat/: ${importPath}`);
    }
    const owner = ownerForImport(importPath);
    if (!owner) continue;
    try {
      const css = await readFile(absolutePath, "utf8");
      for (const parsed of parseCssSelectors(css)) {
        occurrences.push({ ...parsed, owner, importPath });
      }
    } catch (error) {
      issues.push(`No se pudo analizar ${importPath}: ${error.message}`);
    }
  }

  const allStyleFiles = (await listFiles(stylesRoot)).filter((file) => file.endsWith(".css"));
  for (const relativePath of allStyleFiles) {
    const absolutePath = path.join(stylesRoot, relativePath);
    if (!importedAbsolutePaths.has(absolutePath)) issues.push(`Archivo CSS sin importar: ./styles/${relativePath}`);
  }

  const sourceFiles = (await listFiles(sourceRoot)).filter((file) => /\.(?:ts|tsx)$/i.test(file));
  const sourceEntries = await Promise.all(sourceFiles.map(async (file) => ({
    file,
    source: await readFile(path.join(sourceRoot, file), "utf8"),
  })));
  const sourceCode = sourceEntries.map(({source}) => source);
  const uiLabMain = sourceEntries.find(({file}) => file.replaceAll("\\", "/") === "ui-lab/main.tsx");
  if (!uiLabMain?.source.includes("../ui/ui-system.css")) {
    issues.push("El entrypoint del UI Lab debe consumir ../ui/ui-system.css.");
  }
  const stableManifestFiles = await collectCssManifestFiles(path.join(uiRoot, "ui-system.css"), sourceRoot);
  const importsCss = (file) => sourceCode.some((source) => source.includes(`/${file}`) || source.includes(`./${file}`))
    || [...stableManifestFiles].some((candidate) => path.basename(candidate) === file);

  const cssFiles = await readCssFiles(sourceRoot);
  const stableUiTokenDefinitions = new Set();
  const stableFoundationRoot = path.join(stylesRoot, "foundation");
  const stableUiFoundationsRoot = path.join(uiRoot, "foundations");
  for (const {absolutePath, source} of cssFiles) {
    if (isWithin(absolutePath, stableFoundationRoot) || isWithin(absolutePath, stableUiFoundationsRoot)) {
      for (const token of extractStableUiTokenDefinitions(source)) stableUiTokenDefinitions.add(token);
    }
  }

  for (const {absolutePath, relativePath, source} of cssFiles) {
    const sourceIsUiLab = isWithin(absolutePath, uiLabRoot);
    const sourceIsStableUi = isWithin(absolutePath, uiRoot);
    const normalizedRelativePath = relativePath.replaceAll("\\", "/");
    for (const specifier of parseLocalCssImports(source)) {
      const importedPath = path.resolve(path.dirname(absolutePath), specifier);
      if (sourceIsStableUi && (isWithin(importedPath, featureRoot) || isWithin(importedPath, uiLabRoot))) {
        issues.push(`src/ui no puede importar ${path.relative(sourceRoot, importedPath).split(path.sep).join("/")}.`);
      }
      if (!sourceIsUiLab && isWithin(importedPath, uiLabRoot)) {
        issues.push(`La producción no puede importar CSS de ui-lab: ${relativePath} -> ${specifier}.`);
      }
    }

    if (sourceIsStableUi) {
      for (const token of extractStableUiTokenUses(source)) {
        if (!stableUiTokenDefinitions.has(token)) {
          issues.push(`Token ${token} usado por UI estable sin definición en foundations estables: ${relativePath}.`);
        }
      }
    }

    if (normalizedRelativePath !== "ui/foundations/themes.css") {
      const legacyTokens = extractLegacyVisualTokenUses(source);
      if (legacyTokens.size) {
        issues.push(
          `Tokens visuales legacy fuera del tema canónico en ${normalizedRelativePath}: ${[...legacyTokens].join(", ")}.`,
        );
      }
      const rawColors = extractRawColorLiterals(source);
      if (rawColors.size) {
        issues.push(
          `Colores literales fuera del tema canónico en ${normalizedRelativePath}: ${[...rawColors].join(", ")}.`,
        );
      }
    }
  }

  const themeFiles = new Map();
  for (const {relativePath, source} of cssFiles) {
    for (const themeName of extractCanonicalThemeNames(source)) {
      if (!themeFiles.has(themeName)) themeFiles.set(themeName, new Set());
      themeFiles.get(themeName).add(relativePath.replaceAll("\\", "/"));
    }
  }
  for (const [themeName, files] of themeFiles) {
    if (files.size !== 1 || !files.has("ui/foundations/themes.css")) {
      issues.push(`Theme ${themeName} debe tener una única definición canónica en ui/foundations/themes.css: ${[...files].join(", ")}.`);
    }
  }

  for (const [root, kind] of [[uiRoot, "ui"], [uiLabRoot, "ui-lab"]]) {
    const cssFiles = (await listFiles(root)).filter((file) => file.endsWith(".css"));
    for (const relativePath of cssFiles) {
      const absolutePath = path.join(root, relativePath);
      const isReachableFromStableManifest = importedAbsolutePaths.has(absolutePath);
      const css = await readFile(absolutePath, "utf8");
      const importName = relativePath.split("/").at(-1);
      if (!importsCss(importName)) issues.push(`CSS ${kind} sin importar: ${kind}/${relativePath}`);

      for (const parsed of parseCssSelectors(css)) {
        const selector = parsed.normalized;
        const isStableFoundationTheme = kind === "ui"
          && relativePath.startsWith("foundations/")
          && (/^:root(?:\[data-theme=[^\]]+\])?$/.test(selector) || /^\[data-theme=[^\]]+\]$/.test(selector));
        const isUiSelector = selector === ":root" || selector === "::selection" || selector.startsWith(".ui-") || isStableFoundationTheme;
        if (!isUiSelector) issues.push(`Selector no encapsulado en ${kind}/${relativePath}:${parsed.line}: ${selector}`);
        if (kind === "ui-lab" && /\.ui-(?!lab(?:-|\b)|foundation-)/.test(selector)) {
          issues.push(`ui-lab no puede redefinir internals UI en ${relativePath}:${parsed.line}: ${selector}`);
        }
        if (kind === "ui" && /\.feature-/.test(selector)) {
          issues.push(`ui no puede depender de feature CSS en ${relativePath}:${parsed.line}: ${selector}`);
        }
        if (!isReachableFromStableManifest) {
          occurrences.push({...parsed, owner: `${kind}/${relativePath}`, importPath: `${kind}/${relativePath}`});
        }
      }
    }
  }

  const compatFiles = await listFiles(path.join(stylesRoot, "compat"));
  if (compatFiles.length) issues.push(`styles/compat debe estar vacío: ${compatFiles.join(", ")}`);

  const bySelector = new Map();
  for (const occurrence of occurrences) {
    if (!bySelector.has(occurrence.normalized)) bySelector.set(occurrence.normalized, new Map());
    const owners = bySelector.get(occurrence.normalized);
    if (!owners.has(occurrence.owner)) owners.set(occurrence.owner, []);
    owners.get(occurrence.owner).push(occurrence);

  }

  for (const [selector, owners] of bySelector) {
    const productiveOwners = [...owners.entries()].filter(([owner]) => !owner.startsWith("ui-lab/"));
    if (productiveOwners.length <= 1) continue;
    const locations = productiveOwners.map(([owner, entries]) => {
      const first = entries[0];
      return `${owner} (${first.importPath}:${first.line})`;
    });
    issues.push(`Selector productivo con más de un propietario: ${selector} -> ${locations.join(", ")}`);
  }

  for (const [selector, owners] of bySelector) {
    if (!selector.startsWith(".ui-")) continue;
    for (const [owner, entries] of owners) {
      if (!owner.startsWith("ui/")) continue;
      const repeatedInContext = new Map();
      for (const entry of entries) {
        const context = entry.contexts.join(" > ");
        repeatedInContext.set(context, (repeatedInContext.get(context) ?? 0) + 1);
      }
      for (const [context, count] of repeatedInContext) {
        if (count > 1) issues.push(`Selector duplicado en ${owner}: ${selector}${context ? ` (${context})` : ""}`);
      }
    }
  }

  return { imports, selectors: occurrences, issues };
}

function printReport(report) {
  if (!report.issues.length) {
    const owners = new Set(report.selectors.map((entry) => entry.owner));
    console.log(
      `CSS ownership verificado: ${report.imports.length} archivos, ${report.selectors.length} selectores, ${owners.size} propietarios`,
    );
    return;
  }

  console.error(`CSS ownership falló con ${report.issues.length} incidencia(s):`);
  const visibleIssues = report.issues.slice(0, 60);
  for (const issue of visibleIssues) console.error(`- ${issue}`);
  if (visibleIssues.length < report.issues.length) {
    console.error(`- … ${report.issues.length - visibleIssues.length} incidencia(s) adicionales`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const frontendRoot = path.resolve(scriptDirectory, "..");
  const report = await auditCssOwnership(frontendRoot);
  printReport(report);
  if (report.issues.length) process.exitCode = 1;
}
