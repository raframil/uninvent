import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatMarkdown } from "../src/check/format.js";
import type { Finding, Reuse } from "../src/types.js";
import {
  ActionError,
  CLEAN_REPORT,
  assertSafeRef,
  commentGate,
  commentLog,
  commentMarker,
  displayDirectory,
  exitCodeForCheck,
  findStickyComments,
  gitFetchArgs,
  parseBool,
  planComment,
  renderComment,
  reportFromCheck,
  resolveBase,
  resolveWorkingDirectory,
  sameBody,
  workflowCommand,
} from "../action/comment.mjs";
import { nextLink, syncComment } from "../action/github.mjs";
import { contextFromEnv, execute } from "../action/run.mjs";
import { resolveVersion } from "../action/version.mjs";

const root = path.resolve(import.meta.dirname, "..");

const finding: Finding = {
  kind: "raw-element",
  file: "src/pages/Login.tsx",
  line: 10,
  message: "raw <button> in src/pages/Login.tsx:10, use ui/Button",
  suggestion: "ui/Button",
  import: "@/components/ui/button",
  element: "button",
};
const reuse: Reuse = { name: "Button", file: "src/pages/Customers.tsx", line: 3 };

function pullRequest(head = "raframil/uninvent", baseRepo = "raframil/uninvent") {
  return {
    pull_request: {
      number: 12,
      base: { sha: "abc123def456", repo: { full_name: baseRepo } },
      head: { repo: head ? { full_name: head } : null },
    },
  };
}

test("sticky comment is the markdown report plus a hidden marker", () => {
  const report = formatMarkdown([finding], [reuse]);
  const comment = renderComment(report, "examples/demo-app");
  assert.ok(comment.startsWith(`${commentMarker("examples/demo-app")}\n`));
  assert.match(comment, /Directory `examples\/demo-app`/);
  assert.match(comment, /\*\*reuse 1 \/ invent 1\*\*/);
  assert.match(comment, /raw `<button>` in `src\/pages\/Login\.tsx:10`, use `ui\/Button`/);
  assert.match(comment, /Reused: Button/);

  const clean = renderComment(formatMarkdown([], []), ".");
  assert.match(clean, /\*\*reuse 0 \/ invent 0\*\*/);
  assert.match(clean, /Nothing reinvented\./);
  assert.equal(clean.includes("Directory `"), false);
  assert.ok(clean.split("\n").length <= 8);
});

test("a later push updates the marked comment and leaves the others", () => {
  const report = formatMarkdown([finding], [reuse]);
  const directory = "examples/demo-app";
  const marker = commentMarker(directory);
  const comments = [
    { id: 1, body: "thanks for the PR" },
    { id: 4, body: `${marker}\n## uninvent\n\n**reuse 0 / invent 3**\n\nold\n` },
    { id: 9, body: `${marker}\nsecond copy\n` },
    { id: 5, body: `${commentMarker(".")}\n## uninvent\n\nother package\n` },
  ];
  const plan = planComment({ comments, report, workingDirectory: directory, commentEnabled: true });
  assert.equal(plan.action, "update");
  assert.equal(plan.commentId, 4);
  assert.equal(plan.duplicates, 1);
  assert.match(plan.body, /raw `<button>`/);
  assert.equal(findStickyComments(comments, marker).map((comment) => comment.id).join(","), "4,9");
});

test("an unchanged comment is not written again", () => {
  const report = CLEAN_REPORT;
  const body = renderComment(report, ".");
  const plan = planComment({
    comments: [{ id: 7, body: body.replace(/\n/g, "\r\n") }],
    report,
    workingDirectory: ".",
    commentEnabled: true,
  });
  assert.equal(plan.action, "skip");
  assert.equal(plan.reason, "unchanged");
  assert.equal(plan.commentId, 7);
  assert.equal(sameBody(body, body.replace(/\n/g, "\r\n")), true);
});

