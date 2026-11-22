import { spawnSync } from "node:child_process";

const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

export function git(cwd: string, args: string[], timeout = 180_000): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout, env });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `git ${args.join(" ")} failed`);
  }
  return (result.stdout ?? "").trim();
}

export function gitAllowFail(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000, env });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Commit without reading or writing the global git identity. */
export function commit(cwd: string, paths: string[], message: string): boolean {
  if (paths.length === 0) return false;
  git(cwd, ["add", "--", ...paths]);
  const staged = git(cwd, ["diff", "--cached", "--name-only"]);
  if (!staged) return false;
  git(cwd, [
    "-c",
    "user.email=uninvent-trial@users.noreply.github.com",
    "-c",
    "user.name=uninvent trial",
    "commit",
    "-m",
    message,
  ]);
  return true;
}
