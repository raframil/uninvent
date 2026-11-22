import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, type Complete } from "./agent.js";
import { parseModelList } from "./headers.js";
import { loadTrialConfig } from "./load.js";
import { defaultCacheRoot, installUninvent, materialize, scanForScore } from "./prepare.js";
import { syncCaseStudy } from "./report.js";
import { readSkill, replayCanned, scoreDiff } from "./score.js";
import { summarize } from "./stats.js";
import type { TrialArm, TrialConfig, TrialRepo, TrialResult, TrialRunScore, TrialTask } from "./types.js";

const ARMS: TrialArm[] = ["baseline", "uninvent"];

export interface RunTrialOptions {
  config: TrialConfig;
  uninventRoot: string;
  dryRun: boolean;
  cacheRoot?: string;
  artifactRoot: string;
  resultFile: string;
  apiKey?: string;
  /** One model, or several separated by commas. Overrides UNINVENT_BENCH_MODEL. */
  models?: string;
  baseUrl?: string;
  runs?: number;
  repoFilter?: string;
  complete?: Complete;
  canned?: Record<string, Record<string, Record<TrialArm, string>>>;
  writeCaseStudy?: boolean;
  caseStudyPath?: string;
}

export async function runTrial(options: RunTrialOptions): Promise<TrialResult> {
  const baseUrl = blank(options.baseUrl) ?? blank(process.env.UNINVENT_BENCH_BASE_URL) ?? options.config.baseUrl;
  const models = options.dryRun
    ? ["dry-run"]
    : parseModelList(blank(options.models) ?? blank(process.env.UNINVENT_BENCH_MODEL), options.config.model);
  const apiKey = options.apiKey ?? process.env.UNINVENT_BENCH_API_KEY?.trim() ?? "";
  const runs = options.runs ?? options.config.runs;
  if (!options.dryRun && !apiKey) {
    const result = emptyResult({
      status: "error",
      reason: "UNINVENT_BENCH_API_KEY is not set. The real-repository trial did not run. Re-run with --dry-run to replay canned files.",
      models,
      baseUrl,
      runs,
      maxTurns: options.config.maxTurns,
      version: readVersion(options.uninventRoot),
    });
    writeResult(options.resultFile, result);
    return result;
  }
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a positive integer.");
  const repos = options.repoFilter
    ? options.config.repos.filter((repo) => repo.id === options.repoFilter)
    : options.config.repos;
  if (repos.length === 0) throw new Error(`No trial repo named ${options.repoFilter}.`);
  const perArm = options.dryRun ? 1 : runs;
  const byModel = [];
  for (const model of models) {
    process.stderr.write(`model ${model}\n`);
    const repoResults = [];
    for (const repo of repos) {
      process.stderr.write(`repo ${repo.id} ${repo.sha.slice(0, 7)}\n`);
      const tasks = [];
      for (const task of repo.tasks) {
        const scores: TrialRunScore[] = [];
        for (const arm of ARMS) {
          for (let run = 1; run <= perArm; run += 1) {
            process.stderr.write(`  ${task.id} ${arm} ${run}/${perArm}\n`);
            scores.push(await oneRun({
              repo,
              task,
              arm,
              run,
              options,
              model,
              baseUrl,
              apiKey,
            }));
          }
        }
        tasks.push({
          id: task.id,
          file: task.file,
          prompt: task.prompt,
          runs: scores,
          baseline: summarize(scores, "baseline"),
          uninvent: summarize(scores, "uninvent"),
        });
      }
      repoResults.push({
        id: repo.id,
        url: repo.url,
        sha: repo.sha,
        license: repo.license,
        tasks,
      });
    }
    byModel.push({ model, repos: repoResults });
  }
  const scored = byModel.some((block) => block.repos.some((repo) => repo.tasks.some((task) => task.baseline.scored > 0 || task.uninvent.scored > 0)));
  const result: TrialResult = {
    schema: 1,
    status: options.dryRun ? "dry-run" : scored ? "ran" : "error",
    ...(options.dryRun
      ? { reason: "Dry-run replayed canned files and did not call a model. These counts are not the case study." }
      : scored
        ? {}
        : { reason: "The model was called and no run could be scored." }),
    generatedAt: new Date().toISOString(),
    uninventVersion: readVersion(options.uninventRoot),
    model: models.join(", "),
    models,
    baseUrl,
    provider: "openai-compatible",
    runs: perArm,
    maxTurns: options.config.maxTurns,
    judge: "uninvent check --base <pinned sha> --format json. reuse and invent are that JSON. raw is findings of kind raw-element. Tokens are usage.total_tokens when every response included them. Cost is set only when the provider returned it. OpenRouter returns cost when the request asks for usage.",
    byModel,
  };
  writeResult(options.resultFile, result);
  if (options.writeCaseStudy) {
    if (result.status === "ran") syncCaseStudy({ caseStudyPath: options.caseStudyPath, trialFile: options.resultFile });
    else process.stderr.write("Case study left pending. Dry-run and failed runs do not fill the results table.\n");
  }
  return result;
}

