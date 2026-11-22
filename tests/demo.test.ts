import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCatalog, writeCatalog } from "../src/catalog.js";
import { checkProject } from "../src/check/run.js";
import { formatReport } from "../src/check/format.js";
import { loadConfig } from "../src/config.js";
import { renderExists } from "../src/exists.js";
import { renderCoverage } from "../src/stories/coverage.js";
import { initCommand, scanCommand } from "../src/project.js";
import { buttonComponent, repoRoot, sampleCatalog, tempDir } from "./helpers.js";

const demo = path.join(repoRoot, "examples/demo-app");

test("scan, exists, and check on the demo app", () => {
  const summary = scanCommand(demo);
  assert.match(summary, /^16 components, 3 stories, 6 states, 1 recipe, catalog written to \.uninvent\/catalog\.json$/);

  const config = loadConfig(demo);
  const catalog = readCatalog(demo, config.catalog);
  assert.equal(catalog.components.some((component) => component.name === "Button"), true);
  assert.equal(catalog.tokens.includes("--primary"), true);
  const button = catalog.components.find((component) => component.name === "Button");
  assert.equal(button?.importPath, "@/components/ui/button");
  assert.equal(button?.stories.some((story) => story.endsWith("button.stories.tsx")), true);

  const dialog = renderExists(catalog, "Dialog");
  assert.equal(dialog.found, true);
  assert.match(dialog.text, /^Dialog  src\/components\/ui\/dialog\.tsx:\d+\n/);
  assert.equal(dialog.text.trim().split("\n\n").length, 1);
  assert.match(dialog.text, /import \{ Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription \} from "@\/components\/ui\/dialog";/);
  assert.match(dialog.text, /primitives: radix \(@radix-ui\/react-dialog\)/);
  assert.match(dialog.text, /props: open\?, onOpenChange\?, children\?/);
  assert.match(dialog.text, /also: DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription/);
  assert.match(dialog.text, /states: open \(Open\)/);

  const buttonExists = renderExists(catalog, "Button");
  assert.match(buttonExists.text, /states: disabled \(Disabled\), loading \(Loading\), variant=default \(Primary\), variant=destructive \(Destructive\)/);

  const loading = renderExists(catalog, "loading button");
  assert.equal(loading.found, true);
  assert.match(loading.text, /^Button  src\/components\/ui\/button\.tsx:\d+\n/);
  assert.match(loading.text, /state: loading  story Loading/);
  assert.match(loading.text, /import \{ Button \} from "@\/components\/ui\/button";/);

  const coverage = renderCoverage(catalog, "Button", "text");
  assert.equal(coverage.exitCode, 0);
  assert.match(coverage.text, /variant=destructive  Destructive/);
  assert.match(coverage.text, /variant=outline  —/);
  assert.match(coverage.text, /loading  Loading/);
  assert.match(coverage.text, /does not fail the check/);

  const missing = renderExists(catalog, "Toaster");
  assert.equal(missing.found, false);
  assert.match(missing.text, /no match for "Toaster"/);

  const recipe = renderExists(catalog, "confirm dialog");
  assert.equal(recipe.found, true);
  assert.match(recipe.text, /^Confirm dialog  recipe confirm-dialog\n/);
  assert.match(recipe.text, /uses: Dialog, DialogContent, DialogTitle, DialogDescription, Button/);
  assert.match(recipe.text, /import \{ Button \} from "@\/components\/ui\/button";/);

  const clean = checkProject({
    root: demo,
    config,
    catalog,
    targets: ["src/pages/Customers.tsx"],
  });
  assert.equal(clean.findings.length, 0);
  assert.equal(formatReport(clean.findings, clean.reuses, "text"), "");
  assert.ok(clean.reuses.some((reuse) => reuse.name === "PageHeader"));

  const all = checkProject({ root: demo, config, catalog, targets: [] });
  const messages = all.findings.map((finding) => finding.message.replace(/:\d+,/, ":N,")).sort();
  assert.deepEqual(messages, [
    "raw <button> in src/pages/Login.tsx:N, use ui/Button",
    "raw <dialog> in src/components/Modal.tsx:N, use ui/Dialog",
    "raw <input> in src/pages/Login.tsx:N, use ui/Input",
    "rebuilt Confirm dialog in src/components/Confirm.tsx:N, use ui/Dialog + ui/Button",
    "reinvented loading on Button in src/components/SaveButton.tsx:N, use ui/Button loading",
  ]);
  const markdown = formatReport(all.findings, all.reuses, "markdown");
  assert.match(markdown, new RegExp(`\\*\\*reuse ${all.reuses.length} \\/ invent 5\\*\\*`));
  assert.match(markdown, /rebuilt `Confirm dialog`/);
  assert.match(markdown, /reinvented `loading` on `Button`/);
});

