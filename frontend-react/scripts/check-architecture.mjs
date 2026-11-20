#!/usr/bin/env node

import {readdir, readFile, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const sourceRoot = path.join(projectRoot, "src");
const featureRoot = path.join(sourceRoot, "features");
const sharedRoot = path.join(sourceRoot, "shared");
const appRoot = path.join(sourceRoot, "app");
const uiRoot = path.join(sourceRoot, "ui");
const uiLabRoot = path.join(sourceRoot, "ui-lab");

const argumentsSet = new Set(process.argv.slice(2));
const strictTemporaryFeatureDependencies =
  argumentsSet.has("--strict-feature-deps") ||
  ["1", "true"].includes((process.env.ARCH_STRICT_FEATURE_DEPS ?? "").toLowerCase());

if (argumentsSet.has("--help")) {
  console.log(`Uso: node scripts/check-architecture.mjs [--strict-feature-deps]

Comprueba los limites de tamano, las fronteras entre capas, los imports directos
y los ciclos de los modulos TypeScript de src/.

  --strict-feature-deps  Convierte la excepcion temporal
                         statistics -> transactions en error.

Tambien puede activarse con ARCH_STRICT_FEATURE_DEPS=1.`);
  process.exit(0);
}

const sourceExtensions = new Set([".ts", ".tsx"]);
const resolutionExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const errors = [];
const warnings = [];

function relativeName(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function sourceName(filePath) {
  return path.relative(sourceRoot, filePath).split(path.sep).join("/");
}

function isWithin(filePath, directory) {
  const relativePath = path.relative(directory, filePath);
  return relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..");
}

function physicalLineCount(source) {
  if (source.length === 0) return 0;
  const newlineCount = source.match(/\n/g)?.length ?? 0;
  return newlineCount + (source.endsWith("\n") ? 0 : 1);
}

async function walk(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function addIssue(collection, filePath, message, details = {}) {
  collection.push({
    file: relativeName(filePath),
    message,
    ...details,
  });
}

function importedDependencies(source) {
  const dependencies = new Map();
  const patterns = [
    {pattern: /(?:^|\n)\s*import\s+(type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;?/g, typeOnlyGroup: 1, specifierGroup: 2},
    {pattern: /(?:^|\n)\s*export\s+(type\s+)?(?:\*|\{[^;]*?\})\s+from\s+["']([^"']+)["']\s*;?/g, typeOnlyGroup: 1, specifierGroup: 2},
    {pattern: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, typeOnlyGroup: null, specifierGroup: 1},
  ];

  for (const {pattern, typeOnlyGroup, specifierGroup} of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[specifierGroup];
      const runtime = typeOnlyGroup === null || !match[typeOnlyGroup];
      const current = dependencies.get(specifier);
      dependencies.set(specifier, {specifier, runtime: runtime || current?.runtime === true});
    }
  }

  return [...dependencies.values()];
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function resolveLocalImport(importer, specifier) {
  const requestedPath = path.resolve(path.dirname(importer), specifier);
  const candidates = [];

  if (path.extname(requestedPath)) {
    candidates.push({path: requestedPath, viaIndex: false});
  } else {
    for (const extension of resolutionExtensions) {
      candidates.push({path: `${requestedPath}${extension}`, viaIndex: false});
    }
    for (const extension of resolutionExtensions) {
      candidates.push({path: path.join(requestedPath, `index${extension}`), viaIndex: true});
    }
  }

  for (const candidate of candidates) {
    if (await isFile(candidate.path)) return candidate;
  }

  return {path: requestedPath, unresolved: true, viaIndex: false};
}

function featureName(filePath) {
  if (!isWithin(filePath, featureRoot)) return null;
  const [name] = path.relative(featureRoot, filePath).split(path.sep);
  return name || null;
}

export function stableBoundaryViolation(importer, resolved, roots, {allowTestImports = false} = {}) {
  const {appRoot, featureRoot, sharedRoot, uiLabRoot, uiRoot} = roots;
  const importerIsTest = sourceName(importer).includes("__tests__");
  const importerIsUiLab = isWithin(importer, uiLabRoot);
  const importerIsUi = isWithin(importer, uiRoot);
  const importerIsFeature = isWithin(importer, featureRoot);
  const dependencyIsUiLab = isWithin(resolved, uiLabRoot);

  if (importerIsUi && dependencyIsUiLab) return "ui no puede importar ui-lab.";
  if (importerIsFeature && dependencyIsUiLab) return "features no pueden importar ui-lab.";
  if (dependencyIsUiLab && !importerIsUiLab && !(allowTestImports && importerIsTest)) {
    return "La producción no puede importar ui-lab; el Lab solo puede ser consumidor de UI estable.";
  }
  if (importerIsUi && isWithin(resolved, sharedRoot)) {
    return "ui no puede importar shared.";
  }
  if (importerIsUi && (isWithin(resolved, appRoot) || isWithin(resolved, featureRoot))) {
    return `ui no puede importar ${sourceName(resolved)}.`;
  }
  if (importerIsUiLab && (isWithin(resolved, appRoot) || isWithin(resolved, featureRoot) || isWithin(resolved, sharedRoot))) {
    return `ui-lab solo puede importar ui o sus fixtures; no puede importar ${sourceName(resolved)}.`;
  }
  if (isWithin(importer, sharedRoot) && (isWithin(resolved, appRoot) || isWithin(resolved, featureRoot))) {
    return `shared no puede importar ${sourceName(resolved)}.`;
  }
  return null;
}

function cycleKey(cycle) {
  const nodes = cycle.slice(0, -1).map(sourceName);
  const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)].join(" -> "));
  return rotations.sort()[0];
}

function findCycles(files, graph) {
  const states = new Map();
  const stack = [];
  const cycles = new Map();

  function visit(filePath) {
    states.set(filePath, 1);
    stack.push(filePath);

    for (const dependency of graph.get(filePath) ?? []) {
      const state = states.get(dependency) ?? 0;
      if (state === 0) {
        visit(dependency);
      } else if (state === 1) {
        const cycleStart = stack.lastIndexOf(dependency);
        const cycle = [...stack.slice(cycleStart), dependency];
        cycles.set(cycleKey(cycle), cycle);
      }
    }

    stack.pop();
    states.set(filePath, 2);
  }

  for (const filePath of files) {
    if ((states.get(filePath) ?? 0) === 0) visit(filePath);
  }

  return [...cycles.values()];
}

const allFiles = await walk(sourceRoot);
const sourceFiles = allFiles.filter((filePath) => sourceExtensions.has(path.extname(filePath)));
const sourceFileSet = new Set(sourceFiles);
const sources = new Map();

for (const filePath of sourceFiles) sources.set(filePath, await readFile(filePath, "utf8"));

const appFile = path.join(sourceRoot, "App.tsx");
if (!sources.has(appFile)) {
  addIssue(errors, appFile, "Falta el compositor principal App.tsx.");
} else {
  const lines = physicalLineCount(sources.get(appFile));
  if (lines > 199) addIssue(errors, appFile, `Tiene ${lines} lineas; el maximo es 199.`);
}

for (const filePath of sourceFiles.filter((candidate) => isWithin(candidate, featureRoot))) {
  const lines = physicalLineCount(sources.get(filePath));
  if (path.basename(filePath).endsWith("View.tsx") && lines > 299) {
    addIssue(errors, filePath, `La vista tiene ${lines} lineas; el maximo es 299.`);
  }
  if (lines > 399) {
    addIssue(errors, filePath, `El archivo de feature tiene ${lines} lineas; el maximo es 399.`);
  }
}

for (const filePath of sourceFiles) {
  if (["index.ts", "index.tsx"].includes(path.basename(filePath))) {
    addIssue(errors, filePath, "No se permiten barrels index.ts/index.tsx; importa cada modulo directamente.");
  }
}

const dependencyGraph = new Map(sourceFiles.map((filePath) => [filePath, new Set()]));

for (const [importer, source] of sources) {
  for (const {specifier, runtime} of importedDependencies(source)) {
    if (!specifier.startsWith(".")) continue;

    const resolved = await resolveLocalImport(importer, specifier);
    if (resolved.unresolved) {
      addIssue(errors, importer, `No se puede resolver el import local "${specifier}".`);
      continue;
    }

    if (resolved.viaIndex) {
      addIssue(errors, importer, `El import "${specifier}" apunta a un directorio; importa el archivo concreto.`);
    }

    // Type-only dependencies still enforce layer ownership below, but cannot create an ES module runtime cycle.
    if (runtime && sourceFileSet.has(resolved.path)) dependencyGraph.get(importer).add(resolved.path);

    const boundaryViolation = stableBoundaryViolation(
      importer,
      resolved.path,
      {appRoot, featureRoot, sharedRoot, uiLabRoot, uiRoot},
      {allowTestImports: true},
    );
    if (boundaryViolation) addIssue(errors, importer, boundaryViolation);

    const importerFeature = featureName(importer);
    const dependencyFeature = featureName(resolved.path);
    if (importerFeature && dependencyFeature && importerFeature !== dependencyFeature) {
      const message = `La feature ${importerFeature} no puede importar la feature ${dependencyFeature} (${specifier}).`;
      const isTemporaryStatisticsRowsDependency =
        importerFeature === "statistics" && dependencyFeature === "transactions";

      if (isTemporaryStatisticsRowsDependency && !strictTemporaryFeatureDependencies) {
        addIssue(warnings, importer, `${message} Excepcion temporal: mueve TransactionRows a shared para retirarla.`);
      } else {
        addIssue(errors, importer, message);
      }
    }
  }
}

for (const cycle of findCycles(sourceFiles, dependencyGraph)) {
  addIssue(errors, cycle[0], `Ciclo local detectado: ${cycle.map(sourceName).join(" -> ")}.`);
}

function printIssues(label, issues) {
  for (const issue of issues.sort((left, right) =>
    `${left.file}:${left.message}`.localeCompare(`${right.file}:${right.message}`),
  )) {
    console.error(`[${label}] ${issue.file}: ${issue.message}`);
  }
}

printIssues("ERROR", errors);
printIssues("WARN", warnings);

if (errors.length > 0) {
  console.error(`Arquitectura React: ${errors.length} error(es), ${warnings.length} advertencia(s).`);
  process.exitCode = 1;
} else {
  console.log(`Arquitectura React correcta (${sourceFiles.length} modulos, ${warnings.length} advertencia(s)).`);
}
