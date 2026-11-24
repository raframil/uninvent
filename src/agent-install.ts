import { chmodSync, existsSync, mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCatalog } from "./catalog.js";
import { loadConfig } from "./config.js";
import { UserError } from "./errors.js";
import { installHooks, isOurHook, parseInstallTarget, resolveHookCommand, uninstallHooks } from "./install.js";
import {
  BLOCK_START,
  GENERATED_MARK,
  renderAgentsBlock,
  stripMarked,
  upsertMarked,
  writeAgentsBlock,
  writeGeneratedSkill,
} from "./skill.js";
import type { Catalog } from "./types.js";

export const AGENT_IDS = ["claude-code", "cursor", "codex", "copilot", "windsurf", "cline", "agents"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

const CODEX_MATCHER = "apply_patch|Edit|Write";
const COPILOT_MATCHER = "create|edit|apply_patch|str_replace_editor";
const DEVIN_MATCHER = "^(edit|write|apply_patch|notebook_edit)$";
const HOOK_MARK = "# uninvent:hook";
const SKILL_RELATIVE = ".agents/skills/uninvent/SKILL.md";

export function parseAgent(value: string): AgentId {
  const name = value.trim().toLowerCase();
  if (name === "claude" || name === "claude-code") return parseInstallTarget(name);
  if (name === "cursor") return "cursor";
  if (name === "codex" || name === "openai-codex") return "codex";
  if (name === "copilot" || name === "github-copilot") return "copilot";
  if (name === "windsurf") return "windsurf";
  if (name === "cline") return "cline";
  if (name === "agents" || name === "agents.md" || name === "generic") return "agents";
  throw new UserError(`Unknown agent "${value}". Use claude-code, cursor, codex, copilot, windsurf, cline, or agents.`);
}

/** Project markers that mean this agent is already in use. Claude Code and Cursor are not inferred. */
export function detectAgents(root: string): AgentId[] {
  const found: AgentId[] = [];
  if (isDir(path.join(root, ".codex"))) found.push("codex");
  if (
    existsSync(path.join(root, ".github", "copilot-instructions.md")) ||
    isDir(path.join(root, ".github", "hooks")) ||
    isDir(path.join(root, ".github", "instructions"))
  ) {
    found.push("copilot");
  }
  if (isDir(path.join(root, ".windsurf")) || existsSync(path.join(root, ".windsurfrules")) || isDir(path.join(root, ".devin"))) {
    found.push("windsurf");
  }
  if (existsSync(path.join(root, ".clinerules")) || isDir(path.join(root, ".cline"))) found.push("cline");
  return found;
}

export function resolveAgents(names: string[], root: string): AgentId[] {
  if (names.length === 0) return dedupe(["claude-code", "cursor", ...detectAgents(root)]);
  return dedupe(names.map(parseAgent));
}

export function installAgents(root: string, agents: AgentId[], pre: boolean): string[] {
  const command = resolveHookCommand(root);
  const catalog = agents.some((agent) => agent !== "claude-code" && agent !== "cursor") ? loadCatalog(root) : null;
  const lines: string[] = [];
  for (const agent of agents) {
    if (agent === "claude-code" || agent === "cursor") {
      lines.push(...installHooks(root, [agent], pre));
      continue;
    }
    lines.push(...installOne(root, agent, command, catalog ?? emptyCatalog(), pre));
  }
  return lines;
}

export function uninstallAgents(root: string, agents: AgentId[]): string[] {
  const lines: string[] = [];
  for (const agent of agents) {
    if (agent === "claude-code" || agent === "cursor") {
      lines.push(...uninstallHooks(root, [agent]));
      continue;
    }
    lines.push(...uninstallOne(root, agent));
  }
  return lines;
}

function installOne(root: string, agent: AgentId, command: string, catalog: Catalog, pre: boolean): string[] {
  if (agent === "codex") return installCodex(root, command, catalog, pre);
  if (agent === "copilot") return installCopilot(root, command, catalog, pre);
  if (agent === "windsurf") return installWindsurf(root, command, catalog, pre);
  if (agent === "cline") return installCline(root, command, catalog, pre);
  writeAgentsBlock(root, catalog);
  return ["AGENTS.md: instructions only. The AGENTS.md format has no hook."];
}

function uninstallOne(root: string, agent: AgentId): string[] {
  if (agent === "codex") return uninstallCodex(root);
  if (agent === "copilot") return uninstallCopilot(root);
  if (agent === "windsurf") return uninstallWindsurf(root);
  if (agent === "cline") return uninstallCline(root);
  return [stripAgents(root)];
}

function installCodex(root: string, command: string, catalog: Catalog, pre: boolean): string[] {
  writeAgentsBlock(root, catalog);
  writeGeneratedSkill(root, SKILL_RELATIVE, catalog);
  const relative = ".codex/hooks.json";
  const file = path.join(root, relative);
  const next = mergeGrouped(readJson(file), "PostToolUse", CODEX_MATCHER, command, false);
  if (pre) {
    const withPre = mergeGrouped(next, "PreToolUse", CODEX_MATCHER, command, false);
    writeJson(file, withPre);
  } else {
    writeJson(file, next);
  }
  const hook = pre
    ? `PostToolUse and PreToolUse hooks in ${relative}`
    : `PostToolUse hook in ${relative}`;
  return [
    `Codex: AGENTS.md, ${SKILL_RELATIVE}, ${hook}. notify is not installed: Codex ignores it in project config, and it runs on agent-turn-complete rather than after an edit. Trust the hook with /hooks.`,
  ];
}

function uninstallCodex(root: string): string[] {
  const lines = [stripAgents(root)];
  if (removeGenerated(path.join(root, SKILL_RELATIVE))) lines.push(`Removed ${SKILL_RELATIVE}`);
  lines.push(removeGroupedHook(root, ".codex/hooks.json", ["PostToolUse", "PreToolUse"], "Codex"));
  return lines;
}

function installCopilot(root: string, command: string, catalog: Catalog, pre: boolean): string[] {
  const instructions = ".github/copilot-instructions.md";
  writeMarked(path.join(root, instructions), renderAgentsBlock(catalog));
  writeAgentsBlock(root, catalog);
  const relative = ".github/hooks/uninvent.json";
  const file = path.join(root, relative);
  const current = readJson(file);
  const next = isRecord(current) ? { ...current } : {};
  if (typeof next.version !== "number") next.version = 1;
  const hooks = isRecord(next.hooks) ? { ...next.hooks } : {};
  hooks.postToolUse = upsertCopilot(hooks.postToolUse, command);
  if (pre) hooks.preToolUse = upsertCopilot(hooks.preToolUse, command);
  next.hooks = hooks;
  writeJson(file, next);
  const hook = pre
    ? `postToolUse and preToolUse hooks in ${relative}`
    : `postToolUse hook in ${relative}`;
  const preNote = pre
    ? " preToolUse can deny a tool and has no additionalContext field, so that hook only allows the edit and puts the finding in permissionDecisionReason."
    : "";
  return [`Copilot: ${instructions}, AGENTS.md, ${hook}.${preNote}`];
}

function uninstallCopilot(root: string): string[] {
  return [
    stripMarkedFile(path.join(root, ".github/copilot-instructions.md"), "Copilot instructions"),
    stripAgents(root),
    removeCopilotHook(root),
  ];
}

function installWindsurf(root: string, command: string, catalog: Catalog, pre: boolean): string[] {
  const rule = ".windsurf/rules/uninvent.md";
  writeOwned(
    path.join(root, rule),
    [
      "---",
      'description: "Look up this project\'s design system before adding UI."',
      "trigger: model_decision",
      "---",
      "",
      "",
    ].join("\n"),
    renderAgentsBlock(catalog),
  );
  const cascade = ".windsurf/hooks.json";
  writeJson(path.join(root, cascade), mergeWindsurf(readJson(path.join(root, cascade)), command, pre));
  const devin = ".devin/hooks.v1.json";
  writeJson(path.join(root, devin), mergeDevin(readJson(path.join(root, devin)), command, pre));
  const extra = pre ? " pre_write_code and Devin PreToolUse are installed too and do not block." : "";
  return [
    `Windsurf: ${rule}, post_write_code in ${cascade}, PostToolUse in ${devin}.${extra} Cascade shows hook stdout when show_output is true. Devin Local injects additionalContext.`,
  ];
}

function uninstallWindsurf(root: string): string[] {
  return [
    removeOwned(path.join(root, ".windsurf/rules/uninvent.md"), "Windsurf rule"),
    removeWindsurfHook(root),
    removeDevinHook(root),
  ];
}

function installCline(root: string, command: string, catalog: Catalog, pre: boolean): string[] {
  const rule = writeClineRule(root, renderAgentsBlock(catalog));
  const hook = writeClineHook(root, clineHookDir(root), "PostToolUse", command);
  const lines = [
    `Cline: ${rule}, PostToolUse hook ${hook}. A clean edit prints {}. Enable hooks in Cline settings. The script is a Unix shebang; the extension docs say Windows hooks are not supported.`,
  ];
  if (pre) {
    const preHook = writeClineHook(root, clineHookDir(root), "PreToolUse", command);
    lines.push(`Cline: PreToolUse hook ${preHook}. cancel stays false.`);
  }
  return lines;
}

function uninstallCline(root: string): string[] {
  const lines = [removeClineRule(root)];
  for (const name of ["PostToolUse", "PreToolUse"]) {
    for (const relative of [`.clinerules/hooks/${name}`, `.cline/hooks/${name}`]) {
      if (removeHookScript(path.join(root, relative))) lines.push(`Removed ${relative}`);
    }
  }
  return lines;
}

function writeClineRule(root: string, block: string): string {
  const single = path.join(root, ".clinerules");
  if (existsSync(single) && statSync(single).isFile()) {
    writeMarked(single, block);
    return ".clinerules";
  }
  const relative = ".clinerules/uninvent.md";
  writeOwned(
    path.join(root, relative),
    ["---", "paths:", '  - "**/*.tsx"', '  - "**/*.jsx"', "---", "", ""].join("\n"),
    block,
  );
  return relative;
}

function removeClineRule(root: string): string {
  const single = path.join(root, ".clinerules");
  if (existsSync(single) && statSync(single).isFile()) return stripMarkedFile(single, "Cline rules");
  return removeOwned(path.join(root, ".clinerules/uninvent.md"), "Cline rules");
}

function clineHookDir(root: string): string {
  const single = path.join(root, ".clinerules");
  if (existsSync(single) && statSync(single).isFile()) return ".cline/hooks";
  return ".clinerules/hooks";
}

function writeClineHook(root: string, directory: string, name: string, command: string): string {
  const relative = `${directory}/${name}`;
  const file = path.join(root, relative);
  const body = `#!/usr/bin/env bash\n${HOOK_MARK}\nexec ${command}\n`;
  if (existsSync(file)) {
    const current = readFileSync(file, "utf8");
    if (!current.includes(HOOK_MARK)) return `${relative} (left unchanged)`;
    if (current === body) {
      chmodSync(file, 0o755);
      return relative;
    }
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return relative;
}

function removeHookScript(file: string): boolean {
  if (!existsSync(file)) return false;
  if (!readFileSync(file, "utf8").includes(HOOK_MARK)) return false;
  unlinkSync(file);
  removeEmptyParents(file);
  return true;
}

function mergeGrouped(existing: unknown, eventName: string, matcher: string, command: string, topLevel: boolean): Record<string, unknown> {
  const root = isRecord(existing) ? { ...existing } : {};
  const holder = topLevel ? root : isRecord(root.hooks) ? { ...root.hooks } : {};
  holder[eventName] = upsertGroup(holder[eventName], matcher, command);
  if (topLevel) return holder;
  root.hooks = holder;
  return root;
}

function upsertGroup(existing: unknown, matcher: string, command: string): unknown[] {
  const groups = Array.isArray(existing) ? existing.map((group) => structuredClone(group)) : [];
  let found = false;
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    let groupFound = false;
    for (const hook of group.hooks) {
      if (!isRecord(hook) || typeof hook.command !== "string" || !isOurHook(hook.command)) continue;
      hook.command = command;
      hook.type = "command";
      if (typeof hook.timeout !== "number") hook.timeout = 15;
      groupFound = true;
      found = true;
    }
    if (groupFound) group.matcher = matcher;
  }
  if (!found) groups.push({ matcher, hooks: [{ type: "command", command, timeout: 15 }] });
  return groups;
}

function removeGroupedHook(root: string, relative: string, events: string[], label: string): string {
  const file = path.join(root, relative);
  if (!existsSync(file)) return `${label}: no hook in ${relative}`;
  const current = readJson(file);
  if (!isRecord(current)) return `${label}: no hook in ${relative}`;
  const hooks = isRecord(current.hooks) ? { ...current.hooks } : null;
  if (!hooks) return `${label}: no hook in ${relative}`;
  for (const eventName of events) hooks[eventName] = dropGroups(hooks[eventName]);
  for (const eventName of events) {
    if (Array.isArray(hooks[eventName]) && hooks[eventName].length === 0) delete hooks[eventName];
  }
  if (Object.keys(hooks).length === 0) delete current.hooks;
  else current.hooks = hooks;
  writeJsonOrEmpty(file, current);
  return `${label}: removed uninvent hooks from ${relative}`;
}

function dropGroups(existing: unknown): unknown[] {
  const groups = Array.isArray(existing) ? existing.map((group) => structuredClone(group)) : [];
  const kept: unknown[] = [];
  for (const group of groups) {
    const list = isRecord(group) ? group.hooks : undefined;
    if (!isRecord(group) || !Array.isArray(list)) {
      kept.push(group);
      continue;
    }
    const hooks = list.filter((hook) => !(isRecord(hook) && typeof hook.command === "string" && isOurHook(hook.command)));
    group.hooks = hooks;
    if (hooks.length > 0) kept.push(group);
  }
  return kept;
}

function upsertCopilot(existing: unknown, command: string): unknown[] {
  const entries = Array.isArray(existing) ? existing.map((entry) => structuredClone(entry)) : [];
  let found = false;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const fields = [entry.command, entry.bash, entry.powershell];
    if (!fields.some((field) => typeof field === "string" && isOurHook(field))) continue;
    entry.type = "command";
    entry.command = command;
    delete entry.bash;
    delete entry.powershell;
    entry.matcher = COPILOT_MATCHER;
    if (typeof entry.timeoutSec !== "number") entry.timeoutSec = 15;
    found = true;
  }
  if (!found) entries.push({ type: "command", command, matcher: COPILOT_MATCHER, timeoutSec: 15 });
  return entries;
}

