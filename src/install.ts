import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { UserError } from "./errors.js";
import { toPosix } from "./paths.js";

export type InstallTarget = "claude-code" | "cursor";

const CLAUDE_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
const CURSOR_MATCHER = "Write|StrReplace|EditNotebook|ApplyPatch";

export function resolveHookCommand(projectRoot: string): string {
  let dir = path.resolve(projectRoot);
  for (let depth = 0; depth < 5; depth += 1) {
    const bin = path.join(dir, "node_modules", ".bin", "uninvent");
    if (existsSync(bin)) {
      const relative = toPosix(path.relative(projectRoot, bin)) || "uninvent";
      return `${relative} hook`;
    }
    const cli = path.join(dir, "dist", "cli.js");
    if (existsSync(cli) && packageName(path.join(dir, "package.json")) === "uninvent") {
      const relative = toPosix(path.relative(projectRoot, cli));
      return `node ${relative} hook`;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "npx --no-install uninvent hook";
}

function packageName(file: string): string | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

function isOurHook(command: string): boolean {
  return command.includes("uninvent hook") || command.endsWith("dist/cli.js hook");
}

export function installHooks(root: string, targets: InstallTarget[], pre: boolean): string[] {
  const command = resolveHookCommand(root);
  const lines: string[] = [];
  for (const target of targets) {
    if (target === "claude-code") lines.push(installClaude(root, command, pre));
    else lines.push(installCursor(root, command, pre));
  }
  return lines;
}

export function parseInstallTarget(value: string): InstallTarget {
  if (value === "cursor") return "cursor";
  if (value === "claude" || value === "claude-code") return "claude-code";
  throw new UserError(`Unknown install target "${value}". Use claude-code or cursor.`);
}

export function mergeClaudeSettings(existing: unknown, command: string, pre: boolean): Record<string, unknown> {
  const root = isRecord(existing) ? { ...existing } : {};
  const hooks = isRecord(root.hooks) ? { ...root.hooks } : {};
  hooks.PostToolUse = upsertClaude(hooks.PostToolUse, CLAUDE_MATCHER, command);
  if (pre) hooks.PreToolUse = upsertClaude(hooks.PreToolUse, CLAUDE_MATCHER, command);
  root.hooks = hooks;
  return root;
}

export function mergeCursorHooks(existing: unknown, command: string, pre: boolean): Record<string, unknown> {
  const root = isRecord(existing) ? { ...existing } : {};
  if (typeof root.version !== "number") root.version = 1;
  const hooks = isRecord(root.hooks) ? { ...root.hooks } : {};
  hooks.postToolUse = upsertCursor(hooks.postToolUse, CURSOR_MATCHER, command);
  if (pre) hooks.preToolUse = upsertCursor(hooks.preToolUse, CURSOR_MATCHER, command);
  root.hooks = hooks;
  return root;
}

function installClaude(root: string, command: string, pre: boolean): string {
  const relative = ".claude/settings.json";
  const file = path.join(root, relative);
  const current = readJson(file);
  const next = mergeClaudeSettings(current, command, pre);
  writeJson(file, next);
  return pre
    ? `Claude Code: PostToolUse and PreToolUse hooks in ${relative}`
    : `Claude Code: PostToolUse hook in ${relative}`;
}

function installCursor(root: string, command: string, pre: boolean): string {
  const relative = ".cursor/hooks.json";
  const file = path.join(root, relative);
  const current = readJson(file);
  const next = mergeCursorHooks(current, command, pre);
  writeJson(file, next);
  return pre
    ? `Cursor: postToolUse and preToolUse hooks in ${relative}`
    : `Cursor: postToolUse hook in ${relative}`;
}

function upsertClaude(existing: unknown, matcher: string, command: string): unknown[] {
  const groups = Array.isArray(existing) ? existing.map((group) => clone(group)) : [];
  if (replaceCommand(groups, command)) return groups;
  groups.push({
    matcher,
    hooks: [{ type: "command", command, timeout: 15 }],
  });
  return groups;
}

function upsertCursor(existing: unknown, matcher: string, command: string): unknown[] {
  const entries = Array.isArray(existing) ? existing.map((entry) => clone(entry)) : [];
  let found = false;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.command !== "string") continue;
    if (!isOurHook(entry.command)) continue;
    entry.command = command;
    if (typeof entry.timeout !== "number") entry.timeout = 15;
    found = true;
  }
  if (!found) entries.push({ command, matcher, timeout: 15 });
  return entries;
}

function replaceCommand(groups: unknown[], command: string): boolean {
  let found = false;
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    for (const hook of group.hooks) {
      if (!isRecord(hook) || typeof hook.command !== "string") continue;
      if (!isOurHook(hook.command)) continue;
      hook.command = command;
      hook.type = "command";
      if (typeof hook.timeout !== "number") hook.timeout = 15;
      found = true;
    }
  }
  return found;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    throw new UserError(`Could not parse ${file}. Merge the uninvent hook in by hand so the existing file stays intact.`);
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
