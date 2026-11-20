#!/usr/bin/env node

import {readdir, readFile, stat} from "node:fs/promises";
import {gzipSync} from "node:zlib";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const INITIAL_JS_GZIP_LIMIT = 155_000;
export const STATISTICS_JS_GZIP_LIMIT = 90_000;
export const UPLOT_ENGINE_JS_GZIP_LIMIT = 30_000;
export const AG_CHARTS_ENGINE_JS_GZIP_LIMIT = 365_000;
export const FORBIDDEN_RUNTIME_SIGNATURES = [
  "MuiCharts",
  "MuiLineChart",
  "MuiPieChart",
  "MuiPieArc",
  "data-emotion",
  "@emotion/react",
  "@emotion/styled",
];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDistDirectory = path.resolve(scriptDirectory, "../dist");

function normalizedAssetPath(value) {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  return withoutQuery.replace(/^\.?\//, "").replace(/^\//, "");
}

export function extractInitialJavaScript(html) {
  const assets = new Set();
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const preloadPattern = /<link\b(?=[^>]*\brel=["']modulepreload["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/gi;
  for (const pattern of [scriptPattern, preloadPattern]) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const asset = normalizedAssetPath(match[1]);
      if (asset.endsWith(".js")) assets.add(asset);
    }
  }
  return [...assets];
}

async function walk(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(entryPath));
    if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function readableFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function detectedForbiddenSignatures(source) {
  return FORBIDDEN_RUNTIME_SIGNATURES.filter((signature) => source.includes(signature));
}

export async function inspectBuild(distDirectory = defaultDistDirectory) {
  const htmlPath = path.join(distDirectory, "index.html");
  if (!await readableFile(htmlPath)) throw new Error(`Falta el build de Vite: ${htmlPath}`);
  const html = await readFile(htmlPath, "utf8");
  const initialAssets = extractInitialJavaScript(html);
  if (!initialAssets.length) throw new Error("index.html no declara ningún script JavaScript inicial.");

  const initial = [];
  for (const asset of initialAssets) {
    const filePath = path.join(distDirectory, asset);
    if (!await readableFile(filePath)) throw new Error(`No existe el asset inicial ${asset}.`);
    const content = await readFile(filePath);
    initial.push({
      asset,
      bytes: content.byteLength,
      gzipBytes: gzipSync(content).byteLength,
      forbiddenSignatures: detectedForbiddenSignatures(content.toString("utf8")),
    });
  }

  const allJavaScript = (await walk(distDirectory))
    .filter((filePath) => filePath.endsWith(".js"))
    .map((filePath) => path.relative(distDirectory, filePath).split(path.sep).join("/"));
  const initialAssetSet = new Set(initialAssets);
  const dynamic = [];
  for (const asset of allJavaScript.filter((candidate) => !initialAssetSet.has(candidate))) {
    const content = await readFile(path.join(distDirectory, asset));
    dynamic.push({
      asset,
      bytes: content.byteLength,
      gzipBytes: gzipSync(content).byteLength,
      forbiddenSignatures: detectedForbiddenSignatures(content.toString("utf8")),
    });
  }

  return {
    initial,
    initialGzipBytes: initial.reduce((sum, item) => sum + item.gzipBytes, 0),
    dynamic,
  };
}

export function assertBuildReport(report, limit = INITIAL_JS_GZIP_LIMIT) {
  const errors = [];
  if (report.initialGzipBytes > limit) {
    errors.push(`El JS inicial ocupa ${report.initialGzipBytes} bytes gzip; el máximo es ${limit}.`);
  }
  const forbiddenAssets = [...report.initial, ...report.dynamic].filter((asset) => asset.forbiddenSignatures.length);
  if (forbiddenAssets.length) {
    errors.push(`MUI/Emotion reaparece en el build: ${forbiddenAssets.map(({asset}) => asset).join(", ")}.`);
  }
  const statisticsAssets = report.dynamic.filter(({asset}) => /(?:^|\/)StatisticsView-[^/]+\.js$/.test(asset) || asset.endsWith("/StatisticsView.js"));
  if (!statisticsAssets.length) {
    errors.push("No se encontró el chunk diferido de Estadísticas.");
  }
  for (const asset of statisticsAssets) {
    if (asset.gzipBytes > STATISTICS_JS_GZIP_LIMIT) {
      errors.push(`El chunk de Estadísticas ocupa ${asset.gzipBytes} bytes gzip; el máximo es ${STATISTICS_JS_GZIP_LIMIT}.`);
    }
  }
  const engineBudgets = [
    {
      label: "uPlot",
      pattern: /(?:^|\/)statistics-uplot-[^/]+\.js$/,
      limit: UPLOT_ENGINE_JS_GZIP_LIMIT,
    },
    {
      label: "AG Charts",
      pattern: /(?:^|\/)statistics-ag-charts-[^/]+\.js$/,
      limit: AG_CHARTS_ENGINE_JS_GZIP_LIMIT,
    },
  ];
  for (const {label, pattern, limit: engineLimit} of engineBudgets) {
    const assets = report.dynamic.filter(({asset}) => pattern.test(asset));
    if (assets.length !== 1) {
      errors.push(`Se esperaba un único chunk diferido de ${label}; encontrados: ${assets.length}.`);
      continue;
    }
    if (assets[0].gzipBytes > engineLimit) {
      errors.push(`El chunk de ${label} ocupa ${assets[0].gzipBytes} bytes gzip; el máximo es ${engineLimit}.`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return report;
}

export async function checkBuild(distDirectory = defaultDistDirectory) {
  return assertBuildReport(await inspectBuild(distDirectory));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const report = await checkBuild();
    console.log(`JS inicial: ${report.initialGzipBytes} bytes gzip (límite ${INITIAL_JS_GZIP_LIMIT}).`);
    console.log(`Assets iniciales: ${report.initial.map(({asset, gzipBytes}) => `${asset} (${gzipBytes} gzip)`).join(", ")}.`);
    console.log(`Estadísticas: ${report.dynamic.filter(({asset}) => asset.includes("StatisticsView")).map(({asset, gzipBytes}) => `${asset} (${gzipBytes} gzip)`).join(", ")}.`);
    console.log(`Motores: ${report.dynamic.filter(({asset}) => asset.includes("statistics-uplot") || asset.includes("statistics-ag-charts")).map(({asset, gzipBytes}) => `${asset} (${gzipBytes} gzip)`).join(", ")}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