function removeCopilotHook(root: string): string {
  const relative = ".github/hooks/uninvent.json";
  const file = path.join(root, relative);
  if (!existsSync(file)) return `Copilot: no hook in ${relative}`;
  const current = readJson(file);
  if (!isRecord(current) || !isRecord(current.hooks)) return `Copilot: no hook in ${relative}`;
  const hooks = { ...current.hooks };
  for (const eventName of ["postToolUse", "preToolUse", "PostToolUse", "PreToolUse"]) {
    hooks[eventName] = dropCopilot(hooks[eventName]);
    if (Array.isArray(hooks[eventName]) && hooks[eventName].length === 0) delete hooks[eventName];
  }
  current.hooks = hooks;
  if (Object.keys(hooks).length === 0 && current.version === 1 && Object.keys(current).every((key) => key === "version" || key === "hooks")) {
    unlinkSync(file);
    removeEmptyParents(file);
    return `Copilot: removed ${relative}`;
  }
  writeJson(file, current);
  return `Copilot: removed uninvent hooks from ${relative}`;
}

function dropCopilot(existing: unknown): unknown[] {
  const entries = Array.isArray(existing) ? existing : [];
  return entries.filter((entry) => {
    if (!isRecord(entry)) return true;
    return ![entry.command, entry.bash, entry.powershell].some((field) => typeof field === "string" && isOurHook(field));
  });
}

