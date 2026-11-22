import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "./args.js";
import { readCatalog } from "./catalog.js";
import { formatReport } from "./check/format.js";
import { checkProject } from "./check/run.js";
import { findProjectRoot, loadConfig } from "./config.js";
import { renderExists } from "./exists.js";
import { installHooks, parseInstallTarget, type InstallTarget } from "./install.js";
import { renderCoverage } from "./stories/coverage.js";

const HELP = `uninvent — check that agents reuse the design system

Usage
  uninvent init [--ui <dir>] [--commit] [--force]
  uninvent scan
  uninvent exists <Component | "intent">
  uninvent check [path...] [--base <ref>] [--format text|json|markdown]
  uninvent coverage [Component] [--format text|json|markdown]
  uninvent install [claude-code|cursor] [--pre]
  uninvent hook [--file <path>]

check prints one line per reinvented element, recipe, or documented state and nothing when the file is clean.
exists matches a component name, a composition recipe, or a documented state, for example: uninvent exists "loading button"
coverage lists which variants and states have stories. It exits 0. It is not a failing gate.
Exit codes: 0 clean, 1 reinvented (or no exists/coverage match), 2 usage or catalog error.
The hook never blocks a write. It prints nothing unless the edit reinvented UI.
PreToolUse is off unless you pass --pre.

  --cwd <dir>     Project root. Defaults to the nearest uninvent.json
  --commit        Keep the catalog in git instead of gitignoring .uninvent/
  --ui <dir>      Design-system directory, relative to the project. Repeatable
  --base <ref>    Check the git diff against this ref
  --format        text (default), json, or markdown
  --pre           Also install a non-blocking PreToolUse hook
  --file <path>   Run the hook logic on one file and print plain lines
`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (args.help || !args.command) {
    process.stdout.write(HELP);
    return 0;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : findProjectRoot(process.cwd());

  switch (args.command) {
    case "init": {
      const { initCommand } = await import("./project.js");
      for (const line of initCommand({ root: cwd, commit: args.commit, force: args.force, ui: args.ui })) {
        process.stdout.write(`${line}\n`);
      }
      return 0;
    }
    case "scan": {
      const { scanCommand } = await import("./project.js");
      process.stdout.write(`${scanCommand(cwd)}\n`);
      return 0;
    }
    case "exists": {
      const config = loadConfig(cwd);
      const catalog = readCatalog(cwd, config.catalog);
      const result = renderExists(catalog, args.positionals.join(" "));
      process.stdout.write(result.text);
      return result.found ? 0 : 1;
    }
    case "coverage": {
      const config = loadConfig(cwd);
      const catalog = readCatalog(cwd, config.catalog);
      const result = renderCoverage(catalog, args.positionals.join(" "), args.format);
      process.stdout.write(result.text);
      return result.exitCode;
    }
    case "check": {
      const config = loadConfig(cwd);
      const catalog = readCatalog(cwd, config.catalog);
      const result = checkProject({
        root: cwd,
        config,
        catalog,
        targets: args.positionals,
        base: args.base,
      });
      for (const message of result.parseErrors) process.stderr.write(`${message}\n`);
      process.stdout.write(formatReport(result.findings, result.reuses, args.format));
      return result.findings.length > 0 ? 1 : 0;
    }
    case "install": {
      const targets: InstallTarget[] = args.positionals.length === 0
        ? ["claude-code", "cursor"]
        : args.positionals.map(parseInstallTarget);
      for (const line of installHooks(cwd, targets, args.pre)) process.stdout.write(`${line}\n`);
      return 0;
    }
    case "hook": {
      const { hookMain } = await import("./hook/main.js");
      return hookMain(argv);
    }
    default:
      process.stderr.write(`Unknown command "${args.command}".\n\n${HELP}`);
      return 2;
  }
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}
