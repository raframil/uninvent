import path from "node:path";

/** Hidden marker so a later push edits the same comment. One directory, one comment. */
export function commentMarker(workingDirectory) {
  return `<!-- uninvent-report ${normalizeDir(workingDirectory)} -->`;
}

const COMMENT_MAX = 65_000;

export class ActionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ActionError";
  }
}

/**
 * Relative directory used in the marker and, when it is not `.`, in the report.
 * Rejects `..`, comment delimiters, and whitespace so the marker cannot be split.
 * @param {string | undefined | null} input
 */
export function normalizeDir(input) {
  const raw = String(input ?? ".").trim() || ".";
  const posix = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const dir = posix === "" ? "." : posix;
  if (
    dir !== "." &&
    (dir.startsWith("/") ||
      dir.split("/").includes("..") ||
      dir.includes("--") ||
      /[\r\n<>]/.test(dir))
  ) {
    throw new ActionError(`working-directory "${input}" cannot be used in the comment marker.`);
  }
  return dir;
}

/**
 * @param {string} workspace
 * @param {string | undefined} input
 */
export function resolveWorkingDirectory(workspace, input) {
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, input || ".");
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ActionError("working-directory must stay inside the repository.");
  }
  return resolved;
}

/**
 * Project path relative to the repository, posix, for the marker and the report line.
 * @param {string} workspace
 * @param {string | undefined} input
 */
export function displayDirectory(workspace, input) {
  const root = path.resolve(workspace);
  const resolved = resolveWorkingDirectory(root, input);
  const relative = path.relative(root, resolved);
  if (!relative) return ".";
  return normalizeDir(relative.split(path.sep).join("/"));
}

export const CLEAN_REPORT = "## uninvent\n\n**reuse 0 / invent 0**\n\nNothing reinvented.\n";

/**
 * Markdown from `uninvent check --format markdown`. Empty stdout on a clean exit
 * still becomes the short clean report, never a blank comment.
 * @param {string | undefined | null} stdout
 */
export function reportOrClean(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return CLEAN_REPORT;
  return `${trimmed}\n`;
}

/**
 * @param {{ status: number | null, stdout?: string, stderr?: string }} check
 * @returns {{ ok: true, report: string } | { ok: false, detail: string }}
 */
export function reportFromCheck(check) {
  const stdout = String(check.stdout ?? "");
  const stderr = String(check.stderr ?? "").trim();
  if (check.status === 0) return { ok: true, report: reportOrClean(stdout) };
  if (check.status === 1) {
    if (stdout.trim()) return { ok: true, report: reportOrClean(stdout) };
    return {
      ok: false,
      detail: stderr || "uninvent check reported findings but printed no report.",
    };
  }
  const detail = (stderr || stdout.trim() || "uninvent check failed.").trim();
  return { ok: false, detail };
}

/**
 * The comment and the job summary show this text. A subdirectory is named so
 * two packages in a monorepo do not look like the same report.
 * @param {string} report
 * @param {string} workingDirectory already normalized (`.` or a relative path)
 */
export function withDirectory(report, workingDirectory) {
  const text = String(report ?? "").trim();
  const dir = normalizeDir(workingDirectory);
  const body = text || CLEAN_REPORT.trim();
  if (dir === ".") return `${body}\n`;
  const lines = body.split("\n");
  const note = `Directory \`${dir}\``;
  if (lines[0] === "## uninvent") {
    const rest = lines.slice(1).join("\n").replace(/^\n/, "");
    return `## uninvent\n\n${note}\n\n${rest}`.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
  }
  return `${note}\n\n${body}\n`;
}

/**
 * @param {string} report CLI markdown, without the marker
 * @param {string} workingDirectory
 */
export function renderComment(report, workingDirectory) {
  const visible = withDirectory(report, workingDirectory);
  return limitBody(`${commentMarker(workingDirectory)}\n${visible}`);
}

/**
 * @param {string} body
 * @param {number} [max]
 */
export function limitBody(body, max = COMMENT_MAX) {
  if (body.length <= max) return body;
  const note = "\n\n_Report truncated to fit a GitHub comment._\n";
  const room = Math.max(0, max - note.length);
  return body.slice(0, room) + note;
}

/**
 * @param {string} left
 * @param {string} right
 */
export function sameBody(left, right) {
  return left.replace(/\r\n/g, "\n").trim() === right.replace(/\r\n/g, "\n").trim();
}

/**
 * @param {{ id?: number, body?: string }[]} comments
 * @param {string} marker
 * @returns {{ id: number, body: string }[]}
 */
export function findStickyComments(comments, marker) {
  const found = [];
  for (const comment of comments) {
    if (!comment || typeof comment.id !== "number" || typeof comment.body !== "string") continue;
    if (comment.body.includes(marker)) found.push({ id: comment.id, body: comment.body });
  }
  return found;
}

/**
 * Decide whether to create, update, or leave the sticky comment.
 * @param {{
 *   comments: { id?: number, body?: string }[],
 *   report: string,
 *   workingDirectory: string,
 *   commentEnabled: boolean,
 * }} input
 */