test("no marker means create, and comment:false never writes", () => {
  const report = CLEAN_REPORT;
  const created = planComment({
    comments: [{ id: 3, body: "unrelated" }],
    report,
    workingDirectory: ".",
    commentEnabled: true,
  });
  assert.equal(created.action, "create");
  assert.equal(created.commentId, undefined);

  const disabled = planComment({
    comments: [],
    report,
    workingDirectory: ".",
    commentEnabled: false,
  });
  assert.equal(disabled.action, "skip");
  assert.equal(disabled.reason, "comment is false");
});

test("a clean check with empty stdout still gets the short report", () => {
  assert.equal(reportFromCheck({ status: 0, stdout: "  \n" }).ok, true);
  const clean = reportFromCheck({ status: 0, stdout: "" });
  assert.equal(clean.ok && clean.report, CLEAN_REPORT);
  const broken = reportFromCheck({ status: 1, stdout: "", stderr: "parser gave up" });
  assert.equal(broken.ok, false);
  const failed = reportFromCheck({ status: 2, stdout: "", stderr: "Not a git repository." });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.detail, /Not a git repository/);
});

test("findings fail the job only when asked", () => {
  assert.equal(exitCodeForCheck({ checkStatus: 0, failOnFindings: false }), 0);
  assert.equal(exitCodeForCheck({ checkStatus: 1, failOnFindings: false }), 0);
  assert.equal(exitCodeForCheck({ checkStatus: 1, failOnFindings: true }), 1);
  assert.equal(exitCodeForCheck({ checkStatus: 2, failOnFindings: false }), 2);
  assert.equal(exitCodeForCheck({ checkStatus: null, failOnFindings: false }), 1);
});

test("fork pull_request cannot comment; pull_request_target is warned, not used as a checkout", () => {
  const fork = commentGate({
    eventName: "pull_request",
    event: pullRequest("someone/uninvent"),
    commentEnabled: true,
    token: "t",
  });
  assert.equal(fork.post, false);
  assert.equal(fork.warn, true);
  assert.match(fork.reason, /Fork pull request/);
  assert.match(fork.reason, /pull_request_target/);
  assert.match(fork.reason, /untrusted/);

  const missingHead = commentGate({
    eventName: "pull_request",
    event: pullRequest(""),
    commentEnabled: true,
    token: "t",
  });
  assert.equal(missingHead.post, false);

  const target = commentGate({
    eventName: "pull_request_target",
    event: pullRequest("someone/uninvent"),
    commentEnabled: true,
    token: "t",
  });
  assert.equal(target.post, true);
  assert.equal(target.warn, true);
  assert.match(target.reason, /Do not check out untrusted/);

  const same = commentGate({
    eventName: "pull_request",
    event: pullRequest(),
    commentEnabled: true,
    token: "t",
  });
  assert.deepEqual(same, { post: true, warn: false, issueNumber: 12 });

  assert.equal(commentGate({ eventName: "push", event: {}, commentEnabled: true, token: "t" }).post, false);
  assert.equal(
    commentGate({ eventName: "pull_request", event: pullRequest(), commentEnabled: false, token: "t" }).reason,
    "comment is false",
  );
  assert.equal(
    commentGate({ eventName: "pull_request", event: pullRequest(), commentEnabled: true, token: "" }).warn,
    true,
  );
});

test("base ref prefers the input, otherwise the pull request SHA", () => {
  assert.equal(resolveBase("origin/main", pullRequest()), "origin/main");
  assert.equal(resolveBase("  ", pullRequest()), "abc123def456");
  assert.equal(resolveBase("", {}), undefined);
  assert.throws(() => assertSafeRef("-rf"), ActionError);
  assert.throws(() => resolveBase("main\n--upload-pack=evil", {}), ActionError);
  assert.deepEqual(gitFetchArgs("origin/feature/login"), ["fetch", "--no-tags", "origin", "feature/login"]);
  assert.deepEqual(gitFetchArgs("abc123def456"), ["fetch", "--no-tags", "origin", "abc123def456"]);
});

