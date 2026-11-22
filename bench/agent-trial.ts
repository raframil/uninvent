import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyCorpus } from "./corpus.js";
import { prepareChatRequest } from "./trial/headers.js";

export interface AgentTask {
  id: string;
  file: string;
  prompt: string;
}

export interface AgentCondition {
  condition: "without-uninvent" | "with-uninvent";
  /** Null when the reply was not scored. Never a stand-in for a failed call. */
  wrongComponents: number | null;
  findings: string[];
  tokens: number | null;
  timeMs: number;
  error?: string;
}

export interface AgentTaskResult {
  id: string;
  conditions: AgentCondition[];
}

export interface AgentTrial {
  status: "skipped" | "ran" | "error";
  reason?: string;
  model?: string;
  judge?: string;
  tasks?: AgentTaskResult[];
}

const SKIPPED: AgentTrial = {
  status: "skipped",
  reason: "UNINVENT_BENCH_API_KEY is not set. The paired agent trial did not run.",
};

export function agentTrialFromEnv(): AgentTrial | null {
  const key = process.env.UNINVENT_BENCH_API_KEY?.trim();
  if (!key) return SKIPPED;
  return null;
}

export async function runAgentTrial(options: {
  cli: string[];
  corpusRoot: string;
  skill: string;
  existsText: string;
  tasks: AgentTask[];
}): Promise<AgentTrial> {
  const skipped = agentTrialFromEnv();
  if (skipped) return skipped;
  const key = process.env.UNINVENT_BENCH_API_KEY?.trim() ?? "";
  const base = (process.env.UNINVENT_BENCH_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.UNINVENT_BENCH_MODEL?.trim() || "gpt-4o-mini";
  const tasks: AgentTaskResult[] = [];
  try {
    for (const task of options.tasks) {
      const conditions: AgentCondition[] = [];
      for (const condition of ["without-uninvent", "with-uninvent"] as const) {
        conditions.push(await oneCondition({
          key,
          base,
          model,
          cli: options.cli,
          corpusRoot: options.corpusRoot,
          task,
          condition,
          skill: options.skill,
          existsText: options.existsText,
        }));
      }
      tasks.push({ id: task.id, conditions });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      model,
      judge: "uninvent check finding count",
      reason: message,
      tasks,
    };
  }
  return {
    status: "ran",
    model,
    judge: "uninvent check finding count on the file the model returned. This is the checker's count, not a human grade.",
    tasks,
  };
}

async function oneCondition(options: {
  key: string;
  base: string;
  model: string;
  cli: string[];
  corpusRoot: string;
  task: AgentTask;
  condition: "without-uninvent" | "with-uninvent";
  skill: string;
  existsText: string;
}): Promise<AgentCondition> {
  const started = Date.now();
  const system = options.condition === "with-uninvent"
    ? [
        "You write one React TSX file and nothing else. Reply with a single fenced tsx block.",
        "This project has a design system. Use it. Do not reinvent a component or a documented state.",
        options.skill,
        options.existsText,
      ].join("\n\n")
    : "You write one React TSX file and nothing else. Reply with a single fenced tsx block.";
  let tokens: number | null = null;
  let text = "";
  try {
    const request = prepareChatRequest(options.base, options.key, {
      model: options.model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: options.task.prompt },
      ],
    });
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    const body = await response.json() as {
      error?: { message?: string };
      usage?: { total_tokens?: number };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) {
      return {
        condition: options.condition,
        wrongComponents: null,
        findings: [],
        tokens: null,
        timeMs: Date.now() - started,
        error: body.error?.message ?? `HTTP ${response.status}`,
      };
    }
    tokens = typeof body.usage?.total_tokens === "number" ? body.usage.total_tokens : null;
    text = body.choices?.[0]?.message?.content ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      condition: options.condition,
      wrongComponents: null,
      findings: [],
      tokens: null,
      timeMs: Date.now() - started,
      error: message,
    };
  }
  const code = extractTsx(text);
  if (!code) {
    return {
      condition: options.condition,
      wrongComponents: null,
      findings: [],
      tokens,
      timeMs: Date.now() - started,
      error: "The model reply had no TSX block, so it was not scored.",
    };
  }
  const dir = mkdtempSync(path.join(tmpdir(), "uninvent-agent-"));
  try {
    copyCorpus(options.corpusRoot, dir);
    const scan = spawnSync(options.cli[0] ?? "node", [...options.cli.slice(1), "scan", "--cwd", dir], { encoding: "utf8" });
    if (scan.status !== 0) {
      return {
        condition: options.condition,
        wrongComponents: null,
        findings: [],
        tokens,
        timeMs: Date.now() - started,
        error: scan.stderr || "scan failed before the reply could be scored",
      };
    }
    const target = path.join(dir, options.task.file);
    writeFileSync(target, code.endsWith("\n") ? code : `${code}\n`);
    const check = spawnSync(options.cli[0] ?? "node", [...options.cli.slice(1), "check", "--cwd", dir, options.task.file], {
      encoding: "utf8",
    });
    const findings = (check.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      condition: options.condition,
      wrongComponents: findings.length,
      findings,
      tokens,
      timeMs: Date.now() - started,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function extractTsx(text: string): string | null {
  const fence = text.match(/```(?:tsx|jsx|ts|javascript)?\s*\n([\s\S]*?)```/);
  if (fence?.[1]?.trim()) return fence[1].trim();
  return null;
}

export function readAgentTasks(file: string): AgentTask[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { tasks?: AgentTask[] };
  if (!Array.isArray(parsed.tasks)) return [];
  return parsed.tasks.filter((task) => task.id && task.file && task.prompt);
}
