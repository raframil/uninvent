import { spawnSync } from "node:child_process";
import path from "node:path";
import { UserError } from "../errors.js";
import { toPosix } from "../paths.js";

/** Added line numbers, keyed by path relative to the uninvent project. */
export function parseUnifiedDiff(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  let current: Set<number> | null = null;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      current = null;
      if (raw === "/dev/null") continue;
      const file = raw.replace(/^(?:b\/)/, "");
      current = files.get(file) ?? new Set<number>();
      files.set(file, current);
      continue;
    }
    if (!current) continue;
    const hunk = /^\@\@.*\+(\d+)(?:,(\d+))?/.exec(line);
    if (line.startsWith("@@") && hunk?.[1]) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+")) {
      current.add(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-") || line.startsWith("\\")) continue;
    newLine += 1;
  }
  return files;
}

export function diffAgainst(projectRoot: string, base: string): Map<string, Set<number>> {
  const git = gitRoot(projectRoot);
  if (!git) throw new UserError("Not a git repository. `uninvent check --base` needs git.");
  const triple = runGit(projectRoot, [
    "diff",
    "--unified=0",
    "--no-color",
    "--diff-filter=ACMR",
    `${base}...HEAD`,
  ]);
  const result = triple.status === 0
    ? triple
    : runGit(projectRoot, ["diff", "--unified=0", "--no-color", "--diff-filter=ACMR", base]);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new UserError(detail || `git diff ${base} failed.`);
  }
  const prefix = toPosix(path.relative(git, path.resolve(projectRoot)));
  const translated = new Map<string, Set<number>>();
  for (const [file, lines] of parseUnifiedDiff(result.stdout)) {
    const relative = stripPrefix(file, prefix);
    if (relative === null) continue;
    translated.set(relative, lines);
  }
  return translated;
}

function stripPrefix(file: string, prefix: string): string | null {
  if (!prefix || prefix === ".") return file;
  if (file === prefix) return "";
  if (file.startsWith(`${prefix}/`)) return file.slice(prefix.length + 1);
  return null;
}

function gitRoot(cwd: string): string | null {
  const result = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function runGit(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