function mergeWindsurf(existing: unknown, command: string, pre: boolean): Record<string, unknown> {
  const root = isRecord(existing) ? { ...existing } : {};
  const hooks = isRecord(root.hooks) ? { ...root.hooks } : {};
  hooks.post_write_code = upsertCommandList(hooks.post_write_code, command, { show_output: true });
  if (pre) hooks.pre_write_code = upsertCommandList(hooks.pre_write_code, command, { show_output: true });
  root.hooks = hooks;
  return root;
}

function mergeDevin(existing: unknown, command: string, pre: boolean): Record<string, unknown> {
  const withPost = mergeGrouped(existing, "PostToolUse", DEVIN_MATCHER, command, true);
  return pre ? mergeGrouped(withPost, "PreToolUse", DEVIN_MATCHER, command, true) : withPost;
}

function upsertCommandList(existing: unknown, command: string, extra: Record<string, unknown>): unknown[] {
  const entries = Array.isArray(existing) ? existing.map((entry) => structuredClone(entry)) : [];
  let found = false;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.command !== "string" || !isOurHook(entry.command)) continue;
    entry.command = command;
    for (const [key, value] of Object.entries(extra)) {
      if (entry[key] === undefined) entry[key] = value;
    }
    found = true;
  }
  if (!found) entries.push({ command, ...extra });
  return entries;
}

