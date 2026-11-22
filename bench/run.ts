import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { encode } from "gpt-tokenizer";
import { readAgentTasks, runAgentTrial, type AgentTrial } from "./agent-trial.js";
import { casesFile, copyCorpus, corpusSource, loadManifest, repoRoot, resultsDir, type BenchManifest } from "./corpus.js";
import { writeReport, type BenchResult } from "./report.js";
import { scoreCase, scoreDetection, type CaseResult } from "./score.js";

const TOKENIZER = "cl100k_base via gpt-tokenizer (OpenAI GPT-4 proxy, not the Claude or Cursor tokenizer)";
const LATENCY_NOTE = "Median CLI wall time in milliseconds, including Node startup. Detection counts do not depend on this.";

interface Target {
  version: string;
  source: "local" | "git" | "npm";
  git?: string;
  npm?: string;
  cli: string[];
}

function main(): Promise<void> {
  return run(process.argv.slice(2)).then((written) => {
    writeReport();
    for (const file of written) process.stdout.write(`Wrote ${file}\n`);
    process.stdout.write("Wrote BENCHMARK.md\n");
  });
}

async function run(argv: string[]): Promise<string[]> {
  const args = parseArgs(argv);
  const targets = resolveTargets(args);
  const written: string[] = [];
  for (const target of targets) {
    const result = await benchmark(target, args.rounds);
    const file = path.join(resultsDir(), `${result.version}.json`);
    mkdirSync(resultsDir(), { recursive: true });
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    written.push(path.relative(repoRoot(), file));
  }
  return written;
}

function parseArgs(argv: string[]): { ref?: string; npm?: string; all: boolean; rounds: number } {
  let ref: string | undefined;
  let npmSpec: string | undefined;
  let all = false;
  let rounds = 5;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all") all = true;
    else if (token === "--ref") ref = need(argv, ++index, "--ref");
    else if (token === "--npm") npmSpec = need(argv, ++index, "--npm");
    else if (token === "--rounds") rounds = Number(need(argv, ++index, "--rounds"));
    else if (token === "--help" || token === "-h") {
      process.stdout.write("Usage: npm run bench [-- --all | --ref <sha> | --npm <spec>] [--rounds N]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument ${token}. See bench/README.md.`);
    }
  }
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error("--rounds needs a positive integer.");
  return { ref, npm: npmSpec, all, rounds };
}

function need(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return value;
}

function resolveTargets(args: { ref?: string; npm?: string; all: boolean }): Target[] {
  if (args.all) {
    const versions = JSON.parse(readFileSync(path.join(path.dirname(casesFile()), "versions.json"), "utf8")) as Record<string, string>;
    return Object.entries(versions).map(([version, ref]) => targetFromGit(ref, version));
  }
  if (args.ref) return [targetFromGit(args.ref)];
  if (args.npm) return [targetFromNpm(args.npm)];
  return [targetFromLocal()];
}

function targetFromLocal(): Target {
  const cliPath = path.join(repoRoot(), "dist/cli.js");
  if (!existsSync(cliPath)) throw new Error("dist/cli.js is missing. Run npm run build first.");
  const version = readVersion(path.join(repoRoot(), "package.json"));
  let git: string | undefined;
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot(), encoding: "utf8" });
  if (sha.status === 0) git = sha.stdout.trim();
  return { version, source: "local", git, cli: [process.execPath, cliPath] };
}

function targetFromGit(ref: string, expectedVersion?: string): Target {
  const sha = spawnSync("git", ["rev-parse", "--verify", ref], { cwd: repoRoot(), encoding: "utf8" });
  if (sha.status !== 0) throw new Error(sha.stderr || `Unknown ref ${ref}`);
  const commit = sha.stdout.trim();
  const dir = path.join(tmpdir(), "uninvent-bench-src", commit.slice(0, 12));
  if (!existsSync(path.join(dir, "dist/cli.js"))) {
    mkdirSync(path.dirname(dir), { recursive: true });
    if (!existsSync(dir)) {
      const added = spawnSync("git", ["worktree", "add", "--detach", dir, commit], { cwd: repoRoot(), encoding: "utf8" });
      if (added.status !== 0) throw new Error(added.stderr || `Could not check out ${ref}`);
    }
    const installed = spawnSync("npm", ["ci"], { cwd: dir, encoding: "utf8" });
    if (installed.status !== 0) throw new Error(installed.stderr || `npm ci failed for ${ref}`);
    const built = spawnSync("npm", ["run", "build"], { cwd: dir, encoding: "utf8" });
    if (built.status !== 0) throw new Error(built.stderr || `build failed for ${ref}`);
  }
  const version = readVersion(path.join(dir, "package.json"));
  if (expectedVersion && version !== expectedVersion) {
    throw new Error(`${ref} is package version ${version}, not ${expectedVersion}.`);
  }
  return { version, source: "git", git: commit, cli: [process.execPath, path.join(dir, "dist/cli.js")] };
}

