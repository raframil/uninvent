import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git } from "./git.js";
import type { TrialRepo } from "./types.js";

export function cliArgs(uninventRoot: string): string[] {
  const dist = path.join(uninventRoot, "dist/cli.js");
  if (existsSync(dist)) return [process.execPath, dist];
  const loader = path.join(uninventRoot, "node_modules/tsx/dist/loader.mjs");
  const source = path.join(uninventRoot, "src/cli.ts");
  return [process.execPath, "--import", loader, source];
}

export function materialize(repo: TrialRepo, dest: string, cacheRoot: string): string {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (repo.path) {
    git(repo.path, ["rev-parse", "--verify", repo.sha]);
    git(path.dirname(dest), ["clone", "--local", repo.path, dest]);
    git(dest, ["checkout", "--detach", repo.sha]);
    return git(dest, ["rev-parse", "HEAD"]);
  }
  const cache = path.join(cacheRoot, repo.id);
  if (!existsSync(path.join(cache, ".git"))) {
    mkdirSync(cache, { recursive: true });
    git(cache, ["init"]);
    git(cache, ["remote", "add", "origin", repo.url]);
    git(cache, ["fetch", "--depth", "1", "origin", repo.sha], 300_000);
    git(cache, ["checkout", "--detach", "FETCH_HEAD"]);
  }
  const cached = git(cache, ["rev-parse", "HEAD"]);
  if (!repo.sha.startsWith(cached) && !cached.startsWith(repo.sha)) {
    throw new Error(`${repo.id} cache is ${cached}, not ${repo.sha}. Delete ${cache} and retry.`);
  }
  git(path.dirname(dest), ["clone", "--local", cache, dest]);
  return git(dest, ["rev-parse", "HEAD"]);
}

/** Point the project's local bin at this checkout and install the PostToolUse hook. */
export function installUninvent(project: string, uninventRoot: string): string[] {
  const binDir = path.join(project, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const wrapper = path.join(binDir, "uninvent");
  const args = cliArgs(uninventRoot);
  const command = args.map(shellQuote).join(" ");
  writeFileSync(wrapper, `#!/usr/bin/env bash\nexec ${command} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const lines = [
    runCli(uninventRoot, ["init", "--cwd", project]),
    runCli(uninventRoot, ["install", "--cwd", project]),
    runCli(uninventRoot, ["scan", "--cwd", project]),
  ];
  return lines;
}

export function scanForScore(project: string, uninventRoot: string): string {
  return runCli(uninventRoot, ["init", "--cwd", project]) + "\n" + runCli(uninventRoot, ["scan", "--cwd", project]);
}

export function defaultCacheRoot(): string {
  return path.join(tmpdir(), "uninvent-trial-cache");
}

function runCli(uninventRoot: string, args: string[]): string {
  const cli = cliArgs(uninventRoot);
  const result = spawnSync(cli[0] ?? "node", [...cli.slice(1), ...args], {
    encoding: "utf8",
    timeout: 180_000,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `uninvent ${args[0]} failed`);
  }
  return (result.stdout ?? "").trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
