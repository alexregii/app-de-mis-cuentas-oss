import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
for (const directory of ["src/__tests__", "src/test-fixtures"]) {
  const tests = path.join(root, directory);
  for (const name of fs.readdirSync(tests, {recursive: true})) {
    if (!/\.tsx?$/.test(name)) continue;
    const file = path.join(tests, name);
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function inspect(node) {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0] : undefined;
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const resolved = path.resolve(path.dirname(file), specifier.text);
        if (resolved.startsWith(path.join(root, "src/ui-lab") + path.sep) || /(?:^|\/)ui-lab(?:\/|$)/.test(specifier.text)) {
          failures.push(`${name}: ${specifier.text}`);
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
}
if (failures.length) {
  console.error("App tests must not import UI Lab:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("Test scopes valid: app tests do not import UI Lab.");
