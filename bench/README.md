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

`--ref` checks out that commit, runs `npm ci` and `npm run build` there, and benchmarks that CLI. `--npm` installs a published package. Nothing has been published yet, so a missing package is an error, not a guessed score. `--all` walks [versions.json](versions.json), the commits on main for 0.1.0, 0.2.0, 0.3.0, and 0.4.0. 0.4.1 is the local CLI.

`npm run bench:report` rewrites `BENCHMARK.md` from the result files without running the CLIs.

## Add a case

1. Add a file under `bench/corpus`. Keep it out of `tests/fixtures`.
2. Add an entry to [cases.json](cases.json):
   - `category`: `raw-control`, `recipe`, `documented-state`, `name-collision`, `package`, `variant`, `clean`, or a new name. A new name shows up in the report on its own. `package` is a component that lives in a workspace package or an installed package, not in `components/ui`. `variant` is a suggested variant on a raw control, or a variant value the catalog does not list.
   - `catch`: `raw`, `rebuilt`, `reinvented`, `export`, `suggested`, `invalid`, or `silent`. `suggested` requires the raw line to name a variant prop. `invalid` requires a line that starts with `invalid`.
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

Two clients share one OpenAI-compatible setup. The primary one is the real-repository trial in [trial/README.md](trial/README.md). It clones pinned apps, installs uninvent on one arm, and scores `git diff` with `uninvent check --base`. OpenRouter is the host to use:

```bash
export UNINVENT_BENCH_API_KEY=...                          # OpenRouter key
export UNINVENT_BENCH_BASE_URL=https://openrouter.ai/api/v1
export UNINVENT_BENCH_MODEL=openai/gpt-4o-mini
# several models in one run:
# export UNINVENT_BENCH_MODEL='anthropic/claude-sonnet-4.5, openai/gpt-4o-mini'
npm run trial -- --dry-run          # no key, canned files, not a result
npm run trial -- --write-case-study # live; fills CASE_STUDY.md only when status is ran
```

`UNINVENT_BENCH_MODEL` is one id or a comma-separated list. Model ids on OpenRouter include the vendor (`openai/gpt-4o-mini`, not `gpt-4o-mini`). When the base URL host is `openrouter.ai` (or a subdomain such as `eu.openrouter.ai`), both clients send `HTTP-Referer: https://github.com/raframil/uninvent` and `X-Title: uninvent`, and the request sets `usage.include` so OpenRouter can return a cost. Another host works if you change `UNINVENT_BENCH_BASE_URL`. The real-repo config defaults to OpenRouter. This corpus client still defaults to `https://api.openai.com/v1` and `gpt-4o-mini` when those two variables are unset, so set all three before `npm run bench` if the key is an OpenRouter key.

GitHub Actions reads the same three names from repository secrets or variables. See [trial/README.md](trial/README.md).

The corpus trial inside `npm run bench` is smaller. It is off unless the key is set. A skipped trial stores `{ "status": "skipped" }` and [BENCHMARK.md](../BENCHMARK.md) prints no scores. For each task in [agent-tasks.json](agent-tasks.json) it asks once with no design-system context and once with the generated skill and the `exists` answer pasted in. It writes the fenced TSX into a copy of the corpus and runs `uninvent check`. `wrongComponents` is the number of finding lines. A reply with no TSX block, or an HTTP error, is `error` and `wrongComponents: null`. Those are not counted as zero. The benchmark workflow does not set the key, so a release benchmark does not include that corpus trial. The real-repository workflow is separate and does not publish numbers into this file.