test("working-directory stays inside the repository", () => {
  assert.equal(resolveWorkingDirectory("/repo", "examples/demo-app"), "/repo/examples/demo-app");
  assert.equal(displayDirectory("/repo", "examples/demo-app/"), "examples/demo-app");
  assert.equal(displayDirectory("/repo", "."), ".");
  assert.throws(() => resolveWorkingDirectory("/repo", "../outside"), /inside the repository/);
  assert.throws(() => displayDirectory("/repo", "foo/../../etc"), /inside the repository/);
});

test("version is local, an npm version, or the package version — never a path", () => {
  assert.deepEqual(
    resolveVersion({ requested: "local", actionPackageVersion: "0.3.0", localBuildExists: true }),
    { source: "local" },
  );
  assert.throws(
    () => resolveVersion({ requested: "local", actionPackageVersion: "0.3.0", localBuildExists: false }),
    /dist\/cli\.js/,
  );
  assert.deepEqual(
    resolveVersion({ requested: "", actionPackageVersion: "0.3.0", localBuildExists: true }),
    { source: "local" },
  );
  assert.deepEqual(
    resolveVersion({ requested: "", actionPackageVersion: "0.3.0", localBuildExists: false }),
    { source: "npm", version: "0.3.0" },
  );
  assert.deepEqual(
    resolveVersion({ requested: "v0.3.0", actionPackageVersion: "0.3.0", localBuildExists: false }),
    { source: "npm", version: "0.3.0" },
  );
  assert.deepEqual(
    resolveVersion({ requested: "latest", actionPackageVersion: "0.3.0", localBuildExists: false }),
    { source: "npm", version: "latest" },
  );
  for (const bad of ["file:../uninvent", "0.3.0 && curl", "$(touch pwn)", "git+https://evil", "1.2"]) {
    assert.throws(() => resolveVersion({ requested: bad, actionPackageVersion: "0.3.0", localBuildExists: false }), /Invalid uninvent version/);
  }
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  const decision = resolveVersion({ requested: "", actionPackageVersion: pkg.version, localBuildExists: false });
  assert.deepEqual(decision, { source: "npm", version: pkg.version });
});