async function oneRun(input: {
  repo: TrialRepo;
  task: TrialTask;
  arm: TrialArm;
  run: number;
  options: RunTrialOptions;
  model: string;
  baseUrl: string;
  apiKey: string;
}): Promise<TrialRunScore> {
  const dir = mkdtempSync(path.join(tmpdir(), `uninvent-trial-${input.repo.id}-`));
  const artifact = path.join(
    input.options.artifactRoot,
    modelSlug(input.model),
    input.repo.id,
    input.task.id,
    input.arm,
    `run-${input.run}.diff`,
  );
  try {
    const base = materialize(input.repo, dir, input.options.cacheRoot ?? defaultCacheRoot());
    let files: string[] = [];
    let tokens: number | null = null;
    let cost: number | null = null;
    let turns = 0;
    let agentError: string | undefined;
    if (input.arm === "uninvent") installUninvent(dir, input.options.uninventRoot);
    if (input.options.dryRun) {
      replayCanned({
        project: dir,
        repoId: input.repo.id,
        taskId: input.task.id,
        file: input.task.file,
        arm: input.arm,
        extra: input.options.canned,
      });
      files = [input.task.file];
    } else {
      const agent = await runAgent({
        project: dir,
        task: input.task,
        arm: input.arm,
        skill: input.arm === "uninvent" ? readSkill(dir) : "",
        model: input.model,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        maxTurns: input.options.config.maxTurns,
        complete: input.options.complete,
      });
      files = agent.files;
      tokens = agent.tokens;
      cost = agent.cost;
      turns = agent.turns;
      agentError = agent.error;
    }
    if (input.arm === "baseline") scanForScore(dir, input.options.uninventRoot);
    return scoreDiff({
      project: dir,
      uninventRoot: input.options.uninventRoot,
      base,
      files,
      arm: input.arm,
      run: input.run,
      tokens,
      cost,
      turns,
      artifact,
      agentError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      arm: input.arm,
      run: input.run,
      invent: null,
      reuse: null,
      raw: null,
      recipe: null,
      state: null,
      nameCollision: null,
      tokens: null,
      cost: null,
      turns: 0,
      emptyDiff: true,
      error: message,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeResult(file: string, result: TrialResult): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  process.stderr.write(`Wrote ${file}\n`);
}

function emptyResult(input: {
  status: TrialResult["status"];
  reason: string;
  models: string[];
  baseUrl: string;
  runs: number;
  maxTurns: number;
  version: string;
}): TrialResult {
  return {
    schema: 1,
    status: input.status,
    reason: input.reason,
    generatedAt: new Date().toISOString(),
    uninventVersion: input.version,
    model: input.models.join(", "),
    models: input.models,
    baseUrl: input.baseUrl,
    provider: "openai-compatible",
    runs: input.runs,
    maxTurns: input.maxTurns,
    judge: "uninvent check --base <pinned sha> --format json",
    byModel: [],
  };
}

function modelSlug(model: string): string {
  return model.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

function readVersion(root: string): string {
  const parsed = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
  return parsed.version ?? "0.0.0";
}

function blank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseCli(argv: string[]): {
  dryRun: boolean;
  runs?: number;
  repo?: string;
  models?: string;
  writeCaseStudy: boolean;
  config: string;
} {
  let dryRun = false;
  let runs: number | undefined;
  let repo: string | undefined;
  let models: string | undefined;
  let writeCaseStudy = false;
  let config = path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json");
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") dryRun = true;
    else if (token === "--write-case-study") writeCaseStudy = true;
    else if (token === "--runs") runs = Number(need(argv, ++index, "--runs"));
    else if (token === "--repo") repo = need(argv, ++index, "--repo");
    else if (token === "--models") models = need(argv, ++index, "--models");
    else if (token === "--config") config = need(argv, ++index, "--config");
    else if (token === "--help" || token === "-h") {
      process.stdout.write("Usage: npm run trial -- [--dry-run] [--runs N] [--repo id] [--models a,b] [--write-case-study] [--config file]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument ${token}. See bench/trial/README.md.`);
    }
  }
  return { dryRun, runs, repo, models, writeCaseStudy, config };
}

function need(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return value;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = parseCli(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = path.join(root, "bench/trial");
  runTrial({
    config: loadTrialConfig(path.resolve(args.config)),
    uninventRoot: root,
    dryRun: args.dryRun,
    artifactRoot: path.join(dir, "artifacts"),
    resultFile: path.join(dir, "results", args.dryRun ? "dry-run.json" : "trial.json"),
    runs: args.runs,
    models: args.models,
    repoFilter: args.repo,
    writeCaseStudy: args.writeCaseStudy,
    caseStudyPath: path.join(root, "CASE_STUDY.md"),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
