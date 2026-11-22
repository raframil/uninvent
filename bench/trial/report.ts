import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTrialConfig } from "./load.js";
import type { TrialConfig, TrialResult, TrialStat } from "./types.js";

interface BenchFile {
  version: string;
  tokens: {
    skill: number;
    exists: { tokens: number };
    hook: { meanPerFinding: number | null };
  };
  detection: {
    categories: Record<string, { caught: number; total: number; falsePositives: number } | undefined>;
  };
  latencyMs: {
    scan: { median: number };
    hookClean: { median: number };
    hookRun?: {
      cold: { p50: number; p95: number };
      warm: { p50: number; p95: number };
    };
  };
}

const LABELS: Record<string, string> = {
  "raw-control": "Raw controls",
  recipe: "Recipes",
  "documented-state": "Documented states",
  "name-collision": "Name collisions",
  package: "Package sources",
  clean: "Clean false positives",
};

export function syncCaseStudy(options?: { caseStudyPath?: string; trialFile?: string; benchDir?: string; configFile?: string }): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const caseStudyPath = options?.caseStudyPath ?? path.join(root, "CASE_STUDY.md");
  const trialFile = options?.trialFile ?? path.join(root, "bench/trial/results/trial.json");
  const benchDir = options?.benchDir ?? path.join(root, "bench/results");
  const configFile = options?.configFile ?? path.join(root, "bench/trial/config.json");
  const markdown = readFileSync(caseStudyPath, "utf8");
  const trial = readTrial(trialFile);
  const config = loadTrialConfig(configFile);
  const withBench = replaceMarker(markdown, "bench-highlights", benchmarkSection(benchDir));
  const withResults = replaceMarker(withBench, "trial-results", resultsSection(config, trial));
  const withExcerpts = replaceMarker(withResults, "trial-excerpts", excerptSection(trial));
  if (withExcerpts !== markdown) writeFileSync(caseStudyPath, withExcerpts);
}

function readTrial(file: string): TrialResult | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as TrialResult;
    if (parsed.status !== "ran") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function resultsSection(config: TrialConfig, trial: TrialResult | null): string {
  if (!trial) {
    return [
      "**Results are pending.** There is no `bench/trial/results/trial.json` with `\"status\": \"ran\"`. A dry-run replays canned files and is not this table. Every cell is a placeholder. None of these rows is a measurement.",
      "",
      resultsTable(config, null),
      "",
      "A live run repeats these rows once per model. Variance is the sample standard deviation across scored runs of that arm. It stays blank until at least two scored runs exist. Cost stays blank unless the provider returned a cost field. A run that errors is not counted as zero.",
    ].join("\n");
  }
  return [
    `Recorded ${trial.generatedAt}. Model${trial.models.length === 1 ? "" : "s"} \`${trial.model}\` at \`${trial.baseUrl}\`. uninvent ${trial.uninventVersion}. ${trial.runs} run${trial.runs === 1 ? "" : "s"} per arm. ${trial.judge}`,
    "",
    resultsTable(config, trial),
    "",
    "Mean and sample standard deviation use scored runs only. A run with an error is not a zero. Cost is the provider's field when it sent one.",
  ].join("\n");
}

export function excerptSection(trial: TrialResult | null): string {
  if (!trial) {
    return [
      "**Diff excerpts are pending.** After a real run, this section quotes up to two tasks whose saved diffs are in `bench/trial/artifacts`. Canned dry-run diffs are not shown here.",
    ].join("\n");
  }
  const picks = pickExcerpts(trial);
  if (picks.length === 0) {
    return "The trial ran. No task had a saved baseline diff and a saved uninvent diff to quote. Nothing is filled in from a canned file.";
  }
  const blocks = picks.map((pick) => {
    return [
      `### ${pick.model} / ${pick.repo} / ${pick.task}`,
      "",
      "Baseline, without uninvent:",
      "",
      fence(pick.baseline),
      "",
      "With uninvent (init, skill, PostToolUse hook):",
      "",
      fence(pick.uninvent),
    ].join("\n");
  });
  return blocks.join("\n\n");
}

function resultsTable(config: TrialConfig, trial: TrialResult | null): string {
  const headers = ["Model", "Repo", "Task", "Arm", "Scored", "Reuse", "Invent", "Raw controls", "Tokens", "Cost"];
  const rows: string[][] = [];
  if (!trial) {
    for (const repo of config.repos) {
      for (const task of repo.tasks) {
        for (const arm of ["baseline", "uninvent"] as const) {
          rows.push([ "—", repo.id, task.id, arm, "—", "—", "—", "—", "—", "—" ]);
        }
      }
    }
    return table(headers, rows);
  }
  for (const block of trial.byModel) {
    for (const repo of block.repos) {
      for (const task of repo.tasks) {
        for (const arm of ["baseline", "uninvent"] as const) {
          const summary = task[arm];
          rows.push([
            block.model,
            repo.id,
            task.id,
            arm,
            `${summary.scored}/${summary.attempted}`,
            formatStat(summary.reuse),
            formatStat(summary.invent),
            formatStat(summary.raw),
            formatStat(summary.tokens, "—"),
            formatStat(summary.cost, "—"),
          ]);
        }
      }
    }
  }
  return table(headers, rows);
}