test("workflow commands escape newlines, and comment logs name the action", () => {
  const line = workflowCommand("warning", "first\nsecond %");
  assert.equal(line.includes("\n"), false);
  assert.match(line, /^::warning::first%0Asecond %25$/);
  assert.equal(commentLog({ action: "create", commentId: 9 }), "uninvent comment: created #9");
  assert.equal(commentLog({ action: "update", commentId: 4 }), "uninvent comment: updated #4");
  assert.match(commentLog({ action: "skip", reason: "unchanged", commentId: 4 }), /unchanged #4/);
});

test("parseBool accepts the strings GitHub passes for inputs", () => {
  assert.equal(parseBool(undefined, false), false);
  assert.equal(parseBool("true", false), true);
  assert.equal(parseBool("YES", false), true);
  assert.equal(parseBool("0", true), false);
  assert.throws(() => parseBool("maybe", false), /true or false/);
});

test("next link is the GitHub rel=next URL", () => {
  assert.equal(
    nextLink('<https://api.github.com/repos/a/b/issues/1/comments?page=2>; rel="next", <https://api.github.com/x>; rel="last"'),
    "https://api.github.com/repos/a/b/issues/1/comments?page=2",
  );
  assert.equal(nextLink('<http://example>; rel="next"'), undefined);
  assert.equal(nextLink(null), undefined);
});

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

test("syncComment creates, then updates the same comment, and skips when it is unchanged", async () => {
  const report = formatMarkdown([finding], []);
  const directory = ".";
  const calls: { url: string; method: string; body?: string; authorization?: string }[] = [];
  let listed: { id: number; body: string }[] = [{ id: 1, body: "not ours" }];

  const fetch = async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      authorization: headers?.Authorization,
    });
    if ((init?.method ?? "GET") === "GET") return response(200, listed);
    const payload = JSON.parse(String(init?.body)) as { body: string };
    listed = [{ id: 42, body: payload.body }];
    return response(200, { id: 42 });
  };

  const created = await syncComment({
    fetch,
    apiUrl: "https://api.github.com/",
    token: "super-secret-token",
    owner: "raframil",
    repo: "uninvent",
    eventName: "pull_request",
    event: pullRequest(),
    commentEnabled: true,
    report,
    workingDirectory: directory,
  });
  assert.equal(created.action, "create");
  assert.equal(created.commentId, 42);
  assert.equal(calls[0]?.method, "GET");
  assert.match(calls[0]?.url ?? "", /\/repos\/raframil\/uninvent\/issues\/12\/comments\?per_page=100$/);
  assert.equal(calls[1]?.method, "POST");
  assert.match(calls[1]?.url ?? "", /\/issues\/12\/comments$/);
  assert.equal(calls[1]?.authorization, "Bearer super-secret-token");
  const posted = JSON.parse(calls[1]?.body ?? "{}") as { body: string };
  assert.ok(posted.body.startsWith(`${commentMarker(".")}\n`));
  assert.match(posted.body, /raw `<button>`/);
  assert.equal(posted.body.includes("super-secret-token"), false);

  calls.length = 0;
  const updatedReport = formatMarkdown([], [reuse]);
  const updated = await syncComment({
    fetch,
    apiUrl: "https://api.github.com",
    token: "super-secret-token",
    owner: "raframil",
    repo: "uninvent",
    eventName: "pull_request",
    event: pullRequest(),
    commentEnabled: true,
    report: updatedReport,
    workingDirectory: directory,
  });
  assert.equal(updated.action, "update");
  assert.equal(calls[1]?.method, "PATCH");
  assert.match(calls[1]?.url ?? "", /\/issues\/comments\/42$/);
  assert.equal((calls[1]?.url ?? "").includes("/issues/12/comments/"), false);

  calls.length = 0;
  const again = await syncComment({
    fetch,
    apiUrl: "https://api.github.com",
    token: "super-secret-token",
    owner: "raframil",
    repo: "uninvent",
    eventName: "pull_request",
    event: pullRequest(),
    commentEnabled: true,
    report: updatedReport,
    workingDirectory: directory,
  });
  assert.equal(again.action, "skip");
  assert.equal(again.reason, "unchanged");
  assert.equal(again.commentId, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "GET");
});

test("syncComment follows pagination and refuses to create when the list is truncated", async () => {
  const marker = commentMarker("examples/demo-app");
  const calls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("page=2")) {
      return response(200, [{ id: 8, body: `${marker}\nold report\n` }]);
    }
    if ((init?.method ?? "GET") === "GET") {
      return response(200, [{ id: 1, body: "hello" }], {
        link: '<https://api.github.com/repos/raframil/uninvent/issues/12/comments?page=2>; rel="next"',
      });
    }
    return response(200, { id: 8 });
  };
  const updated = await syncComment({
    fetch,
    apiUrl: "https://api.github.com",
    token: "t",
    owner: "raframil",
    repo: "uninvent",
    eventName: "pull_request",
    event: pullRequest(),
    commentEnabled: true,
    report: CLEAN_REPORT,
    workingDirectory: "examples/demo-app",
  });
  assert.equal(updated.action, "update");
  assert.equal(updated.commentId, 8);
  assert.match(calls[2] ?? "", /^PATCH /);

  const truncated = await syncComment({
    fetch: async (url: string) => {
      assert.equal(url.includes("page=2"), false);
      return response(200, [{ id: 1, body: "no marker" }], {
        link: '<https://api.github.com/repos/raframil/uninvent/issues/12/comments?page=2>; rel="next"',
      });
    },
    apiUrl: "https://api.github.com",
    token: "t",
    owner: "raframil",
    repo: "uninvent",
    eventName: "pull_request",
    event: pullRequest(),
    commentEnabled: true,
    report: CLEAN_REPORT,
    workingDirectory: ".",
    maxPages: 1,
  });
  assert.equal(truncated.action, "skip");
  assert.equal(truncated.warn, true);
  assert.match(truncated.reason ?? "", /truncated/);
});

