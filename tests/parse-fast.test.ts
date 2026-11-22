import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { analyzeSource } from "../src/check/analyze.js";
import { enableCompileCache } from "../src/compile-cache.js";
import { parseWithBabel } from "../src/parse/babel.js";
import { parseFast } from "../src/parse/fast.js";
import type { ParsedFile } from "../src/parse/types.js";
import { buttonComponent, sampleCatalog, sampleConfig } from "./helpers.js";

const require = createRequire(import.meta.url);
const catalog = sampleCatalog([buttonComponent()]);
const config = sampleConfig();

test("a plain file does not load Babel", () => {
  const id = require.resolve("@babel/parser");
  delete require.cache[id];
  const result = analyzeSource({
    source: `export function Page() {\n  return <button>Go</button>;\n}\n`,
    file: "src/pages/Page.tsx",
    catalog,
    config,
  });
  assert.match(result.findings[0]?.message ?? "", /raw <button> in src\/pages\/Page.tsx:2, use ui\/Button/);
  assert.equal(require.cache[id], undefined);
});

test("the fast scanner matches Babel on the repo's TSX", () => {
  const files = [
    ...walk(path.join(import.meta.dirname, "../examples"), /\.(tsx|jsx)$/),
    ...walk(path.join(import.meta.dirname, "../tests/fixtures"), /\.(tsx|jsx)$/),
    ...walk(path.join(import.meta.dirname, "../bench/corpus"), /\.(tsx|jsx)$/),
    ...walk(path.join(import.meta.dirname, "../tests/fixtures/workspace"), /\.(tsx|ts|d\.ts)$/),
    ...walk(path.join(import.meta.dirname, "../tests/fixtures/installed"), /\.(tsx|ts|d\.ts)$/),
  ];
  const unique = [...new Set(files)];
  assert.ok(unique.some((file) => file.includes("fixtures/workspace")));
  assert.ok(unique.some((file) => file.includes("fixtures/installed")));
  assert.ok(unique.some((file) => file.endsWith("index.ts")));
  assert.ok(unique.some((file) => file.endsWith(".d.ts")));
  for (const file of unique) {
    const source = readFileSync(file, "utf8");
    const fast = parseFast(source);
    const babel = parseWithBabel(source, file);
    assert.ok(fast, `fast scanner bailed on ${file}`);
    assert.ok(babel, `Babel could not parse ${file}`);
    assert.deepEqual(normalize(fast), normalize(babel), file);
  }
});

test("package and subpath imports match Babel", () => {
  const source = `import { Button, Input as TextField } from "@acme/ui";
import { Button as SubpathButton } from "@acme/ui/button";
export function Page() {
  return <button>Go</button>;
}
`;
  const fast = parseFast(source);
  const babel = parseWithBabel(source, "page.tsx");
  assert.ok(fast);
  assert.ok(babel);
  assert.deepEqual(normalize(fast), normalize(babel));
  assert.deepEqual(
    fast.imports.map((spec) => `${spec.imported} as ${spec.local} from ${spec.specifier}`),
    [
      "Button as Button from @acme/ui",
      "Input as TextField from @acme/ui",
      "Button as SubpathButton from @acme/ui/button",
    ],
  );
});

test("export default jsx matches Babel", () => {
  for (const source of [
    "export default <button>Go</button>\n",
    "export default (\n  <button>Go</button>\n)\n",
  ]) {
    const fast = parseFast(source);
    const babel = parseWithBabel(source, "page.tsx");
    assert.ok(fast);
    assert.ok(babel);
    assert.deepEqual(normalize(fast), normalize(babel));
  }
});

test("syntax the scanner skips still reports the same raw button through Babel", () => {
  const source = `import Button = require("./button");\nexport function Page() {\n  return <button>Go</button>;\n}\n`;
  assert.equal(parseFast(source), null);
  const result = analyzeSource({ source, file: "src/pages/Page.tsx", catalog, config });
  assert.match(result.findings.map((finding) => finding.message).join("\n"), /raw <button> in src\/pages\/Page.tsx:3, use ui\/Button/);
  assert.equal(result.parseError, undefined);
  assert.ok(require.cache[require.resolve("@babel/parser")]);
});

test("a decorator file stays unparsed, the same way Babel leaves it", () => {
  const source = `@sealed\nexport function Page() {\n  return <button>Go</button>;\n}\n`;
  assert.equal(parseFast(source), null);
  const result = analyzeSource({ source, file: "src/pages/Page.tsx", catalog, config });
  assert.equal(result.findings.length, 0);
  assert.match(result.parseError ?? "", /Could not parse/);
});

test("enabling the compile cache does not throw", () => {
  assert.doesNotThrow(() => enableCompileCache());
});

function walk(dir: string, pattern: RegExp, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" && !dir.includes(`${path.sep}fixtures${path.sep}installed`) && !dir.endsWith(`${path.sep}installed`)) continue;
      if (name === "dist" && !full.includes(`${path.sep}node_modules${path.sep}`)) continue;
      walk(full, pattern, acc);
    } else if (pattern.test(name)) acc.push(full);
  }
  return acc;
}

function normalize(file: ParsedFile): ParsedFile {
  const byName = (left: { name: string; line: number }, right: { name: string; line: number }) =>
    left.line - right.line || left.name.localeCompare(right.name);
  return {
    ...file,
    defined: [...file.defined].sort(byName),
    exported: [...file.exported].sort(byName),
  };
}
