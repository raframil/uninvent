#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionError,
  commentLog,
  displayDirectory,
  exitCodeForCheck,
  failureSummary,
  formatSummary,
  gitFetchArgs,
  parseBool,
  reportFromCheck,
  resolveBase,
  resolveWorkingDirectory,
  withDirectory,
  workflowCommand,
} from "./comment.mjs";
import { syncComment } from "./github.mjs";

/**
 * @param {string} workspace
 */
export function defaultExec(workspace) {
  return (command, args) => {
    const result = spawnSync(command, args, {
      cwd: workspace,
      encoding: "utf8",
      env: process.env,
    });
    const spawnError = result.error ? result.error.message : "";
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: `${result.stderr ?? ""}${spawnError}`,
    };
  };
}

/**
 * @param {string | undefined} eventPath
 * @param {(path: string, encoding: "utf8") => string} [readFile]
 */
export function loadEvent(eventPath, readFile = readFileSync) {
  if (!eventPath) return {};
  try {
    return JSON.parse(readFile(eventPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ActionError(`Could not read GITHUB_EVENT_PATH (${eventPath}): ${message}`);
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {(path: string, encoding: "utf8") => string} [readFile]
 */
export function contextFromEnv(env, readFile = readFileSync) {
  const repository = env.GITHUB_REPOSITORY ?? "";
  const slash = repository.indexOf("/");
  const owner = slash === -1 ? "" : repository.slice(0, slash);
  const repo = slash === -1 ? "" : repository.slice(slash + 1);
  return {
    workspace: env.GITHUB_WORKSPACE || process.cwd(),
    workingDirectory: env.WORKING_DIRECTORY || ".",
    base: env.BASE || "",
    failOnFindings: parseBool(env.FAIL_ON_FINDINGS, false),
    comment: parseBool(env.COMMENT, true),
    token: env.GITHUB_TOKEN || "",
    owner,
    repo,
    apiUrl: env.GITHUB_API_URL || "https://api.github.com",
    eventName: env.GITHUB_EVENT_NAME || "",
    event: loadEvent(env.GITHUB_EVENT_PATH, readFile),
  };
}

/**
 * Scan, check the pull request base, write the job summary, and sync one comment.
 * Comment failures are warnings. Findings fail the job only when failOnFindings is set.
 * Scan errors, a missing base, and a check that does not print a report fail the job.
 * @param {object} ctx
 * @param {string} ctx.workspace
 * @param {string} [ctx.workingDirectory]
 * @param {string} [ctx.base]
 * @param {boolean} ctx.failOnFindings
 * @param {boolean} ctx.comment
 * @param {string} [ctx.token]
 * @param {string} [ctx.owner]
 * @param {string} [ctx.repo]
 * @param {string} [ctx.apiUrl]
 * @param {string} [ctx.eventName]
 * @param {object} [ctx.event]
 * @param {(command: string, args: string[]) => { status: number | null, stdout: string, stderr: string }} ctx.exec
 * @param {(text: string) => void} ctx.writeSummary
 * @param {(line: string) => void} [ctx.log]
 * @param {(url: string, init?: RequestInit) => Promise<Response>} [ctx.fetch]
 * @param {number} [ctx.maxPages]
 */
export async function execute(ctx) {
  const log = ctx.log ?? ((line) => console.log(line));
  const workspace = ctx.workspace;
  const cwd = resolveWorkingDirectory(workspace, ctx.workingDirectory);
  const directory = displayDirectory(workspace, ctx.workingDirectory);
  const base = resolveBase(ctx.base, ctx.event);
  if (!base) {
    const message = "No base ref. Run this action on pull_request, or pass the base input.";
    ctx.writeSummary(failureSummary(message));
    throw new ActionError(message);
  }

  const present = ctx.exec("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (present.status !== 0) {
    const fetched = ctx.exec("git", gitFetchArgs(base));
    if (fetched.status !== 0) {
      const detail = `Could not fetch base ref ${base}.\n${(fetched.stderr || fetched.stdout).trim()}\nCheckout with fetch-depth: 0, and leave the default token able to fetch from origin.`;
      ctx.writeSummary(failureSummary(detail));
      throw new ActionError(detail);
    }
  }

  const scan = ctx.exec("uninvent", ["scan", "--cwd", cwd]);
  if (scan.stdout.trim()) log(scan.stdout.trim());
  if (scan.status !== 0) {
    const detail = `uninvent scan failed.\n${(scan.stderr || scan.stdout || "uninvent scan failed.").trim()}`;
    ctx.writeSummary(failureSummary(detail));
    throw new ActionError(detail);
  }

  const check = ctx.exec("uninvent", ["check", "--cwd", cwd, "--base", base, "--format", "markdown"]);
  if (check.stderr.trim()) log(check.stderr.trim());
  const parsed = reportFromCheck(check);
  if (!parsed.ok) {
    const summary = failureSummary(parsed.detail);
    ctx.writeSummary(summary);
    log(summary.trimEnd());
    const code = check.status === null || check.status === undefined || check.status === 0 ? 1 : check.status;
    return { exitCode: code, report: summary, comment: { action: "skip", reason: "check did not print a report", warn: false } };
  }

  const visible = withDirectory(parsed.report, directory);
  ctx.writeSummary(visible);
  log(visible.trimEnd());

  let comment;
  if (!ctx.comment) {
    comment = { action: "skip", reason: "comment is false", warn: false };
  } else {
    try {
      comment = await syncComment({
        eventName: ctx.eventName,
        event: ctx.event,
        commentEnabled: true,
        token: ctx.token ?? "",
        owner: ctx.owner,
        repo: ctx.repo,
        apiUrl: ctx.apiUrl ?? "https://api.github.com",
        fetch: ctx.fetch ?? globalThis.fetch,
        report: parsed.report,
        workingDirectory: directory,
        maxPages: ctx.maxPages,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      comment = { action: "error", reason: message, warn: true };
    }
  }
  log(commentLog(comment));
  if (comment.warn || comment.action === "error") {
    log(workflowCommand("warning", comment.reason || "uninvent could not update the pull request comment"));
  }

  const exitCode = exitCodeForCheck({ checkStatus: check.status, failOnFindings: ctx.failOnFindings });
  if (exitCode !== 0 && check.status === 1) {
    log(workflowCommand("error", "uninvent found reinvented UI and fail-on-findings is true."));
  }
  return { exitCode, report: visible, comment };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function main(env = process.env) {
  try {
    const ctx = contextFromEnv(env);
    const result = await execute({
      ...ctx,
      exec: defaultExec(ctx.workspace),
      writeSummary: (text) => {
        if (!env.GITHUB_STEP_SUMMARY) return;
        appendFileSync(env.GITHUB_STEP_SUMMARY, formatSummary(text));
      },
    });
    process.exitCode = result.exitCode;
  } catch (error) {
    if (error instanceof ActionError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  await main();
}