test("a 403 while commenting is a warning, not an exception", async () => {
  const denied = await syncComment({
    fetch: async () => response(403, { message: "Resource not accessible by integration" }),
    apiUrl: "https://api.github.com",
    token: "t",
    owner: "raframil",
    repo: "uninvent",
    eventName: "pull_request",
    event: pullRequest(),
    commentEnabled: true,
    report: CLEAN_REPORT,
    workingDirectory: ".",
  });
  assert.equal(denied.action, "skip");
  assert.equal(denied.warn, true);
  assert.match(denied.reason ?? "", /pull-requests: write/);

  const broken = await syncComment({
    fetch: async () => response(500, "nope"),
    apiUrl: "https://api.github.com",
    token: "t",
    owner: "raframil",
    repo: "uninvent",
    eventName: "pull_request",
    event: pullRequest(),
    commentEnabled: true,
    report: CLEAN_REPORT,
    workingDirectory: ".",
  });
  assert.equal(broken.action, "error");
  assert.match(broken.reason ?? "", /HTTP 500/);
});

test("a fork pull request does not call the comment API", async () => {
  let called = false;
  const result = await syncComment({
    fetch: async () => {
      called = true;
      return response(200, []);
    },
    apiUrl: "https://api.github.com",
    token: "t",
    owner: "raframil",
    repo: "uninvent",
    eventName: "pull_request",
    event: pullRequest("someone/uninvent"),
    commentEnabled: true,
    report: CLEAN_REPORT,
    workingDirectory: "examples/demo-app",
  });
  assert.equal(called, false);
  assert.equal(result.action, "skip");
  assert.equal(result.warn, true);
});

interface ExecCall {
  command: string;
  args: string[];
}

