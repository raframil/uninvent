import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCatalog } from "../src/catalog.js";
import { checkProject } from "../src/check/run.js";
import { loadConfig } from "../src/config.js";
import { initCommand, scanCommand } from "../src/project.js";
import { renderCoverage } from "../src/stories/coverage.js";
import { repoRoot, tempDir } from "./helpers.js";

const sources = path.join(repoRoot, "tests/fixtures/sources");

function scanned(name: string) {
  const root = path.join(sources, name);
  const summary = scanCommand(root);
  const config = loadConfig(root);
  const catalog = readCatalog(root, config.catalog);
  return { root, summary, config, catalog };
}

test("Ladle CSF stories are a states source", () => {
  const { catalog } = scanned("ladle");
  assert.deepEqual(
    catalog.statesSources?.map((source) => source.id),
    ["ladle"],
  );
  const button = catalog.components.find((component) => component.name === "Button");
  assert.deepEqual(button?.states?.map((state) => state.id), ["loading", "variant:destructive"]);
  const coverage = renderCoverage(catalog, "Button", "text");
  assert.equal(coverage.exitCode, 0);
  assert.match(coverage.text, /loading  Loading/);
  assert.match(coverage.text, /variant=destructive  Destructive/);
  assert.match(coverage.text, /variant=default  —/);
});

test("Histoire React stories use the CSF reader", () => {
  const { catalog } = scanned("histoire");
  assert.deepEqual(catalog.components.map((component) => component.name), ["Button"]);
  assert.equal(catalog.statesSources?.[0]?.id, "histoire");
  assert.match(catalog.statesSources?.[0]?.files[0] ?? "", /button\.story\.tsx$/);
  const button = catalog.components.find((component) => component.name === "Button");
  assert.deepEqual(button?.states?.map((state) => state.id), ["loading", "variant:destructive"]);
  assert.match(renderCoverage(catalog, "", "text").text, /loading  Loading/);
});

test("Histoire Vue single-file stories are skipped in one line", () => {
  const { summary, catalog } = scanned("histoire-vue");
  assert.match(summary, /skipped Histoire Vue stories/);
  assert.deepEqual(catalog.statesSources, []);
  assert.match(catalog.statesNote ?? "", /Histoire \.story\.vue/);
  assert.equal(renderCoverage(catalog, "", "text").text, `${catalog.statesNote}\n`);
  assert.equal(renderCoverage(catalog, "Button", "text").text.split("\n").filter((line) => line.length > 0).length, 1);
});

test("a states manifest and @state tags document the same states", () => {
  const manifest = scanned("manifest");
  assert.equal(manifest.catalog.statesSources?.[0]?.id, "manifest");
  const manifestButton = manifest.catalog.components.find((component) => component.name === "Button");
  assert.deepEqual(manifestButton?.states?.map((state) => state.id), ["loading", "variant:destructive"]);
  assert.match(renderCoverage(manifest.catalog, "", "text").text, /variant=destructive  Destructive/);

  const jsdoc = scanned("jsdoc");
  assert.equal(jsdoc.catalog.statesSources?.[0]?.id, "jsdoc");
  const button = jsdoc.catalog.components.find((component) => component.name === "Button");
  const input = jsdoc.catalog.components.find((component) => component.name === "Input");
  assert.deepEqual(button?.states?.map((state) => state.id), ["loading", "variant:destructive"]);
  assert.deepEqual(input?.states?.map((state) => state.id), ["invalid"]);
  assert.match(renderCoverage(jsdoc.catalog, "Input", "text").text, /invalid  Invalid/);
});

test("a glob in uninvent.json reads an in-house story file", () => {
  const { catalog } = scanned("glob");
  assert.equal(catalog.statesSources?.some((source) => source.id === "storybook"), false);
  assert.equal(catalog.statesSources?.[0]?.id, "glob");
  assert.match(catalog.statesSources?.[0]?.files[0] ?? "", /button\.docs\.tsx$/);
  const button = catalog.components.find((component) => component.name === "Button");
  assert.equal(button?.states?.some((state) => state.id === "loading"), true);
});

test("uninvent.json can declare a primitive package and its part names", () => {
  const { root, config, catalog } = scanned("primitive");
  assert.equal(config.primitives[0]?.library, "acme");
  const button = catalog.components.find((component) => component.name === "Button");
  const dialog = catalog.components.find((component) => component.name === "Dialog");
  assert.deepEqual(button?.primitives, [{ library: "acme", package: "@acme/headless/button", parts: ["Button"] }]);
  assert.equal(button?.elements.includes("button"), true);
  assert.deepEqual(dialog?.primitives[0]?.parts, ["Modal.Popup"]);
  assert.equal(dialog?.elements.includes("dialog"), true);

  const clean = checkProject({ root, config, catalog, targets: ["src/pages/Home.tsx"] });
  assert.equal(clean.findings.length, 0);
  const login = checkProject({ root, config, catalog, targets: ["src/pages/Login.tsx"] });
  assert.match(login.findings[0]?.message ?? "", /raw <button> in src\/pages\/Login\.tsx:\d+, use ui\/Button/);
});

test("init keeps a declared primitive library", () => {
  const root = tempDir();
  mkdirSync(path.join(root, "src/components/ui"), { recursive: true });
  writeFileSync(path.join(root, "src/components/ui/button.tsx"), "export function Button() { return <button />; }\n");
  writeFileSync(
    path.join(root, "uninvent.json"),
    `${JSON.stringify({
      ui: ["src/components/ui"],
      primitives: [{ library: "acme", packages: ["@acme/headless"], parts: { Button: ["button"] } }],
    }, null, 2)}\n`,
  );
  initCommand({ root, commit: false, force: true, ui: [], packages: [] });
  const config = loadConfig(root);
  assert.equal(config.primitives[0]?.library, "acme");
  assert.deepEqual(config.primitives[0]?.parts?.Button, ["button"]);
});

test("Storybook owns shared CSF files when Ladle is installed too", () => {
  const root = tempDir();
  mkdirSync(path.join(root, "src/components/ui"), { recursive: true });
  mkdirSync(path.join(root, ".storybook"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { "@ladle/react": "5.1.0", storybook: "8.6.0" } }),
  );
  writeFileSync(
    path.join(root, "uninvent.json"),
    JSON.stringify({ ui: ["src/components/ui"], catalog: ".uninvent/catalog.json", commitCatalog: false }),
  );
  writeFileSync(path.join(root, "src/components/ui/button.tsx"), "export function Button() { return <button />; }\n");
  writeFileSync(
    path.join(root, "src/components/ui/button.stories.tsx"),
    `import { Button } from "./button";
export default { component: Button };
export const Loading = { args: { loading: true } };
`,
  );
  scanCommand(root);
  const catalog = readCatalog(root, ".uninvent/catalog.json");
  assert.deepEqual(catalog.statesSources?.map((source) => source.id), ["storybook"]);
});
