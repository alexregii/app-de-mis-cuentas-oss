#!/usr/bin/env node

import {readdir, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptDirectory, "../src");
const permittedFiles = new Set(["format.ts", "shared/lib/privacy.ts"]);
const forbiddenPatterns = [
  {label: "formateo monetario directo", expression: /(?:toLocaleString|Intl\.NumberFormat)[\s\S]{0,160}?style\s*:\s*["']currency["']/},
  {label: "símbolo monetario literal", expression: /€/},
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith("__")) files.push(...await walk(entryPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

const violations = [];
for (const file of await walk(sourceRoot)) {
  const relative = path.relative(sourceRoot, file).split(path.sep).join("/");
  if (permittedFiles.has(relative)) continue;
  const source = await readFile(file, "utf8");
  for (const {label, expression} of forbiddenPatterns) {
    if (expression.test(source)) violations.push(`${relative}: ${label}; usa euro, compactEuro o currency desde format.ts.`);
  }
}

if (violations.length) {
  console.error(`Formato sensible no centralizado:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("Formato monetario sensible centralizado.");
