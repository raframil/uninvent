import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cannedSource } from "./canned.js";
import { commit, git } from "./git.js";
import { cliArgs } from "./prepare.js";
import type { TrialArm, TrialRunScore } from "./types.js";

export interface CheckScore {
  invent: number;
  reuse: number;
  raw: number;
  recipe: number;
  state: number;
  nameCollision: number;
}

export function replayCanned(options: {
  project: string;
  repoId: string;
  taskId: string;
  file: string;
  arm: TrialArm;
  extra?: Record<string, Record<string, Record<TrialArm, string>>>;
}): void {
  const content = cannedSource(options.repoId, options.taskId, options.arm, options.extra);
  if (content === null) throw new Error(`No canned ${options.arm} file for ${options.repoId}/${options.taskId}.`);
  const absolute = path.join(options.project, options.file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content.endsWith("\n") ? content : `${content}\n`);
}

export function scoreDiff(options: {
  project: string;
  uninventRoot: string;
  base: string;
  files: string[];
  arm: TrialArm;
  run: number;
  tokens: number | null;
  cost: number | null;
  turns: number;
  artifact: string;
  agentError?: string;
}): TrialRunScore {
  const committed = commit(options.project, options.files, `trial ${options.arm} run ${options.run}`);
  const diff = committedDiff(options.project, options.base);
  mkdirSync(path.dirname(options.artifact), { recursive: true });
  writeFileSync(options.artifact, diff.endsWith("\n") || diff.length === 0 ? diff : `${diff}\n`);
  const baseScore: TrialRunScore = {
    arm: options.arm,
    run: options.run,
    invent: null,
    reuse: null,
    raw: null,
    recipe: null,
    state: null,
    nameCollision: null,
    tokens: options.tokens,
    cost: options.cost,
    turns: options.turns,
    emptyDiff: !committed,
    diff: options.artifact,
    error: options.agentError,
  };
  if (!committed) {
    baseScore.error = options.agentError ?? "The agent produced no diff against the pinned commit.";
    return baseScore;
  }
  const cli = cliArgs(options.uninventRoot);
  const result = spawnSync(cli[0] ?? "node", [...cli.slice(1), "check", "--cwd", options.project, "--base", options.base, "--format", "json"], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if ((result.status ?? 2) > 1) {
    baseScore.error = (result.stderr || result.stdout || `uninvent check exited ${result.status}`).trim();
    return baseScore;
  }
  try {
    const scored = parseCheck(result.stdout ?? "");
    return { ...baseScore, ...scored, error: options.agentError };
  } catch (error) {
    baseScore.error = error instanceof Error ? error.message : String(error);
    return baseScore;
  }
}

export function parseCheck(stdout: string): CheckScore {
  const parsed = JSON.parse(stdout) as {
    invent?: unknown;
    reuse?: unknown;
    findings?: Array<{ kind?: unknown }>;
  };
  if (!Array.isArray(parsed.findings) || typeof parsed.invent !== "number" || typeof parsed.reuse !== "number") {
    throw new Error("uninvent check did not return reuse, invent, and findings.");
  }
  const kinds = parsed.findings.map((finding) => finding.kind);
  return {
    invent: parsed.invent,
    reuse: parsed.reuse,
    raw: kinds.filter((kind) => kind === "raw-element").length,
    recipe: kinds.filter((kind) => kind === "recipe").length,
    state: kinds.filter((kind) => kind === "state").length,
    nameCollision: kinds.filter((kind) => kind === "name-collision").length,
  };
}

function committedDiff(project: string, base: string): string {
  try {
    return git(project, ["diff", "--unified=3", `${base}...HEAD`]);
  } catch {
    return git(project, ["diff", "--unified=3", base, "HEAD"]);
  }
}

export function readSkill(project: string): string {
  const file = path.join(project, ".claude/skills/uninvent/SKILL.md");
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