function removeWindsurfHook(root: string): string {
  const relative = ".windsurf/hooks.json";
  const file = path.join(root, relative);
  if (!existsSync(file)) return `Windsurf: no hook in ${relative}`;
  const current = readJson(file);
  if (!isRecord(current) || !isRecord(current.hooks)) return `Windsurf: no hook in ${relative}`;
  const hooks = { ...current.hooks };
  for (const eventName of ["post_write_code", "pre_write_code"]) {
    hooks[eventName] = dropCommands(hooks[eventName]);
    if (Array.isArray(hooks[eventName]) && hooks[eventName].length === 0) delete hooks[eventName];
  }
  if (Object.keys(hooks).length === 0) delete current.hooks;
  else current.hooks = hooks;
  writeJsonOrEmpty(file, current);
  return `Windsurf: removed uninvent hooks from ${relative}`;
}

function removeDevinHook(root: string): string {
  const relative = ".devin/hooks.v1.json";
  const file = path.join(root, relative);
  if (!existsSync(file)) return `Windsurf: no Devin Local hook in ${relative}`;
  const current = readJson(file);
  if (!isRecord(current)) return `Windsurf: no Devin Local hook in ${relative}`;
  for (const eventName of ["PostToolUse", "PreToolUse"]) {
    current[eventName] = dropGroups(current[eventName]);
    if (Array.isArray(current[eventName]) && current[eventName].length === 0) delete current[eventName];
  }
  writeJsonOrEmpty(file, current);
  return `Windsurf: removed uninvent hooks from ${relative}`;
}

