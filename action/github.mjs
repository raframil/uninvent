import { commentGate, commentMarker, findStickyComments, planComment } from "./comment.mjs";

/**
 * @param {string} token
 */
function apiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "uninvent-action",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * @param {string | null | undefined} header
 */
export function nextLink(header) {
  if (!header) return undefined;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  const url = match?.[1];
  if (!url || !/^https:\/\//.test(url)) return undefined;
  return url;
}

/**
 * @param {string} apiUrl
 * @param {string} owner
 * @param {string} repo
 */
function repoRoot(apiUrl, owner, repo) {
  const root = apiUrl.replace(/\/+$/, "");
  return `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * @param {number} status
 * @param {string} [body]
 */
export function permissionReason(status, body) {
  const detail = typeof body === "string" ? body.slice(0, 200).replace(/\s+/g, " ").trim() : "";
  const suffix = detail ? ` ${detail}` : "";
  return `GitHub returned HTTP ${status} for the pull request comment.${suffix} Grant pull-requests: write on the workflow token. The report is in the job summary.`;
}

/**
 * @param {{
 *   fetch: (url: string, init?: RequestInit) => Promise<Response>,
 *   apiUrl: string,
 *   token: string,
 *   owner: string,
 *   repo: string,
 *   issueNumber: number,
 *   maxPages?: number,
 * }} options
 */
export async function listIssueComments(options) {
  const maxPages = options.maxPages ?? 20;
  const comments = [];
  let url = `${repoRoot(options.apiUrl, options.owner, options.repo)}/issues/${options.issueNumber}/comments?per_page=100`;
  let pages = 0;
  while (url) {
    if (pages >= maxPages) return { ok: true, comments, truncated: true };
    pages += 1;
    const response = await options.fetch(url, { headers: apiHeaders(options.token) });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, error: text, comments };
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, status: response.status, error: "response was not JSON", comments };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, status: response.status, error: "response was not a comment list", comments };
    }
    for (const comment of parsed) {
      comments.push({ id: comment.id, body: comment.body });
    }
    url = nextLink(response.headers.get("link"));
  }
  return { ok: true, comments, truncated: false };
}

/**
 * Create or update the one sticky comment. Permission failures are skips, not throws.
 * Network failures reject so the caller can warn without failing the job.
 * @param {{
 *   fetch: (url: string, init?: RequestInit) => Promise<Response>,
 *   apiUrl: string,
 *   token?: string,
 *   owner?: string,
 *   repo?: string,
 *   eventName?: string,
 *   event?: object,
 *   commentEnabled: boolean,
 *   report: string,
 *   workingDirectory: string,
 *   maxPages?: number,
 * }} options
 */
export async function syncComment(options) {
  const gate = commentGate(options);
  if (!gate.post) return { action: "skip", reason: gate.reason, warn: gate.warn };
  if (!options.owner || !options.repo) {
    return { action: "error", reason: "GITHUB_REPOSITORY is missing", warn: true };
  }
  const listed = await listIssueComments({
    fetch: options.fetch,
    apiUrl: options.apiUrl,
    token: options.token ?? "",
    owner: options.owner,
    repo: options.repo,
    issueNumber: gate.issueNumber,
    maxPages: options.maxPages,
  });
  if (!listed.ok) {
    if (listed.status === 401 || listed.status === 403) {
      return { action: "skip", reason: permissionReason(listed.status, listed.error), warn: true };
    }
    return { action: "error", reason: `listing comments failed: HTTP ${listed.status}`, warn: true };
  }
  if (listed.truncated && findStickyComments(listed.comments, commentMarker(options.workingDirectory)).length === 0) {
    return {
      action: "skip",
      reason: "comment list was truncated before an existing sticky comment could be ruled out, so a new comment was not created",
      warn: true,
    };
  }
  const plan = planComment({
    comments: listed.comments,
    report: options.report,
    workingDirectory: options.workingDirectory,
    commentEnabled: true,
  });
  if (plan.action === "skip") {
    return {
      action: "skip",
      reason: plan.reason ?? "unchanged",
      commentId: plan.commentId,
      warn: (plan.duplicates ?? 0) > 0,
      duplicates: plan.duplicates,
    };
  }
  const sent = await sendComment(options, plan, gate.issueNumber);
  if (!sent.ok) {
    if (sent.status === 401 || sent.status === 403) {
      return { action: "skip", reason: permissionReason(sent.status, sent.error), warn: true };
    }
    return { action: "error", reason: `comment ${plan.action} failed: HTTP ${sent.status}`, warn: true };
  }
  const reason = [gate.reason, plan.reason].filter(Boolean).join(" ");
  return {
    action: plan.action,
    commentId: sent.commentId ?? plan.commentId,
    warn: Boolean(gate.warn) || (plan.duplicates ?? 0) > 0,
    reason: reason || undefined,
    duplicates: plan.duplicates,
  };
}

/**
 * @param {{ fetch: Function, apiUrl: string, token?: string, owner: string, repo: string }} options
 * @param {{ action: string, body: string, commentId?: number }} plan
 * @param {number} issueNumber
 */
async function sendComment(options, plan, issueNumber) {
  const root = repoRoot(options.apiUrl, options.owner, options.repo);
  const url = plan.action === "create"
    ? `${root}/issues/${issueNumber}/comments`
    : `${root}/issues/comments/${plan.commentId}`;
  const response = await options.fetch(url, {
    method: plan.action === "create" ? "POST" : "PATCH",
    headers: { ...apiHeaders(options.token ?? ""), "Content-Type": "application/json" },
    body: JSON.stringify({ body: plan.body }),
  });
  const text = await response.text();
  if (!response.ok) return { ok: false, status: response.status, error: text };
  try {
    const parsed = JSON.parse(text);
    const commentId = typeof parsed.id === "number" ? parsed.id : plan.commentId;
    return { ok: true, commentId };
  } catch {
    return { ok: true, commentId: plan.commentId };
  }
}
