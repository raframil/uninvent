# Real-repository trial

Paired runs of the same UI task, baseline against uninvent (init, generated skill, PostToolUse hook). The judge is `uninvent check --base <pinned sha> --format json`. A dry-run replays canned files and does not call a model. It is not the case study.

The client speaks OpenAI-compatible chat completions. **OpenRouter is the setup to use.** Any other compatible host works if you change the base URL.

## OpenRouter

```bash
export UNINVENT_BENCH_API_KEY=sk-or-...
export UNINVENT_BENCH_BASE_URL=https://openrouter.ai/api/v1
export UNINVENT_BENCH_MODEL=openai/gpt-4o-mini
npm run trial -- --write-case-study
```

A dispatch `models` value of one id runs only that model. To rerun Claude after the harness fix:

```text
models: anthropic/claude-sonnet-4.5
runs: 2
dry_run: false
```

Compare two models in one run. The value is a comma-separated list, and each model gets the full task list:

```bash
export UNINVENT_BENCH_MODEL='anthropic/claude-sonnet-4.5, openai/gpt-4o-mini'
npm run trial -- --runs 2 --write-case-study
```

Model ids on OpenRouter include the vendor. `gpt-4o-mini` is the OpenAI id. `openai/gpt-4o-mini` is the OpenRouter id. The config default is `https://openrouter.ai/api/v1` and `openai/gpt-4o-mini`.

When the base URL host is `openrouter.ai` or a subdomain (`eu.openrouter.ai`), the request adds:

- `HTTP-Referer: https://github.com/raframil/uninvent` (`UNINVENT_BENCH_HTTP_REFERER` overrides it)
- `X-Title: uninvent` (`UNINVENT_BENCH_TITLE` overrides it)
- `usage.include: true`, so OpenRouter can return `usage.cost`

Those headers are omitted for any other host. Cost in the result file is that field when the provider sends it. The harness does not invent a cost.

`CASE_STUDY.md` is rewritten only when the result status is `ran`. A missing key writes an error result and leaves the case study pending.

```bash
npm run trial -- --dry-run
```

## GitHub Actions

Workflow: [`.github/workflows/agent-trial.yml`](../../.github/workflows/agent-trial.yml).

`workflow_dispatch`, and `release` when the key exists. The release job skips instead of failing when the key is absent. The workflow uploads `bench/trial/results`, `bench/trial/artifacts`, and `CASE_STUDY.md`. It does not commit them and it does not publish to npm.

| Name | Where | What |
|---|---|---|
| `UNINVENT_BENCH_API_KEY` | repository secret | OpenRouter API key |
| `UNINVENT_BENCH_BASE_URL` | repository secret or variable | `https://openrouter.ai/api/v1` |
| `UNINVENT_BENCH_MODEL` | repository secret or variable | One id, or a comma-separated list |

A secret wins over a variable of the same name. Dispatch inputs:

| Input | Default | What |
|---|---|---|
| `dry_run` | false | Replay canned files. No key. |
| `runs` | `2` | Runs per arm. Ignored for a dry-run. |
| `models` | empty | Overrides `UNINVENT_BENCH_MODEL` for this run. Example: `anthropic/claude-sonnet-4.5, openai/gpt-4o-mini`. |

## Budget

Not a measurement. List prices on OpenRouter as of 2026-11-22, before caching: `openai/gpt-4o-mini` is $0.15 / $0.60 per 1M input/output tokens, and `anthropic/claude-sonnet-4.5` is $3 / $15. The default schedule is 2 repositories, 5 tasks, 2 arms, 2 runs: 40 sessions per model. A session that takes about 3 turns and carries the skill is on the order of 600k input tokens and 80k output tokens for those 40 sessions. A session that always uses the 6-turn cap is several times that.

| Model | About, 40 sessions | If every session uses 6 turns |
|---|---|---|
| `openai/gpt-4o-mini` | $0.15–$1 | under $2 |
| `anthropic/claude-sonnet-4.5` | $3–$8 | about $10–$15 |
| both, one dispatch | about $4–$10 | about $12–$17 |

The result file replaces this budget with `usage.cost` when OpenRouter sends it. Confirm the live price on [OpenRouter](https://openrouter.ai/models) before a long run. `--runs 1` halves the table.

## What is pinned

`config.json` names the repositories, the full SHAs, and the tasks. Canned files for the dry-run live in `canned.ts`. Diffs land in `artifacts/<model>/<repo>/<task>/<arm>/`. Those directories are gitignored.
