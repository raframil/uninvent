# Benchmark

`npm run bench` runs uninvent against [bench/corpus](corpus) and writes `bench/results/<version>.json` plus [BENCHMARK.md](../BENCHMARK.md). Detection counts are checked twice in one run and must match. Check and scan latency is a median of five CLI runs and can move by a few milliseconds. Hook latency is the `uninvent hook` process: cold (compile cache off), warm (cache reused), p50 and p95, on a clean file and on a file with a finding. Token counts use cl100k_base as a proxy, labeled in the result file.

## Run

From the repo root, after `npm install` and `npm run build`:

```bash
npm run bench
```

That benchmarks the local `dist/cli.js` and regenerates the report.

```bash
npm run bench -- --ref 0f3870e
npm run bench -- --npm uninvent@0.3.0
npm run bench -- --all
npm run bench -- --rounds 5
```

`--ref` checks out that commit, runs `npm ci` and `npm run build` there, and benchmarks that CLI. `--npm` installs a published package. Nothing has been published yet, so a missing package is an error, not a guessed score. `--all` walks [versions.json](versions.json), the commits on main for 0.1.0, 0.2.0, and 0.3.0.

`npm run bench:report` rewrites `BENCHMARK.md` from the result files without running the CLIs.

## Add a case

1. Add a file under `bench/corpus`. Keep it out of `tests/fixtures`.
2. Add an entry to [cases.json](cases.json):
   - `category`: `raw-control`, `recipe`, `documented-state`, `name-collision`, `package`, `clean`, or a new name. A new name shows up in the report on its own. `package` is a component that lives in a workspace package or an installed package, not in `components/ui`.
   - `catch`: `raw`, `rebuilt`, `reinvented`, `export`, or `silent`.
   - `origin`: `with-rule` if you wrote it to define the rule, `held-out` if it is a different file that should still pass.
   - `note`: one sentence on why it is here.
3. `npm test` checks that the file exists and that the current CLI catches every non-clean case and stays quiet on every clean one.
4. `npm run bench` records the new counts for this version.

`clean` cases are the false-positive set. A finding there fails the run's story: the report shows them as false positives.

## Release

Tag a release on main (the tag's `package.json` version is the result filename). The [benchmark workflow](../.github/workflows/benchmark.yml) runs on `release: published` and on `workflow_dispatch`. It does not need a secret. It benchmarks that version, then opens a pull request that adds `bench/results/<version>.json` and the regenerated `BENCHMARK.md`.

To refresh history locally:

```bash
npm run bench -- --all
```

## Paired agent trial

Off unless you set a key. A skipped trial stores `{ "status": "skipped" }` and the report prints no scores.

```bash
export UNINVENT_BENCH_API_KEY=...
export UNINVENT_BENCH_BASE_URL=https://api.openai.com/v1   # optional
export UNINVENT_BENCH_MODEL=gpt-4o-mini                     # optional
npm run bench
```

The client is OpenAI-compatible (`POST /chat/completions`). For each task in [agent-tasks.json](agent-tasks.json) it asks once with no design-system context and once with the generated skill and the `exists` answer pasted in. It writes the fenced TSX into a copy of the corpus and runs `uninvent check`. `wrongComponents` is the number of finding lines. A reply with no TSX block, or an HTTP error, is `error` and `wrongComponents: null`. Those are not counted as zero.

The workflow never sets the key, so release results do not include a trial.