function targetFromNpm(spec: string): Target {
  const dir = path.join(tmpdir(), "uninvent-bench-npm", spec.replace(/[^a-zA-Z0-9._-]+/g, "_"));
  mkdirSync(dir, { recursive: true });
  if (!existsSync(path.join(dir, "package.json"))) {
    writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ private: true })}\n`);
  }
  const installed = spawnSync("npm", ["install", "--silent", "--no-save", spec], { cwd: dir, encoding: "utf8" });
  if (installed.status !== 0) {
    throw new Error(installed.stderr || `Could not install ${spec}. Nothing may be published under that name yet.`);
  }
  const name = packageName(spec);
  const pkgJson = path.join(dir, "node_modules", name, "package.json");
  if (!existsSync(pkgJson)) throw new Error(`Installed ${spec} but did not find ${name}.`);
  const version = readVersion(pkgJson);
  const cliPath = path.join(dir, "node_modules", name, "dist/cli.js");
  if (!existsSync(cliPath)) throw new Error(`${spec} has no dist/cli.js.`);
  return { version, source: "npm", npm: spec, cli: [process.execPath, cliPath] };
}

function packageName(spec: string): string {
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    const at = spec.indexOf("@", slash + 1);
    return at === -1 ? spec : spec.slice(0, at);
  }
  const at = spec.lastIndexOf("@");
  return at <= 0 ? spec : spec.slice(0, at);
}

async function benchmark(target: Target, rounds: number): Promise<BenchResult> {
  const manifest = loadManifest();
  const dir = path.join(tmpdir(), "uninvent-bench-corpus", `${target.version}-${target.source}`);
  copyCorpus(corpusSource(), dir);
  const scan = invoke(target.cli, ["scan", "--cwd", dir]);
  if (scan.status !== 0) throw new Error(`scan failed for ${target.version}: ${scan.stderr || scan.stdout}`);
  const first = detect(target.cli, dir, manifest);
  const second = detect(target.cli, dir, manifest);
  if (first.fingerprint !== second.fingerprint) {
    throw new Error(`Detection changed between two passes of ${target.version}: ${first.fingerprint} vs ${second.fingerprint}`);
  }
  const skill = readIfExists(path.join(dir, ".claude/skills/uninvent/SKILL.md"));
  const agents = readIfExists(path.join(dir, "AGENTS.md"));
  const exists = invoke(target.cli, ["exists", manifest.existsQuery, "--cwd", dir]);
  const sourceText = manifest.readSource.map((file) => readFileSync(path.join(dir, file), "utf8")).join("\n");
  const hookLines = first.cases.flatMap((entry) => entry.lines.map((line) => ({ file: entry.file, line, tokens: countTokens(line) })));
  const clean = manifest.cases.find((entry) => entry.id === "clean-customers") ?? manifest.cases.find((entry) => entry.catch === "silent");
  const dirty = manifest.cases.find((entry) => entry.id === "state-save-spinner") ?? manifest.cases.find((entry) => entry.catch !== "silent");
  const agentTrial = await maybeAgent(target, skill, exists.stdout);
  return {
    schema: 1,
    version: target.version,
    source: target.source,
    ...(target.git ? { git: target.git } : {}),
    ...(target.npm ? { npm: target.npm } : {}),
    generatedAt: new Date().toISOString(),
    tokenizer: TOKENIZER,
    detection: {
      fingerprint: first.fingerprint,
      categories: first.categories,
      cases: first.cases,
    },
    tokens: {
      skill: countTokens(skill),
      agents: countTokens(agents),
      exists: { query: manifest.existsQuery, tokens: countTokens(exists.stdout), found: exists.status === 0 },
      readSource: { files: manifest.readSource, tokens: countTokens(sourceText) },
      hook: {
        cleanFile: clean?.file ?? "",
        cleanTokens: clean ? countTokens(invoke(target.cli, ["check", "--cwd", dir, clean.file]).stdout) : 0,
        perFinding: hookLines,
        meanPerFinding: hookLines.length === 0 ? null : round1(hookLines.reduce((sum, line) => sum + line.tokens, 0) / hookLines.length),
      },
    },
    latencyMs: {
      samples: rounds,
      scan: timeIt(target.cli, ["scan", "--cwd", dir], rounds),
      hookClean: timeIt(target.cli, ["check", "--cwd", dir, clean?.file ?? "src/pages/Customers.tsx"], rounds),
      hookDirty: timeIt(target.cli, ["check", "--cwd", dir, dirty?.file ?? "src/pages/Login.tsx"], rounds),
      note: LATENCY_NOTE,
    },
    agentTrial,
  };
}

function detect(cli: string[], dir: string, manifest: BenchManifest): { fingerprint: string; categories: BenchResult["detection"]["categories"]; cases: CaseResult[] } {
  const cases = manifest.cases.map((spec) => {
    const result = invoke(cli, ["check", "--cwd", dir, spec.file]);
    return scoreCase(spec, result.stdout);
  });
  const scored = scoreDetection(cases);
  return { fingerprint: scored.fingerprint, categories: scored.categories, cases };
}

async function maybeAgent(target: Target, skill: string, existsText: string): Promise<AgentTrial> {
  const tasks = readAgentTasks(path.join(path.dirname(casesFile()), "agent-tasks.json"));
  return runAgentTrial({
    cli: target.cli,
    corpusRoot: corpusSource(),
    skill,
    existsText,
    tasks,
  });
}

function timeIt(cli: string[], args: string[], rounds: number): { median: number; min: number; max: number } {
  invoke(cli, args);
  const samples: number[] = [];
  for (let index = 0; index < rounds; index += 1) samples.push(invoke(cli, args).ms);
  samples.sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const median = samples.length % 2 === 0 ? ((samples[mid - 1] ?? 0) + (samples[mid] ?? 0)) / 2 : (samples[mid] ?? 0);
  return {
    median: round1(median),
    min: round1(Math.min(...samples)),
    max: round1(Math.max(...samples)),
  };
}

function invoke(cli: string[], args: string[]): { status: number; stdout: string; stderr: string; ms: number } {
  const started = performance.now();
  const result = spawnSync(cli[0] ?? "node", [...cli.slice(1), ...args], { encoding: "utf8" });
  return {
    status: result.status ?? 2,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ms: performance.now() - started,
  };
}

function countTokens(text: string): number {
  return encode(text).length;
}

function readIfExists(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function readVersion(file: string): string {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: string };
  if (!parsed.version) throw new Error(`No version in ${file}`);
  return parsed.version;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

export { detect, benchmark };