function harness(overrides: {
  workingDirectory?: string;
  base?: string;
  failOnFindings?: boolean;
  comment?: boolean;
  eventName?: string;
  event?: ReturnType<typeof pullRequest> | Record<string, never>;
  token?: string;
  scanStatus?: number;
  checkStatus?: number;
  checkStdout?: string;
  checkStderr?: string;
  basePresent?: boolean;
  fetchStatus?: number;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const calls: ExecCall[] = [];
  const logs: string[] = [];
  let summary = "";
  const exec = (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === "git" && args[0] === "rev-parse") {
      return { status: overrides.basePresent === false ? 1 : 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "fetch") {
      return {
        status: overrides.fetchStatus ?? 0,
        stdout: "",
        stderr: overrides.fetchStatus ? "fatal: could not fetch" : "",
      };
    }
    if (command === "uninvent" && args[0] === "scan") {
      return {
        status: overrides.scanStatus ?? 0,
        stdout: overrides.scanStatus ? "" : "16 components, catalog written\n",
        stderr: overrides.scanStatus ? "scan broke\n" : "",
      };
    }
    if (command === "uninvent" && args[0] === "check") {
      return {
        status: overrides.checkStatus ?? 0,
        stdout: overrides.checkStdout ?? CLEAN_REPORT,
        stderr: overrides.checkStderr ?? "",
      };
    }
    return { status: 1, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}` };
  };
  const run = () => execute({
    workspace: "/repo",
    workingDirectory: overrides.workingDirectory ?? "examples/demo-app",
    base: overrides.base ?? "",
    failOnFindings: overrides.failOnFindings ?? false,
    comment: overrides.comment ?? false,
    token: overrides.token ?? "super-secret-token",
    owner: "raframil",
    repo: "uninvent",
    apiUrl: "https://api.github.com",
    eventName: overrides.eventName ?? "pull_request",
    event: overrides.event ?? pullRequest(),
    exec,
    writeSummary: (text) => {
      summary = text;
    },
    log: (line) => logs.push(line),
    fetch: overrides.fetch ?? (async () => response(200, [])),
  });
  return {
    calls,
    logs,
    run,
    summary: () => summary,
  };
}

test("execute scans, checks the pull request base, and writes that report to the summary", async () => {
  const report = formatMarkdown([finding], [reuse]);
  const job = harness({ checkStatus: 1, checkStdout: report, comment: true });
  const result = await job.run();
  assert.equal(result.exitCode, 0);
  const check = job.calls.find((call) => call.command === "uninvent" && call.args[0] === "check");
  assert.deepEqual(check?.args, [
    "check",
    "--cwd",
    "/repo/examples/demo-app",
    "--base",
    "abc123def456",
    "--format",
    "markdown",
  ]);
  assert.match(job.summary(), /Directory `examples\/demo-app`/);
  assert.match(job.summary(), /\*\*reuse 1 \/ invent 1\*\*/);
  assert.equal(job.summary().includes("super-secret-token"), false);
  assert.match(job.logs.join("\n"), /uninvent comment: created/);
  assert.equal(job.logs.join("\n").includes("::error::"), false);
  assert.equal(job.calls.some((call) => call.args[0] === "fetch"), false);
});

test("fail-on-findings turns exit 1 into a failed job after the comment is posted", async () => {
  const report = formatMarkdown([finding], []);
  let posts = 0;
  const job = harness({
    checkStatus: 1,
    checkStdout: report,
    failOnFindings: true,
    comment: true,
    fetch: async (_url, init) => {
      if ((init?.method ?? "GET") !== "GET") posts += 1;
      return response(200, (init?.method ?? "GET") === "GET" ? [] : { id: 3 });
    },
  });
  const result = await job.run();
  assert.equal(result.exitCode, 1);
  assert.equal(posts, 1);
  assert.match(job.logs.join("\n"), /::error::/);
});

test("a hard check failure is not reported as a clean comment", async () => {
  let called = false;
  const job = harness({
    checkStatus: 2,
    checkStdout: "",
    checkStderr: "Not a git repository.",
    comment: true,
    fetch: async () => {
      called = true;
      return response(200, []);
    },
  });
  const result = await job.run();
  assert.equal(result.exitCode, 2);
  assert.equal(called, false);
  assert.match(job.summary(), /Not a git repository/);
  assert.equal(job.summary().includes("Nothing reinvented"), false);
  assert.equal(result.comment.action, "skip");
});

test("fork runs still write the summary and do not fail when they cannot comment", async () => {
  let called = false;
  const job = harness({
    comment: true,
    event: pullRequest("someone/uninvent"),
    fetch: async () => {
      called = true;
      return response(200, []);
    },
  });
  const result = await job.run();
  assert.equal(result.exitCode, 0);
  assert.equal(called, false);
  assert.match(job.summary(), /Nothing reinvented/);
  assert.match(job.logs.join("\n"), /::warning::/);
  assert.match(job.logs.join("\n"), /Fork pull request/);
  assert.equal(job.logs.join("\n").includes("super-secret-token"), false);
});

test("a comment API failure leaves the job green", async () => {
  const job = harness({
    comment: true,
    fetch: async () => {
      throw new Error("network down");
    },
  });
  const result = await job.run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.comment.action, "error");
  assert.match(job.logs.join("\n"), /network down/);
  assert.match(job.summary(), /Nothing reinvented/);
});

test("missing base, a failed fetch, and a failed scan fail before a clean comment", async () => {
  const missing = harness({ event: {}, eventName: "push", base: "" });
  await assert.rejects(() => missing.run(), /No base ref/);
  assert.match(missing.summary(), /No base ref/);

  const fetched = harness({ basePresent: false, fetchStatus: 128, base: "abc123def456" });
  await assert.rejects(() => fetched.run(), /Could not fetch base ref/);
  assert.equal(fetched.calls.some((call) => call.command === "uninvent"), false);
  assert.deepEqual(
    fetched.calls.find((call) => call.args[0] === "fetch")?.args,
    ["fetch", "--no-tags", "origin", "abc123def456"],
  );

  const present = harness({ base: "origin/main" });
  await present.run();
  assert.equal(present.calls.some((call) => call.args[0] === "fetch"), false);
  const check = present.calls.find((call) => call.args[0] === "check");
  assert.equal(check?.args[4], "origin/main");

  const scan = harness({ scanStatus: 2, basePresent: false });
  await assert.rejects(() => scan.run(), /uninvent scan failed/);
  assert.match(scan.summary(), /scan broke/);
  assert.equal(scan.calls.some((call) => call.args[0] === "check"), false);
});

test("contextFromEnv maps the workflow environment", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "uninvent-event-"));
  const eventPath = path.join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(pullRequest()));
  const ctx = contextFromEnv({
    GITHUB_REPOSITORY: "raframil/uninvent",
    GITHUB_WORKSPACE: "/repo",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventPath,
    FAIL_ON_FINDINGS: "true",
    COMMENT: "false",
    WORKING_DIRECTORY: "examples/demo-app",
    BASE: "",
    GITHUB_TOKEN: "t",
    GITHUB_API_URL: "https://example.test/api",
  });
  assert.equal(ctx.owner, "raframil");
  assert.equal(ctx.repo, "uninvent");
  assert.equal(ctx.failOnFindings, true);
  assert.equal(ctx.comment, false);
  assert.equal(ctx.workingDirectory, "examples/demo-app");
  assert.equal(ctx.apiUrl, "https://example.test/api");
  assert.equal(ctx.event.pull_request.number, 12);
  assert.throws(() => contextFromEnv({ GITHUB_EVENT_PATH: path.join(dir, "missing.json") }), /GITHUB_EVENT_PATH/);
});

test("action.yml and the dogfood workflow agree on the contract", () => {
  const action = readFileSync(path.join(root, "action.yml"), "utf8");
  const workflow = readFileSync(path.join(root, ".github/workflows/uninvent.yml"), "utf8");
  for (const name of ["working-directory", "version", "fail-on-findings", "comment", "token", "base"]) {
    assert.match(action, new RegExp(`^  ${name}:`, "m"));
  }
  assert.match(action, /fail-on-findings:[\s\S]*?default: "false"/);
  assert.match(action, /comment:[\s\S]*?default: "true"/);
  assert.match(action, /github\.token/);
  assert.match(action, /using: composite/);
  assert.match(workflow, /working-directory: examples\/demo-app/);
  assert.match(workflow, /version: local/);
  assert.match(workflow, /uses: \.\//);
  assert.match(workflow, /pull-requests: write/);
  assert.equal(workflow.includes("pull_request_target"), false);
  assert.match(workflow, /fetch-depth: 0/);

  for (const file of ["action/run.mjs", "action/comment.mjs", "action/github.mjs", "action/version.mjs"]) {
    const checked = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  }
  const bash = spawnSync("bash", ["-n", path.join(root, "action/install.sh")], { encoding: "utf8" });
  assert.equal(bash.status, 0, bash.stderr);
  const cli = spawnSync(process.execPath, [path.join(root, "action/version.mjs"), "latest", root], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout, "npm latest\n");
  const rejected = spawnSync(process.execPath, [path.join(root, "action/version.mjs"), "file:../x", root], { encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Invalid uninvent version/);
});