function dropCommands(existing: unknown): unknown[] {
  const entries = Array.isArray(existing) ? existing : [];
  return entries.filter((entry) => !(isRecord(entry) && typeof entry.command === "string" && isOurHook(entry.command)));
}

function writeMarked(file: string, block: string): void {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const next = upsertMarked(current, block);
  if (next === current && existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next);
}

function writeOwned(file: string, prefix: string, block: string): void {
  const owned = `${prefix}${block}\n`;
  if (existsSync(file) && !readFileSync(file, "utf8").includes(BLOCK_START)) {
    writeMarked(file, block);
    return;
  }
  if (existsSync(file) && readFileSync(file, "utf8") === owned) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, owned);
}

function removeOwned(file: string, label: string): string {
  if (!existsSync(file)) return `${label}: nothing to remove`;
  const current = readFileSync(file, "utf8");
  if (!current.includes(BLOCK_START)) return `${label}: left unchanged`;
  const stripped = stripMarked(current);
  if (stripped.trim() === "" || isOnlyFrontmatter(stripped)) {
    unlinkSync(file);
    removeEmptyParents(file);
    return `${label}: removed ${path.basename(file)}`;
  }
  writeFileSync(file, stripped.endsWith("\n") ? stripped : `${stripped}\n`);
  return `${label}: removed the uninvent block`;
}

function stripMarkedFile(file: string, label: string): string {
  if (!existsSync(file)) return `${label}: nothing to remove`;
  const current = readFileSync(file, "utf8");
  if (!current.includes(BLOCK_START)) return `${label}: left unchanged`;
  const stripped = stripMarked(current);
  if (stripped.trim() === "") {
    unlinkSync(file);
    removeEmptyParents(file);
    return `${label}: removed ${path.basename(file)}`;
  }
  writeFileSync(file, stripped.endsWith("\n") ? stripped : `${stripped}\n`);
  return `${label}: removed the uninvent block`;
}

function stripAgents(root: string): string {
  return stripMarkedFile(path.join(root, "AGENTS.md"), "AGENTS.md");
}

function removeGenerated(file: string): boolean {
  if (!existsSync(file)) return false;
  if (!readFileSync(file, "utf8").includes(GENERATED_MARK)) return false;
  unlinkSync(file);
  removeEmptyParents(file);
  return true;
}

function loadCatalog(root: string): Catalog {
  const config = loadConfig(root);
  const file = path.join(root, config.catalog);
  if (!existsSync(file)) return emptyCatalog();
  return readCatalog(root, config.catalog);
}

function emptyCatalog(): Catalog {
  return { version: 1, generatedAt: "1970-01-01T00:00:00.000Z", paths: [], components: [], tokens: [] };
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
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(file) && readFileSync(file, "utf8") === text) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function writeJsonOrEmpty(file: string, value: Record<string, unknown>): void {
  if (Object.keys(value).length === 0) {
    unlinkSync(file);
    removeEmptyParents(file);
    return;
  }
  writeJson(file, value);
}

function removeEmptyParents(file: string): void {
  let dir = path.dirname(file);
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      rmdirSync(dir);
    } catch {
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function isOnlyFrontmatter(value: string): boolean {
  return /^---\n[\s\S]*?\n---\s*$/.test(value.trim());
}

function isDir(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function dedupe(agents: AgentId[]): AgentId[] {
  const seen = new Set<AgentId>();
  const result: AgentId[] = [];
  for (const agent of agents) {
    if (seen.has(agent)) continue;
    seen.add(agent);
    result.push(agent);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