test("cli stays silent on a clean file and flags the demo", () => {
  const cli = [path.join(repoRoot, "src/cli.ts")];
  const clean = spawnSync(
    "node",
    ["--import", "tsx", ...cli, "check", "--cwd", demo, "src/pages/Customers.tsx"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(clean.stdout, "");
  assert.equal(clean.status, 0);

  const dirty = spawnSync(
    "node",
    ["--import", "tsx", ...cli, "check", "--cwd", demo],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(dirty.status, 1);
  assert.match(dirty.stdout, /raw <button> in src\/pages\/Login\.tsx:\d+, use ui\/Button\n/);
  assert.match(dirty.stdout, /raw <dialog> in src\/components\/Modal\.tsx:\d+, use ui\/Dialog\n/);
  assert.match(dirty.stdout, /rebuilt Confirm dialog in src\/components\/Confirm\.tsx:\d+, use ui\/Dialog \+ ui\/Button\n/);
  assert.match(dirty.stdout, /reinvented loading on Button in src\/components\/SaveButton\.tsx:\d+, use ui\/Button loading\n/);
  assert.equal(
    dirty.stdout.split("\n").some((line) => line.startsWith("raw") && line.includes("Confirm.tsx")),
    false,
  );
  assert.equal(dirty.stdout.includes("Customers.tsx"), false);

  const hook = spawnSync(
    "node",
    ["--import", "tsx", ...cli, "hook", "--cwd", demo],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "s",
        hook_event_name: "PostToolUse",
        cwd: demo,
        tool_name: "Write",
        tool_input: { file_path: path.join(demo, "src/pages/Customers.tsx") },
      }),
    },
  );
  assert.equal(hook.status, 0);
  assert.equal(hook.stdout, "");

  const stateHook = spawnSync(
    "node",
    ["--import", "tsx", ...cli, "hook", "--cwd", demo],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "s",
        hook_event_name: "PostToolUse",
        cwd: demo,
        tool_name: "Write",
        tool_input: { file_path: path.join(demo, "src/components/SaveButton.tsx") },
      }),
    },
  );
  assert.equal(stateHook.status, 0);
  assert.match(stateHook.stdout, /reinvented loading on Button in src\/components\/SaveButton\.tsx:\d+, use ui\/Button loading/);
  assert.equal(stateHook.stdout.includes("raw"), false);
});

test("init writes a gitignored catalog and a skill that names real components", () => {
  const root = tempDir();
  mkdirSync(path.join(root, "src/components/ui"), { recursive: true });
  writeFileSync(path.join(root, "src/components/ui/button.tsx"), readFileSync(
    path.join(demo, "src/components/ui/button.tsx"),
    "utf8",
  ));
  writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { jsx: "react-jsx", baseUrl: ".", paths: { "@/*": ["./src/*"] } },
  }));
  const lines = initCommand({ root, commit: false, force: false, ui: [] });
  assert.match(lines.join("\n"), /Wrote uninvent\.json/);
  assert.match(readFileSync(path.join(root, ".gitignore"), "utf8"), /\.uninvent\//);
  const skill = readFileSync(path.join(root, ".claude/skills/uninvent/SKILL.md"), "utf8");
  assert.match(skill, /uninvent exists <Component>/);
  assert.match(skill, /Button/);
  assert.match(skill, /variant \(default \| destructive \| outline \| secondary \| ghost \| link\)/);
  assert.equal(readFileSync(path.join(root, ".cursor/skills/uninvent/SKILL.md"), "utf8"), skill);
  assert.match(readFileSync(path.join(root, "AGENTS.md"), "utf8"), /<!-- uninvent:start -->/);
});

test("check --base reports only lines added since the ref", () => {
  const root = tempDir();
  mkdirSync(path.join(root, "src/pages"), { recursive: true });
  writeFileSync(path.join(root, "uninvent.json"), `${JSON.stringify({
    ui: ["src/components/ui"],
    catalog: ".uninvent/catalog.json",
  })}\n`);
  writeCatalog(root, ".uninvent/catalog.json", sampleCatalog([buttonComponent()]));
  writeFileSync(path.join(root, "src/pages/Home.tsx"), `import { Button } from "@/components/ui/button";\nexport function Home() {\n  return <Button>Ok</Button>;\n}\n`);
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "base"]);
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  writeFileSync(
    path.join(root, "src/pages/Home.tsx"),
    `import { Button } from "@/components/ui/button";\nexport function Home() {\n  return (\n    <>\n      <Button>Ok</Button>\n      <button>New</button>\n    </>\n  );\n}\n`,
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "invent"]);

  const config = loadConfig(root);
  const catalog = readCatalog(root, config.catalog);
  const result = checkProject({ root, config, catalog, targets: [], base });
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0]?.message ?? "", /raw <button> in src\/pages\/Home\.tsx:\d+, use ui\/Button/);
  assert.equal(result.reuses.some((reuse) => reuse.name === "Button"), true);
});

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}
