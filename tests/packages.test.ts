import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCatalog } from "../src/catalog.js";
import { checkProject } from "../src/check/run.js";
import { loadConfig } from "../src/config.js";
import { renderExists } from "../src/exists.js";
import { runHook } from "../src/hook/run.js";
import { initCommand, scanCommand } from "../src/project.js";
import { renderSkill } from "../src/skill.js";
import { discoverDesignPackages } from "../src/workspace.js";
import { repoRoot } from "./helpers.js";

const workspace = path.join(repoRoot, "tests/fixtures/workspace");
const installed = path.join(repoRoot, "tests/fixtures/installed");

function messages(root: string, file: string): string[] {
  const config = loadConfig(root);
  const catalog = readCatalog(root, config.catalog);
  const result = checkProject({ root, config, catalog, targets: [file] });
  return result.findings.map((finding) => finding.message.replace(/:\d+,/, ":N,"));
}

test("init finds the workspace package from the app and from the repo root", () => {
  assert.deepEqual(discoverDesignPackages(path.join(workspace, "apps/web")), ["@acme/ui"]);
  assert.deepEqual(discoverDesignPackages(workspace), ["@acme/ui"]);
  assert.deepEqual(discoverDesignPackages(installed), ["@vendor/ui"]);
});

test("scan from a workspace app and from the repo root catalogs source and checks package imports", () => {
  const fromApp = scanCommand(path.join(workspace, "apps/web"));
  assert.match(fromApp, /packages @acme\/ui/);
  const app = path.join(workspace, "apps/web");
  const appConfig = loadConfig(app);
  const appCatalog = readCatalog(app, appConfig.catalog);
  const button = appCatalog.components.find((component) => component.name === "Button");
  assert.ok(button);
  assert.equal(button.importPath, "@acme/ui");
  assert.equal(button.specifiers?.includes("@acme/ui/button"), true);
  assert.equal(button.file.endsWith("packages/ui/src/button.tsx"), true);
  assert.equal(button.variants.some((variant) => variant.name === "variant"), true);
  assert.equal(button.states?.some((state) => state.prop === "loading"), true);
  assert.equal(button.primitives.some((primitive) => primitive.library === "radix"), true);
  assert.equal(appCatalog.components.some((component) => component.name === "DialogContent"), true);

  const exists = renderExists(appCatalog, "Button");
  assert.match(exists.text, /import \{ Button \} from "@acme\/ui";/);
  const dialog = renderExists(appCatalog, "Dialog");
  assert.match(dialog.text, /import \{ Dialog, DialogContent, DialogTitle \} from "@acme\/ui";/);
  assert.match(renderSkill(appCatalog), /Import packaged components from `@acme\/ui`/);

  assert.deepEqual(messages(app, "src/pages/Login.tsx"), [
    "raw <input> in src/pages/Login.tsx:N, use @acme/ui Input",
    "raw <button> in src/pages/Login.tsx:N, use @acme/ui Button",
  ]);
  const home = checkProject({ root: app, config: appConfig, catalog: appCatalog, targets: ["src/pages/Home.tsx"] });
  assert.equal(home.findings.length, 0);
  assert.deepEqual(home.reuses.map((reuse) => reuse.name).sort(), ["Button", "Input"]);
  const subpath = checkProject({ root: app, config: appConfig, catalog: appCatalog, targets: ["src/pages/Subpath.tsx"] });
  assert.equal(subpath.findings.length, 0);
  assert.equal(subpath.reuses[0]?.name, "Button");
  assert.deepEqual(messages(app, "src/pages/Save.tsx"), [
    "reinvented loading on Button in src/pages/Save.tsx:N, use @acme/ui Button loading",
  ]);
  assert.deepEqual(messages(app, "src/pages/SecondButton.tsx"), [
    "export Button in src/pages/SecondButton.tsx:N, use @acme/ui Button",
  ]);
  assert.deepEqual(messages(app, "src/components/Confirm.tsx"), [
    "rebuilt Confirm dialog in src/components/Confirm.tsx:N, use @acme/ui Dialog + @acme/ui Button",
  ]);

  const hook = runHook({ cwd: app, file: "src/pages/Home.tsx" });
  assert.equal(hook.stdout, "");
  assert.equal(hook.exitCode, 0);
  const dirty = runHook({ cwd: app, file: "src/pages/Login.tsx" });
  assert.match(dirty.stdout, /use @acme\/ui Button/);
  assert.equal(dirty.exitCode, 1);

  const fromRoot = scanCommand(workspace);
  assert.match(fromRoot, /packages @acme\/ui/);
  const rootConfig = loadConfig(workspace);
  const rootCatalog = readCatalog(workspace, rootConfig.catalog);
  assert.equal(rootCatalog.components.find((component) => component.name === "Button")?.importPath, "@acme/ui");
  assert.equal(rootCatalog.packages?.[0]?.dir, "packages/ui");
  assert.deepEqual(messages(workspace, "apps/web/src/pages/Login.tsx"), [
    "raw <input> in apps/web/src/pages/Login.tsx:N, use @acme/ui Input",
    "raw <button> in apps/web/src/pages/Login.tsx:N, use @acme/ui Button",
  ]);
  const rootHome = checkProject({
    root: workspace,
    config: rootConfig,
    catalog: rootCatalog,
    targets: ["apps/web/src/pages/Home.tsx"],
  });
  assert.equal(rootHome.findings.length, 0);
  assert.equal(rootHome.reuses.length, 2);
  assert.deepEqual(messages(workspace, "apps/web/src/components/Confirm.tsx"), [
    "rebuilt Confirm dialog in apps/web/src/components/Confirm.tsx:N, use @acme/ui Dialog + @acme/ui Button",
  ]);
  assert.deepEqual(messages(workspace, "packages/ui/src/button.tsx"), []);
});

