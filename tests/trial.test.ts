import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { extractCodeFile, runAgent } from "../bench/trial/agent.js";
import { isOpenRouter, parseModelList, prepareChatRequest } from "../bench/trial/headers.js";
import { installUninvent } from "../bench/trial/prepare.js";
import { loadPendingModels, resultsSection, syncCaseStudy } from "../bench/trial/report.js";
import { hookNote } from "../bench/trial/agent.js";
import { runTrial } from "../bench/trial/run.js";
import { loadTrialConfig } from "../bench/trial/load.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("fenced replies accept jsx, ts, and typescript and pick the named task file", () => {
  const jsx = extractCodeFile("```jsx\nexport function A() { return <button>Go</button>; }\n```", "src/A.tsx");
  assert.match(jsx ?? "", /<button>Go<\/button>/);
  const typescript = extractCodeFile("```typescript\nexport const value = 1;\n```");
  assert.match(typescript ?? "", /export const value/);
  const ts = extractCodeFile("```ts\nexport const other = 2;\n```");
  assert.match(ts ?? "", /export const other/);
  const several = [
    "```tsx",
    "export function Helper() { return null; }",
    "```",
    "src/features/trial/role-filter.tsx",
    "```jsx",
    "export function RoleFilter() { return <select />; }",
    "```",
  ].join("\n");
  assert.match(extractCodeFile(several, "src/features/trial/role-filter.tsx") ?? "", /function RoleFilter/);
  assert.equal(extractCodeFile("Which page should this dialog live on?"), null);
  assert.equal(extractCodeFile("```tsx\nexport function Cut() { return <button />; }\n"), null);
});

test("a jsx fence with no tool call writes the task file for either arm", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uninvent-fence-"));
  const bodies: Array<{ max_tokens?: number; messages: Array<{ role: string; content: string | null }> }> = [];
  try {
    const result = await runAgent({
      project: dir,
      task: { id: "settings", file: "src/pages/Settings.tsx", prompt: "Add settings." },
      arm: "baseline",
      skill: "SKILL TEXT",
      model: "anthropic/claude-sonnet-4.5",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test-key",
      maxTurns: 2,
      complete: async (body) => {
        bodies.push(body as typeof bodies[number]);
        if (bodies.length === 1) {
          return {
            usage: { total_tokens: 20 },
            choices: [{
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "```jsx\nexport function Settings() { return <button>Settings</button>; }\n```",
                tool_calls: undefined,
              },
            }],
          };
        }
        return {
          usage: { total_tokens: 5 },
          choices: [{
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "done", type: "function", function: { name: "finish", arguments: "{}" } }],
            },
          }],
        };
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(bodies[0]?.max_tokens, 4096);
    assert.match(bodies[0]?.messages[0]?.content ?? "", /Do not ask questions/);
    assert.equal((bodies[0]?.messages[0]?.content ?? "").includes("SKILL TEXT"), false);
    assert.match(readFileSync(path.join(dir, "src/pages/Settings.tsx"), "utf8"), /<button>Settings<\/button>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OpenRouter requests carry attribution headers and ask for usage", () => {
  assert.equal(isOpenRouter("https://openrouter.ai/api/v1"), true);
  assert.equal(isOpenRouter("https://eu.openrouter.ai/api/v1"), true);
  assert.equal(isOpenRouter("https://api.openai.com/v1"), false);
  const openRouter = prepareChatRequest("https://openrouter.ai/api/v1", "secret", { model: "openai/gpt-4o-mini" });
  assert.equal(openRouter.headers["HTTP-Referer"], "https://github.com/raframil/uninvent");
  assert.equal(openRouter.headers["X-Title"], "uninvent");
  assert.equal(openRouter.headers.authorization, "Bearer secret");
  assert.deepEqual((openRouter.body as { usage?: unknown }).usage, { include: true });
  const openai = prepareChatRequest("https://api.openai.com/v1", "secret", { model: "gpt-4o-mini" });
  assert.equal(openai.headers["HTTP-Referer"], undefined);
  assert.equal(openai.headers["X-Title"], undefined);
  assert.equal((openai.body as { usage?: unknown }).usage, undefined);
  assert.deepEqual(parseModelList(" anthropic/claude-sonnet-4.5, openai/gpt-4o-mini ", "openai/gpt-4o-mini"), [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4o-mini",
  ]);
});

