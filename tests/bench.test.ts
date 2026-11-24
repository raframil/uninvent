import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { agentTrialFromEnv, extractTsx } from "../bench/agent-trial.js";
import { copyCorpus, corpusSource, loadManifest } from "../bench/corpus.js";
import { renderReport, type BenchResult } from "../bench/report.js";
import { scoreCase, scoreDetection } from "../bench/score.js";

test("every benchmark case points at a corpus file", () => {
  const manifest = loadManifest();
  for (const spec of manifest.cases) {
    assert.equal(existsSync(path.join(corpusSource(), spec.file)), true, spec.file);
  }
  for (const file of manifest.readSource) {
    assert.equal(existsSync(path.join(corpusSource(), file)), true, file);
  }
  const origins = new Set(manifest.cases.map((spec) => spec.origin));
  assert.equal(origins.has("with-rule"), true);
  assert.equal(origins.has("held-out"), true);
});

test("detection scoring is stable and counts a clean hit as a false positive", () => {
  const manifest = loadManifest();
  const login = manifest.cases.find((spec) => spec.id === "raw-login");
  const clean = manifest.cases.find((spec) => spec.id === "clean-customers");
  assert.ok(login && clean);
  const once = scoreDetection([
    scoreCase(login, "raw <input> in src/pages/Login.tsx:4, use ui/Input\nraw <button> in src/pages/Login.tsx:5, use ui/Button\n"),
    scoreCase(clean, ""),
  ]);
  const twice = scoreDetection([
    scoreCase(login, "raw <input> in src/pages/Login.tsx:4, use ui/Input\nraw <button> in src/pages/Login.tsx:5, use ui/Button\n"),
    scoreCase(clean, ""),
  ]);
  assert.equal(once.fingerprint, twice.fingerprint);
  assert.equal(once.categories["raw-control"]?.caught, 1);
  assert.equal(once.categories.clean?.falsePositives, 0);
  const noisy = scoreDetection([scoreCase(clean, "raw <button> in src/pages/Customers.tsx:3, use ui/Button\n")]);
  assert.equal(noisy.categories.clean?.falsePositives, 1);
});

test("the report says when the agent trial did not run", () => {
  const result = {
    schema: 1 as const,
    version: "0.0.0",
    source: "local" as const,
    generatedAt: "2026-01-01T00:00:00.000Z",
    tokenizer: "cl100k_base via gpt-tokenizer (proxy)",
    detection: {
      fingerprint: "clean-fp:0/1",
      categories: {
        clean: {
          caught: 0,
          total: 1,
          falsePositives: 0,
          withRule: { caught: 0, total: 1, falsePositives: 0 },
          heldOut: { caught: 0, total: 0, falsePositives: 0 },
        },
      },
    },
    tokens: {
      skill: 10,
      agents: 4,
      exists: { query: "loading button", tokens: 8, found: false },
      readSource: { files: ["src/components/ui/button.tsx"], tokens: 20 },
      hook: { cleanFile: "src/pages/Customers.tsx", cleanTokens: 0, perFinding: [], meanPerFinding: null },
    },
    latencyMs: {
      samples: 1,
      scan: { median: 1, min: 1, max: 1 },
      hookClean: { median: 1, min: 1, max: 1 },
      hookDirty: { median: 1, min: 1, max: 1 },
      note: "test",
    },
    agentTrial: { status: "skipped" as const, reason: "unset" },
  } satisfies BenchResult;
  const markdown = renderReport([result]);
  assert.match(markdown, /What this does and does not show/);
  assert.match(markdown, /No result file includes a paired trial/);
  assert.match(markdown, /Hook process/);
  assert.match(markdown, /\| 0\.0\.0 \| — \| — \| — \| — \| — \|/);
  assert.equal(markdown.includes("wrong-component count is 0"), false);
});

test("agent trial skips without a key and does not invent a score", () => {
  const saved = process.env.UNINVENT_BENCH_API_KEY;
  delete process.env.UNINVENT_BENCH_API_KEY;
  try {
    const trial = agentTrialFromEnv();
    assert.equal(trial?.status, "skipped");
    assert.match(trial?.reason ?? "", /UNINVENT_BENCH_API_KEY/);
    assert.equal("tasks" in (trial ?? {}), false);
  } finally {
    if (saved === undefined) delete process.env.UNINVENT_BENCH_API_KEY;
    else process.env.UNINVENT_BENCH_API_KEY = saved;
  }
  assert.equal(extractTsx("no code here"), null);
  assert.match(extractTsx("```tsx\nexport function A() { return null; }\n```") ?? "", /export function A/);
});

test("the current CLI agrees with itself on the benchmark corpus", () => {
  const cli = [process.execPath, "--import", "tsx", path.join(import.meta.dirname, "../src/cli.ts")];
  const dir = mkdtempSync(path.join(tmpdir(), "uninvent-bench-"));
  try {
    copyCorpus(corpusSource(), dir);
    const scan = spawnSync(cli[0] ?? "node", [...cli.slice(1), "scan", "--cwd", dir], { encoding: "utf8" });
    assert.equal(scan.status, 0, scan.stderr);
    const manifest = loadManifest();
    const pass = () => manifest.cases.map((spec) => {
      const result = spawnSync(cli[0] ?? "node", [...cli.slice(1), "check", "--cwd", dir, spec.file], { encoding: "utf8" });
      return { id: spec.id, stdout: result.stdout };
    });
    const first = pass();
    const second = pass();
    assert.deepEqual(first, second);
    const scored = scoreDetection(manifest.cases.map((spec, index) => scoreCase(spec, first[index]?.stdout ?? "")));
    assert.equal(scored.categories.clean?.falsePositives, 0);
    for (const name of ["raw-control", "recipe", "documented-state", "name-collision", "package", "variant"]) {
      const category = scored.categories[name];
      assert.ok(category);
      assert.equal(category.caught, category.total, `${name} ${category.caught}/${category.total}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