export function planComment(input) {
  const body = renderComment(input.report, input.workingDirectory);
  if (!input.commentEnabled) {
    return { action: "skip", body, reason: "comment is false", duplicates: 0 };
  }
  const matches = findStickyComments(input.comments ?? [], commentMarker(input.workingDirectory));
  const existing = matches[0];
  const duplicates = Math.max(0, matches.length - 1);
  if (!existing) return { action: "create", body, duplicates };
  if (sameBody(existing.body, body)) {
    return { action: "skip", body, commentId: existing.id, reason: "unchanged", duplicates };
  }
  return {
    action: "update",
    body,
    commentId: existing.id,
    duplicates,
    reason: duplicates > 0 ? `${duplicates} duplicate sticky comment(s) left in place` : undefined,
  };
}

/**
 * @param {string | undefined | null} value
 * @param {boolean} fallback
 */
export function parseBool(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw new ActionError(`Expected true or false, got "${value}".`);
}

/**
 * @param {string} ref
 */
export function assertSafeRef(ref) {
  if (typeof ref !== "string" || ref === "" || ref.startsWith("-") || /[\r\n\0\s]/.test(ref) || ref.includes("..")) {
    throw new ActionError("base ref must be a plain git revision.");
  }
  return ref;
}

/**
 * Explicit input wins. Otherwise the pull request base SHA.
 * @param {string | undefined} inputBase
 * @param {{ pull_request?: { base?: { sha?: string } } } | undefined} event
 */
export function resolveBase(inputBase, event) {
  const requested = String(inputBase ?? "").trim();
  if (requested) return assertSafeRef(requested);
  const sha = event?.pull_request?.base?.sha;
  if (typeof sha === "string" && sha.trim()) return assertSafeRef(sha.trim());
  return undefined;
}

/**
 * @param {string} base
 * @returns {string[]}
 */
export function gitFetchArgs(base) {
  const ref = assertSafeRef(base);
  const remote = /^origin\/(.+)$/.exec(ref);
  if (remote) {
    const branch = remote[1] ?? "";
    if (!branch || branch.startsWith("-")) throw new ActionError("base ref must be a plain git revision.");
    return ["fetch", "--no-tags", "origin", branch];
  }
  return ["fetch", "--no-tags", "origin", ref];
}

/**
 * Whether this event can post with the default token.
 * Fork `pull_request` runs are read-only: skip the comment.
 * `pull_request_target` can write, and scanning a fork checkout from that event is unsafe.
 * The action still does not check out code. The warning is the caveat.
 * @param {{
 *   eventName?: string,
 *   event?: { pull_request?: { number?: number, head?: { repo?: { full_name?: string | null } | null }, base?: { repo?: { full_name?: string | null } | null } } },
 *   commentEnabled: boolean,
 *   token?: string,
 * }} input
 */
export function commentGate(input) {
  if (!input.commentEnabled) return { post: false, warn: false, reason: "comment is false" };
  const eventName = input.eventName ?? "";
  const pull = input.event?.pull_request;
  const issueNumber = typeof pull?.number === "number" ? pull.number : undefined;
  const isPull = eventName === "pull_request" || eventName === "pull_request_target";
  if (!isPull || !issueNumber) return { post: false, warn: false, reason: "not a pull request" };
  if (!input.token) {
    return { post: false, warn: true, reason: "missing token; the report is in the job summary" };
  }
  const head = pull?.head?.repo?.full_name ?? "";
  const baseRepo = pull?.base?.repo?.full_name ?? "";
  const fork = !head || (Boolean(baseRepo) && head !== baseRepo);
  if (fork && eventName !== "pull_request_target") {
    return {
      post: false,
      warn: true,
      reason:
        "Fork pull request: the default GITHUB_TOKEN cannot comment, so the sticky comment was skipped. The report is in the job summary. pull_request_target would have a write token, but it must not scan untrusted fork code.",
    };
  }
  if (fork && eventName === "pull_request_target") {
    return {
      post: true,
      warn: true,
      issueNumber,
      reason:
        "pull_request_target on a fork has a write token. This action scanned the current checkout. Do not check out untrusted pull request code with that event.",
    };
  }
  return { post: true, warn: false, issueNumber };
}

/**
 * @param {number | null | undefined} checkStatus
 * @param {boolean} failOnFindings
 */
export function exitCodeForCheck({ checkStatus, failOnFindings }) {
  if (checkStatus === 0) return 0;
  if (checkStatus === 1) return failOnFindings ? 1 : 0;
  if (checkStatus === null || checkStatus === undefined) return 1;
  return checkStatus;
}

/**
 * @param {string} detail
 */
export function failureSummary(detail) {
  const text = detail.trim();
  if (text.includes("\n")) return `## uninvent\n\n\`\`\`\n${text}\n\`\`\`\n`;
  return `## uninvent\n\n${text}\n`;
}

/**
 * @param {string} text
 */
export function formatSummary(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * @param {string} command
 * @param {string} message
 */
export function workflowCommand(command, message) {
  const escaped = String(message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::${command}::${escaped}`;
}

/**
 * @param {{ action: string, commentId?: number, reason?: string }} result
 */
export function commentLog(result) {
  if (result.action === "create") {
    return `uninvent comment: created${result.commentId ? ` #${result.commentId}` : ""}`;
  }
  if (result.action === "update") return `uninvent comment: updated #${result.commentId}`;
  if (result.action === "error") return `uninvent comment: ${result.reason}`;
  if (result.reason === "unchanged") return `uninvent comment: unchanged #${result.commentId}`;
  return `uninvent comment: skipped (${result.reason})`;
}