test("scan reads a node_modules package from its type declarations", () => {
  const summary = scanCommand(installed);
  assert.match(summary, /packages @vendor\/ui/);
  const config = loadConfig(installed);
  const catalog = readCatalog(installed, config.catalog);
  const button = catalog.components.find((component) => component.name === "Button");
  assert.ok(button);
  assert.equal(button.importPath, "@vendor/ui");
  assert.equal(button.specifiers?.includes("@vendor/ui/button"), true);
  assert.equal(button.file.endsWith("node_modules/@vendor/ui/dist/button.d.ts"), true);
  assert.equal(button.props.some((prop) => prop.name === "loading"), true);
  assert.deepEqual(button.variants.find((variant) => variant.name === "variant")?.options, [
    "default",
    "destructive",
    "outline",
  ]);
  assert.equal(button.elements.includes("button"), true);
  const input = catalog.components.find((component) => component.name === "Input");
  assert.equal(input?.elements.includes("input"), true);
  assert.match(renderExists(catalog, "Button").text, /import \{ Button \} from "@vendor\/ui";/);
  assert.match(renderExists(catalog, "Button").text, /variants: variant=default\|destructive\|outline, size=default\|sm/);

  assert.deepEqual(messages(installed, "src/pages/Login.tsx"), [
    "raw <input> in src/pages/Login.tsx:N, use @vendor/ui Input",
    "raw <button> in src/pages/Login.tsx:N, use @vendor/ui Button",
  ]);
  const home = checkProject({ root: installed, config, catalog, targets: ["src/pages/Home.tsx"] });
  assert.equal(home.findings.length, 0);
  assert.deepEqual(home.reuses.map((reuse) => reuse.name).sort(), ["Button", "Input"]);
  const subpath = checkProject({ root: installed, config, catalog, targets: ["src/pages/Subpath.tsx"] });
  assert.equal(subpath.findings.length, 0);
  assert.equal(subpath.reuses[0]?.name, "Button");
});

test("init writes discovered packages and a path entry resolves", () => {
  const root = path.join(repoRoot, "tests/fixtures/workspace-init");
  rmSync(root, { recursive: true, force: true });
  cpSync(workspace, root, { recursive: true, filter: (source) => !source.includes(`${path.sep}.uninvent`) });
  rmSync(path.join(root, "uninvent.json"));
  rmSync(path.join(root, "apps/web/uninvent.json"));
  try {
    const fromRoot = initCommand({ root, commit: false, force: false, ui: [] });
    assert.match(fromRoot.join("\n"), /Wrote uninvent\.json/);
    const rootConfig = JSON.parse(readFileSync(path.join(root, "uninvent.json"), "utf8")) as { packages?: string[] };
    assert.deepEqual(rootConfig.packages, ["@acme/ui"]);
    assert.match(readFileSync(path.join(root, ".claude/skills/uninvent/SKILL.md"), "utf8"), /@acme\/ui/);

    const app = path.join(root, "apps/web");
    const fromApp = initCommand({ root: app, commit: false, force: false, ui: [] });
    assert.match(fromApp.join("\n"), /Wrote uninvent\.json/);
    const appConfig = JSON.parse(readFileSync(path.join(app, "uninvent.json"), "utf8")) as { packages?: string[] };
    assert.deepEqual(appConfig.packages, ["@acme/ui"]);

    const installedCopy = path.join(repoRoot, "tests/fixtures/installed-init");
    rmSync(installedCopy, { recursive: true, force: true });
    cpSync(installed, installedCopy, { recursive: true, filter: (source) => !source.includes(`${path.sep}.uninvent`) });
    rmSync(path.join(installedCopy, "uninvent.json"));
    const fromInstalled = initCommand({ root: installedCopy, commit: false, force: false, ui: [] });
    assert.match(fromInstalled.join("\n"), /Wrote uninvent\.json/);
    const installedConfig = JSON.parse(readFileSync(path.join(installedCopy, "uninvent.json"), "utf8")) as { packages?: string[] };
    assert.deepEqual(installedConfig.packages, ["@vendor/ui"]);
    rmSync(installedCopy, { recursive: true, force: true });

    const byPath = path.join(root, "by-path");
    mkdirSync(byPath, { recursive: true });
    writeFileSync(path.join(byPath, "package.json"), JSON.stringify({ name: "by-path", private: true }));
    const lines = initCommand({ root: byPath, commit: false, force: false, ui: [], packages: ["../packages/ui"] });
    assert.match(lines.join("\n"), /Wrote uninvent\.json/);
    const pathConfig = JSON.parse(readFileSync(path.join(byPath, "uninvent.json"), "utf8")) as { packages?: string[] };
    assert.deepEqual(pathConfig.packages, ["../packages/ui"]);
    const summary = scanCommand(byPath);
    assert.match(summary, /packages @acme\/ui/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the cli accepts --package and treats a package import as reuse", () => {
  scanCommand(path.join(workspace, "apps/web"));
  const cli = [path.join(repoRoot, "src/cli.ts")];
  const app = path.join(workspace, "apps/web");
  const clean = spawnSync(
    "node",
    ["--import", "tsx", ...cli, "check", "--cwd", app, "src/pages/Home.tsx"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stdout, "");
  const dirty = spawnSync(
    "node",
    ["--import", "tsx", ...cli, "check", "--cwd", app, "src/pages/Login.tsx"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(dirty.status, 1);
  assert.match(dirty.stdout, /use @acme\/ui Button/);
});