test("a missing key does not invent trial scores", async () => {
  const saved = process.env.UNINVENT_BENCH_API_KEY;
  delete process.env.UNINVENT_BENCH_API_KEY;
  const dir = mkdtempSync(path.join(tmpdir(), "uninvent-trial-missing-"));
  try {
    const result = await runTrial({
      config: loadTrialConfig(path.join(repoRoot, "bench/trial/config.json")),
      uninventRoot: repoRoot,
      dryRun: false,
      artifactRoot: path.join(dir, "artifacts"),
      resultFile: path.join(dir, "trial.json"),
      repoFilter: "missing-on-purpose",
    });
    assert.equal(result.status, "error");
    assert.equal(result.byModel.length, 0);
    assert.match(result.reason ?? "", /UNINVENT_BENCH_API_KEY/);
    assert.equal(JSON.stringify(result).includes("\"invent\": 0"), false);
  } finally {
    if (saved === undefined) delete process.env.UNINVENT_BENCH_API_KEY;
    else process.env.UNINVENT_BENCH_API_KEY = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dry-run scores canned files, installs PostToolUse only, and leaves the case study pending", async () => {
  const fixture = makeFixture();
  let extra: string | undefined;
  const dir = mkdtempSync(path.join(tmpdir(), "uninvent-trial-dry-"));
  const caseStudy = path.join(dir, "CASE_STUDY.md");
  writeFileSync(caseStudy, "PLACEHOLDER\n");
  try {
    installUninvent(fixture.path, repoRoot);
    const claude = JSON.parse(readFileSync(path.join(fixture.path, ".claude/settings.json"), "utf8")) as {
      hooks: { PostToolUse?: unknown; PreToolUse?: unknown };
    };
    const cursor = JSON.parse(readFileSync(path.join(fixture.path, ".cursor/hooks.json"), "utf8")) as {
      hooks: { postToolUse?: unknown; preToolUse?: unknown };
    };
    assert.ok(claude.hooks.PostToolUse);
    assert.equal(claude.hooks.PreToolUse, undefined);
    assert.ok(cursor.hooks.postToolUse);
    assert.equal(cursor.hooks.preToolUse, undefined);

    mkdirSync(path.join(fixture.path, "src/pages"), { recursive: true });
    const raw = path.join(fixture.path, "src/pages/Login.tsx");
    writeFileSync(raw, "export function Login() {\n  return <button type=\"submit\">Go</button>;\n}\n");
    const noisy = hookNote(fixture.path, "src/pages/Login.tsx");
    assert.match(noisy, /raw <button>/);
    assert.match(noisy, /write was kept/i);
    assert.equal(existsSync(raw), true);
    writeFileSync(
      path.join(fixture.path, "src/pages/Home.tsx"),
      "import { Button } from \"@/components/ui/button\";\nexport function Home() {\n  return <Button>Go</Button>;\n}\n",
    );
    const quiet = hookNote(fixture.path, "src/pages/Home.tsx");
    assert.equal(/raw </.test(quiet), false);

    const seen: unknown[] = [];
    await runAgent({
      project: fixture.path,
      task: { id: "settings", file: "src/pages/Settings.tsx", prompt: "Add settings." },
      arm: "uninvent",
      skill: "Use Button.",
      model: "openai/gpt-4o-mini",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test-key",
      maxTurns: 2,
      complete: async (body) => {
        seen.push(body);
        if (seen.length === 1) {
          return {
            usage: { total_tokens: 11 },
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "write_file",
                    arguments: JSON.stringify({
                      path: "src/pages/Settings.tsx",
                      content: "export function Settings() {\n  return <button>Settings</button>;\n}\n",
                    }),
                  },
                }],
              },
            }],
          };
        }
        return {
          usage: { total_tokens: 5 },
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call-2", type: "function", function: { name: "finish", arguments: "{}" } }],
            },
          }],
        };
      },
    });
    const second = seen[1] as { messages: Array<{ role: string; content: string | null }> };
    assert.match(JSON.stringify(second.messages), /raw <button>/);
    assert.equal(existsSync(path.join(fixture.path, "src/pages/Settings.tsx")), true);

    const fresh = makeFixture();
    extra = fresh.path;
    const result = await runTrial({
      config: {
        schema: 1,
        model: "openai/gpt-4o-mini",
        baseUrl: "https://openrouter.ai/api/v1",
        runs: 3,
        maxTurns: 2,
        repos: [{
          id: "fixture",
          url: "https://example.invalid/fixture.git",
          sha: fresh.sha,
          license: "MIT",
          stars: "0",
          why: "unit fixture",
          path: fresh.path,
          tasks: [{ id: "settings", file: "src/pages/Settings.tsx", prompt: "Add a settings button." }],
        }],
      },
      uninventRoot: repoRoot,
      dryRun: true,
      cacheRoot: path.join(dir, "cache"),
      artifactRoot: path.join(dir, "artifacts"),
      resultFile: path.join(dir, "dry-run.json"),
      writeCaseStudy: true,
      caseStudyPath: caseStudy,
      canned: {
        fixture: {
          settings: {
            baseline: "export function Settings() {\n  return <button type=\"button\">Settings</button>;\n}\n",
            uninvent: "import { Button } from \"@/components/ui/button\";\nexport function Settings() {\n  return <Button>Settings</Button>;\n}\n",
          },
        },
      },
    });
    assert.equal(result.status, "dry-run");
    assert.equal(result.models[0], "dry-run");
    const task = result.byModel[0]?.repos[0]?.tasks[0];
    assert.ok(task);
    const baseline = task.runs.find((run) => run.arm === "baseline");
    const treated = task.runs.find((run) => run.arm === "uninvent");
    assert.ok(baseline && treated);
    assert.equal(baseline.invent, 1);
    assert.equal(baseline.raw, 1);
    assert.equal(baseline.reuse, 0);
    assert.equal(treated.invent, 0);
    assert.equal(treated.reuse, 1);
    assert.equal(existsSync(baseline.diff ?? ""), true);
    assert.equal(readFileSync(caseStudy, "utf8"), "PLACEHOLDER\n");
  } finally {
    rmSync(fixture.path, { recursive: true, force: true });
    if (extra) rmSync(extra, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the case study report stays pending without a ran trial", () => {
  const config = loadTrialConfig(path.join(repoRoot, "bench/trial/config.json"));
  const pending = resultsSection(config, null);
  const held = loadPendingModels(path.join(repoRoot, "bench/trial/pending.json"));
  assert.equal(held.has("anthropic/claude-sonnet-4.5"), true);
  const masked = resultsSection(config, {
    schema: 1,
    status: "ran",
    generatedAt: "2026-11-22T23:38:51.598Z",
    uninventVersion: "0.4.1",
    model: "anthropic/claude-sonnet-4.5, openai/gpt-4o-mini",
    models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o-mini"],
    baseUrl: "https://openrouter.ai/api/v1",
    provider: "openai-compatible",
    runs: 2,
    maxTurns: 6,
    judge: "check",
    byModel: [{
      model: "anthropic/claude-sonnet-4.5",
      repos: [{
        id: "shadcn-admin",
        url: "https://example.invalid",
        sha: "abc",
        license: "MIT",
        tasks: [{
          id: "settings-dialog",
          file: "src/features/trial/settings-dialog.tsx",
          prompt: "Add settings.",
          runs: [],
          baseline: { attempted: 2, scored: 0, invent: { n: 0, mean: null, sd: null }, reuse: { n: 0, mean: null, sd: null }, raw: { n: 0, mean: null, sd: null }, tokens: { n: 2, mean: 14717, sd: 2.83 }, cost: { n: 2, mean: 0.05, sd: 0 } },
          uninvent: { attempted: 2, scored: 2, invent: { n: 2, mean: 0, sd: 0 }, reuse: { n: 2, mean: 8, sd: 0 }, raw: { n: 2, mean: 0, sd: 0 }, tokens: { n: 2, mean: 1, sd: 0 }, cost: { n: 2, mean: 0.09, sd: 0 } },
        }],
      }],
    }],
  }, held);
  assert.match(masked, /pending rerun/);
  assert.equal(masked.includes("14717"), false);
  assert.match(pending, /Results are pending/);
  assert.equal(pending.includes("(sd "), false);
  assert.match(pending, /shadcn-admin/);
  const dir = mkdtempSync(path.join(tmpdir(), "uninvent-case-"));
  const file = path.join(dir, "CASE_STUDY.md");
  writeFileSync(file, [
    "# Case",
    "",
    "<!-- trial-results:start -->",
    "old",
    "<!-- trial-results:end -->",
    "",
    "<!-- trial-excerpts:start -->",
    "old",
    "<!-- trial-excerpts:end -->",
    "",
    "<!-- bench-highlights:start -->",
    "old",
    "<!-- bench-highlights:end -->",
    "",
  ].join("\n"));
  try {
    syncCaseStudy({
      caseStudyPath: file,
      trialFile: path.join(dir, "missing.json"),
      benchDir: path.join(repoRoot, "bench/results"),
      configFile: path.join(repoRoot, "bench/trial/config.json"),
    });
    const text = readFileSync(file, "utf8");
    const results = text.slice(text.indexOf("trial-results:start"), text.indexOf("trial-results:end"));
    assert.match(results, /Results are pending/);
    assert.equal(results.includes("(sd "), false);
    assert.match(text, /4 \/ 4/);
    assert.match(text, /0 fp \/ 13/);
    assert.match(text, /3 \/ 3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeFixture(): { path: string; sha: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "uninvent-fixture-"));
  mkdirSync(path.join(dir, "src/components/ui"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "fixture", private: true })}\n`);
  writeFileSync(path.join(dir, "components.json"), `${JSON.stringify({ aliases: { ui: "@/components/ui" } })}\n`);
  writeFileSync(path.join(dir, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      jsx: "react-jsx",
      baseUrl: ".",
      paths: { "@/*": ["./src/*"] },
    },
  })}\n`);
  writeFileSync(
    path.join(dir, "src/components/ui/button.tsx"),
    "import * as React from \"react\";\nexport function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {\n  return <button {...props} />;\n}\n",
  );
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  git(["init", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=uninvent-trial@users.noreply.github.com", "-c", "user.name=uninvent trial", "commit", "-m", "base"]);
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" });
  assert.equal(sha.status, 0, sha.stderr);
  return { path: dir, sha: (sha.stdout ?? "").trim() };
}
