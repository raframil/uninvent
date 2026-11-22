#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { readCatalog } from "./catalog.js";
import { checkProject } from "./check/run.js";
import { formatReport } from "./check/format.js";
import { findProjectRoot, loadConfig } from "./config.js";
import { UserError } from "./errors.js";
import { renderExists } from "./exists.js";
import { runHook } from "./hook/run.js";
import { installHooks, parseInstallTarget, type InstallTarget } from "./install.js";

const HELP = `uninvent — check that agents reuse the design system

Usage
  uninvent init [--ui <dir>] [--commit] [--force]
  uninvent scan
  uninvent exists <Component | "intent">
  uninvent check [path...] [--base <ref>] [--format text|json|markdown]
  uninvent install [claude-code|cursor] [--pre]
  uninvent hook [--file <path>]

check prints one line per reinvented element or recipe and nothing when the file is clean.
exists matches a component name or a composition recipe, for example: uninvent exists "confirm dialog"
Exit codes: 0 clean, 1 reinvented, 2 usage or catalog error.
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

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
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
      if (!args.file && process.stdin.isTTY) {
        process.stderr.write("uninvent hook reads a Claude Code or Cursor tool event on stdin.\n");
        return 0;
      }
      const stdin = args.file ? "" : await readStdin();
      const result = runHook({ stdin, file: args.file, cwd: args.cwd ? path.resolve(args.cwd) : process.cwd() });
      process.stdout.write(result.stdout);
      return result.exitCode;
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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

const entry = process.argv[1] ? realpathSync(path.resolve(process.argv[1])) : "";
if (entry && entry === realpathSync(fileURLToPath(import.meta.url))) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      if (error instanceof UserError) {
        process.stderr.write(`${error.message}\n`);
        process.exit(error.exitCode);
      }
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(2);
    });
}