function benchmarkSection(benchDir: string): string {
  const left = readBench(path.join(benchDir, "0.3.0.json"));
  const right = readBench(path.join(benchDir, "0.4.1.json"));
  if (!left || !right) {
    return "Benchmark highlights are missing `bench/results/0.3.0.json` or `bench/results/0.4.1.json`.";
  }
  const names = ["raw-control", "recipe", "documented-state", "name-collision", "package", "clean"];
  const rows = names.map((name) => [
    LABELS[name] ?? name,
    formatCategory(left, name),
    formatCategory(right, name),
  ]);
  rows.push(
    ["Skill tokens", String(left.tokens.skill), String(right.tokens.skill)],
    ["exists tokens", String(left.tokens.exists.tokens), String(right.tokens.exists.tokens)],
    ["Hook line (mean tokens)", cell(left.tokens.hook.meanPerFinding), cell(right.tokens.hook.meanPerFinding)],
    ["Scan (ms)", String(left.latencyMs.scan.median), String(right.latencyMs.scan.median)],
    ["Clean-file check (ms)", String(left.latencyMs.hookClean.median), String(right.latencyMs.hookClean.median)],
    ["Hook cold p50 (ms)", hook(left, "cold", "p50"), hook(right, "cold", "p50")],
    ["Hook cold p95 (ms)", hook(left, "cold", "p95"), hook(right, "cold", "p95")],
    ["Hook warm p50 (ms)", hook(left, "warm", "p50"), hook(right, "warm", "p50")],
    ["Hook warm p95 (ms)", hook(left, "warm", "p95"), hook(right, "warm", "p95")],
  );
  return [
    "Taken from `bench/results/0.3.0.json` and `bench/results/0.4.1.json`. This is the fixed corpus, not the agent trial. `npm run bench` rewrites the 0.4.1 file and this section.",
    "",
    table(["", "0.3.0", "0.4.1"], rows),
  ].join("\n");
}

function pickExcerpts(trial: TrialResult): Array<{ model: string; repo: string; task: string; baseline: string; uninvent: string }> {
  const picks = [];
  for (const block of trial.byModel) {
    for (const repo of block.repos) {
      for (const task of repo.tasks) {
        const baseline = task.runs.find((run) => run.arm === "baseline" && run.diff);
        const treated = task.runs.find((run) => run.arm === "uninvent" && run.diff);
        if (!baseline?.diff || !treated?.diff) continue;
        if (baseline.invent === null || treated.invent === null) continue;
        if (baseline.invent <= treated.invent) continue;
        picks.push({
          model: block.model,
          repo: repo.id,
          task: task.id,
          baseline: clip(readFileSafe(baseline.diff)),
          uninvent: clip(readFileSafe(treated.diff)),
        });
        if (picks.length === 2) return picks;
      }
    }
  }
  return picks;
}

function formatStat(stat: TrialStat, empty = "not scored"): string {
  if (stat.n === 0 || stat.mean === null) return empty;
  if (stat.sd === null) return String(stat.mean);
  return `${stat.mean} (sd ${stat.sd})`;
}

function formatCategory(result: BenchFile, name: string): string {
  const score = result.detection.categories[name];
  if (!score) return "—";
  if (name === "clean") return `${score.falsePositives} fp / ${score.total}`;
  return `${score.caught} / ${score.total}`;
}

function hook(result: BenchFile, phase: "cold" | "warm", stat: "p50" | "p95"): string {
  return cell(result.latencyMs.hookRun?.[phase]?.[stat]);
}

function cell(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function readBench(file: string): BenchFile | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as BenchFile;
  } catch {
    return null;
  }
}

function readFileSafe(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function clip(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= 80) return text.trimEnd();
  return `${lines.slice(0, 80).join("\n")}\n… truncated`;
}

function fence(text: string): string {
  return ["```diff", text || "(empty diff)", "```"].join("\n");
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

function replaceMarker(markdown: string, name: string, body: string): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const from = markdown.indexOf(start);
  const to = markdown.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`Missing ${start} marker.`);
  }
  return `${markdown.slice(0, from + start.length)}\n${body.trim()}\n${markdown.slice(to)}`;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  syncCaseStudy();
  process.stdout.write("Updated CASE_STUDY.md\n");
}
