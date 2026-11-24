import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prepareChatRequest } from "./headers.js";
import type { TrialArm, TrialTask } from "./types.js";

const MAX_OUTPUT_TOKENS = 4096;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or replace a UTF-8 text file. The write is kept. A PostToolUse hook may add a note afterwards and does not block.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the repository root." },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file. Long files are truncated.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Call when the task file is written and you are done.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AgentResult {
  files: string[];
  turns: number;
  tokens: number | null;
  cost: number | null;
  error?: string;
}

export interface Complete {
  (body: unknown, signal: AbortSignal): Promise<unknown>;
}

export async function runAgent(options: {
  project: string;
  task: TrialTask;
  arm: TrialArm;
  skill: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  maxTurns: number;
  complete?: Complete;
}): Promise<AgentResult> {
  const files: string[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(options.arm, options.skill) },
    { role: "user", content: options.task.prompt },
  ];
  let tokens = 0;
  let sawTokens = false;
  let missingTokens = false;
  let cost = 0;
  let sawCost = false;
  const complete = options.complete ?? ((body, signal) => openAiComplete(options.baseUrl, options.apiKey, body, signal));

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    let payload: unknown;
    try {
      payload = await complete({
        model: options.model,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }, AbortSignal.timeout(120_000));
    } catch (error) {
      return {
        files,
        turns: turn,
        tokens: null,
        cost: null,
        error: redact(error instanceof Error ? error.message : String(error), options.apiKey),
      };
    }
    const parsed = readCompletion(payload);
    if (parsed.error) {
      return { files, turns: turn, tokens: null, cost: null, error: redact(parsed.error, options.apiKey) };
    }
    if (parsed.tokens === null) missingTokens = true;
    else {
      sawTokens = true;
      tokens += parsed.tokens;
    }
    if (parsed.cost !== null) {
      sawCost = true;
      cost += parsed.cost;
    }
    const message = parsed.message;
    if (!message) {
      return { files, turns: turn, tokens: null, cost: null, error: "The model returned no message." };
    }
    messages.push(message);
    const calls = message.tool_calls ?? [];
    const fenced = extractCodeFile(message.content ?? "", options.task.file);
    if (parsed.truncated && !fenced) {
      messages.push({
        role: "user",
        content: "The last reply was cut off at max_tokens. Send the complete task file again.",
      });
      continue;
    }
    if (calls.length === 0) {
      if (fenced) {
        const relative = safeRelative(options.project, options.task.file);
        writeInside(options.project, relative, fenced);
        files.push(relative);
        const note = options.arm === "uninvent" ? hookNote(options.project, relative) : `Wrote ${relative}.`;
        messages.push({ role: "user", content: `${note}\nIf this file is the task, call finish.` });
        continue;
      }
      return {
        files,
        turns: turn,
        tokens: tokenTotal(sawTokens, missingTokens, tokens),
        cost: sawCost ? roundCost(cost) : null,
        error: files.length === 0 ? "The model returned no tool call and no fenced file." : undefined,
      };
    }
    let finished = false;
    let wrote = false;
    for (const call of calls) {
      const result = applyCall(options.project, options.arm, call, parsed.truncated);
      if (result.wrote) {
        files.push(result.wrote);
        wrote = true;
      }
      if (result.finish) finished = true;
      messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
    }
    if (!wrote && fenced) {
      const relative = safeRelative(options.project, options.task.file);
      writeInside(options.project, relative, fenced);
      files.push(relative);
    }
    if (finished) {
      return {
        files: unique(files),
        turns: turn,
        tokens: tokenTotal(sawTokens, missingTokens, tokens),
        cost: sawCost ? roundCost(cost) : null,
      };
    }
  }
  return {
    files: unique(files),
    turns: options.maxTurns,
    tokens: tokenTotal(sawTokens, missingTokens, tokens),
    cost: sawCost ? roundCost(cost) : null,
    error: files.length === 0 ? `No file was written in ${options.maxTurns} turns.` : undefined,
  };
}

export function hookNote(project: string, relativeFile: string): string {
  const command = readHookCommand(project);
  if (!command) return `Wrote ${relativeFile}. The uninvent hook is not installed.`;
  const absolute = path.join(project, relativeFile);
  const event = JSON.stringify({
    session_id: "uninvent-trial",
    hook_event_name: "PostToolUse",
    cwd: project,
    tool_name: "Write",
    tool_input: { file_path: absolute },
  });
  const result = spawnSync(command, {
    cwd: project,
    input: event,
    encoding: "utf8",
    shell: true,
    timeout: 30_000,
  });
  const text = hookText(result.stdout ?? "");
  const kept = `Wrote ${relativeFile}. The write was kept.`;
  if ((result.status ?? 0) !== 0 && !text) {
    return `${kept} The hook exited ${result.status ?? 1} and printed nothing.`;
  }
  if (!text) return kept;
  return `${kept}\n${text}`;
}

export function readHookCommand(project: string): string | null {
  const file = path.join(project, ".claude/settings.json");
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      hooks?: { PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    for (const group of parsed.hooks?.PostToolUse ?? []) {
      for (const hook of group.hooks ?? []) {
        if (hook.command?.includes("uninvent")) return hook.command;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function systemPrompt(arm: TrialArm, skill: string): string {
  const base = [
    "You are a coding agent in an existing React repository.",
    "Write the complete task file now. Do not ask questions and do not reply with a plan.",
    "Call write_file with the full file contents for the path named in the task.",
    "If you do not call a tool, reply with exactly one fenced code block tagged tsx, jsx, typescript, or ts. That block is the entire file.",
    "Do not add dependencies and do not edit unrelated files.",
    "Call finish when the requested file is written.",
  ];
  if (arm === "baseline") return base.join(" ");
  const clipped = skill.length > 24_000 ? `${skill.slice(0, 24_000)}\n\n[skill truncated]` : skill;
  return [
    ...base,
    "This project has a design system. The skill below lists the components that were scanned.",
    "Prefer those components. The PostToolUse hook may add one line per finding after a write.",
    "The write is kept either way. If a line names a component, prefer that component.",
    "",
    clipped,
  ].join("\n");
}

function applyCall(
  project: string,
  arm: TrialArm,
  call: ToolCall,
  truncated: boolean,
): { text: string; wrote?: string; finish?: boolean } {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    if (truncated) return { text: "Tool arguments were cut off at max_tokens. Send the complete file again." };
    return { text: "Could not parse tool arguments." };
  }
  if (call.function.name === "finish") return { text: "Finished.", finish: true };
  if (call.function.name === "read_file") {
    try {
      const relative = safeRelative(project, String(args.path ?? ""));
      const text = readFileSync(path.join(project, relative), "utf8");
      return { text: text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[truncated]` : text };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error) };
    }
  }
  if (call.function.name === "write_file") {
    try {
      const relative = safeRelative(project, String(args.path ?? ""));
      const content = stripFence(String(args.content ?? ""));
      if (content.length > 100_000) return { text: "Refused: file is larger than 100000 characters." };
      writeInside(project, relative, content);
      const text = arm === "uninvent" ? hookNote(project, relative) : `Wrote ${relative}.`;
      return { text, wrote: relative };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error) };
    }
  }
  return { text: `Unknown tool ${call.function.name}.` };
}

function writeInside(project: string, relative: string, content: string): void {
  const absolute = path.join(project, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content.endsWith("\n") ? content : `${content}\n`);
}

export function safeRelative(project: string, requested: string): string {
  if (!requested || requested.includes("\0")) throw new Error("Missing path.");
  const absolute = path.resolve(project, requested);
  const relative = path.relative(project, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the repository.");
  }
  const posix = relative.replace(/\\/g, "/");
  if (posix === ".git" || posix.startsWith(".git/")) throw new Error("Refusing to write .git.");
  return posix;
}

function stripFence(content: string): string {
  const match = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(content.trim());
  return match?.[1] ?? content;
}

const CODE_LANG = /^(tsx|jsx|ts|typescript|javascript|js|react)$/;

/** Pull one complete source file out of a reply. An unclosed fence is not a file. */
export function extractCodeFile(text: string, taskFile?: string): string | null {
  const blocks: Array<{ lang: string; body: string; at: number }> = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const lang = (match[1] ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
    if (lang !== "" && !CODE_LANG.test(lang)) continue;
    const body = (match[2] ?? "").replace(/\s+$/, "");
    if (!body.trim()) continue;
    blocks.push({ lang, body, at: match.index });
  }
  if (blocks.length === 0) return null;
  if (taskFile) {
    const base = taskFile.split("/").pop() ?? taskFile;
    const named = blocks.find((block) => {
      const before = text.slice(Math.max(0, block.at - 240), block.at);
      return before.includes(taskFile) || before.includes(base);
    });
    if (named) return named.body;
  }
  return blocks.reduce((best, block) => (block.body.length > best.body.length ? block : best)).body;
}

export function extractTsx(text: string): string | null {
  return extractCodeFile(text);
}

function hookText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    return (parsed.hookSpecificOutput?.additionalContext ?? parsed.additional_context ?? "").trim();
  } catch {
    return trimmed;
  }
}

interface ParsedCompletion {
  message: ChatMessage | null;
  tokens: number | null;
  cost: number | null;
  truncated: boolean;
  error?: string;
}

function readCompletion(payload: unknown): ParsedCompletion {
  const body = payload as {
    error?: { message?: string };
    usage?: { total_tokens?: number; cost?: number; total_cost?: number };
    choices?: Array<{ message?: ChatMessage; finish_reason?: string }>;
  };
  if (body?.error?.message) {
    return { message: null, tokens: null, cost: null, truncated: false, error: body.error.message };
  }
  const choice = body?.choices?.[0];
  const message = choice?.message ?? null;
  const tokens = typeof body?.usage?.total_tokens === "number" ? body.usage.total_tokens : null;
  const cost = typeof body?.usage?.cost === "number"
    ? body.usage.cost
    : typeof body?.usage?.total_cost === "number"
      ? body.usage.total_cost
      : null;
  return { message, tokens, cost, truncated: choice?.finish_reason === "length" };
}

async function openAiComplete(baseUrl: string, apiKey: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const request = prepareChatRequest(baseUrl, apiKey, body);
  const response = await fetch(request.url, {
    method: "POST",
    signal,
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  const json = await response.json() as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(json.error?.message ?? `HTTP ${response.status}`);
  }
  return json;
}

function tokenTotal(saw: boolean, missing: boolean, tokens: number): number | null {
  if (!saw || missing) return null;
  return tokens;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function redact(text: string, key: string): string {
  if (!key) return text;
  return text.split(key).join("[redacted]");
}
