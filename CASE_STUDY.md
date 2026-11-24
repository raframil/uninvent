# Case study

uninvent checks whether a coding agent reused the design system that is already in the repository. This note is the public record of that check: what shipped since 0.3.0, how the real-repository trial is run, and the fixed-corpus benchmark. The agent trial has not been run. Its table stays empty until `bench/trial/results/trial.json` has `"status": "ran"`.

## What uninvent is

A local catalog of the components, recipes, and documented Storybook states in the repo. `uninvent exists` answers a question from that catalog. `uninvent check` reads a diff and prints one line per miss: a raw control, a rebuilt recipe, a documented state copied by hand, or a second export of a catalog name. The PostToolUse hook prints the same line after a write, or nothing when the file is clean. It does not block the write, does not rewrite the file, and does not lint color tokens.

There is no MCP server and no autofix. uninvent does not try to be a general drift linter.

## Method

Two MIT-licensed React applications, each pinned to one commit. Both already contain a shadcn/ui component library on Radix. They are applications, not the shadcn registry itself.

| Repo | Commit | Why this one |
|---|---|---|
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | `e16c87f213a5ba5e45964e9b67c792105ec74d26` | Admin dashboard, about 17k stars. `src/components/ui` has Dialog, AlertDialog, DropdownMenu, Select, Checkbox, Form, Input, Button, and Skeleton. The pin is the 2026-06-11 commit that bumps `@clerk/react`. |
| [shadcn-ui/taxonomy](https://github.com/shadcn-ui/taxonomy) | `298a8857c7128a0d121e7f699dfd729f23b3966d` | The canonical Next.js app built with shadcn/ui, about 19k stars. `components/ui` is at the repo root and `@/*` maps to `./*`. A content app, so the second shape is not another dashboard. The pin is the 2026-04-20 commit `docs: update readme`. |

Tasks, five per repo. The prompt is the same in both arms. It names the file to create and the UI to add. It does not name uninvent.

| Repo | Task | File |
|---|---|---|
| shadcn-admin | Settings dialog | `src/features/trial/settings-dialog.tsx` |
| shadcn-admin | Confirm before delete | `src/features/trial/confirm-delete.tsx` |
| shadcn-admin | Role filter | `src/features/trial/role-filter.tsx` |
| shadcn-admin | Invite form (email, role, checkbox) | `src/features/trial/invite-form.tsx` |
| shadcn-admin | Empty and loading users | `src/features/trial/users-empty.tsx` |
| taxonomy | Settings dialog | `components/trial/settings-dialog.tsx` |
| taxonomy | Confirm before deleting a post | `components/trial/confirm-delete.tsx` |
| taxonomy | Post status filter | `components/trial/post-filter.tsx` |
| taxonomy | Newsletter form | `components/trial/newsletter-form.tsx` |
| taxonomy | Empty and loading posts | `components/trial/posts-empty.tsx` |

The agent is an OpenAI-compatible chat-completions client (`POST {base}/chat/completions`) with three tools: `write_file`, `read_file`, and `finish`. The primary host is [OpenRouter](https://openrouter.ai): `UNINVENT_BENCH_BASE_URL` defaults to `https://openrouter.ai/api/v1`, and the default model id is `openai/gpt-4o-mini`. `UNINVENT_BENCH_MODEL` may be one id or a comma-separated list (`anthropic/claude-sonnet-4.5, openai/gpt-4o-mini`), and the trial runs that list in order so one invocation compares models. When the base URL is OpenRouter, the client sends `HTTP-Referer` and `X-Title` and asks for `usage.include` so the response can carry a cost. Another OpenAI-compatible host still works if you point `UNINVENT_BENCH_BASE_URL` at it. Temperature is 0. Each task gets at most 6 turns. The default schedule is 2 runs per arm.

Arms:

- **baseline.** The task prompt only. uninvent is not installed. The hook does not run.
- **uninvent.** `uninvent init`, `uninvent install` (PostToolUse only, no `--pre`), and `uninvent scan`. The generated skill is in the system prompt. After each `write_file` the installed hook command runs. The write is already on disk. Silence stays silence. A miss comes back as one line per finding, which is the tool result the model sees on the next turn.

The judge is `uninvent check --base <pinned sha> --format json` on the committed diff. `reuse` and `invent` are that JSON. Raw controls are findings whose kind is `raw-element`. Tokens are `usage.total_tokens` when every response included them. Cost is recorded only when the provider returns a cost field. A run that errors is left unscored. It is not stored as zero.

These repositories do not ship an `uninvent.recipes.md`, and their UI folders are not a Storybook project. `check` can count raw controls, name collisions, and reuse. It does not invent a recipe or a documented state the repo never declared.

`npm run trial:report` rewrites the three generated sections below. A dry-run (`npm run trial -- --dry-run`) replays canned files, proves the harness, and does not fill those sections.

## Results

<!-- trial-results:start -->
**Results are pending.** There is no `bench/trial/results/trial.json` with `"status": "ran"`. A dry-run replays canned files and is not this table. Every cell is a placeholder. None of these rows is a measurement.

| Model | Repo | Task | Arm | Scored | Reuse | Invent | Raw controls | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | shadcn-admin | settings-dialog | baseline | — | — | — | — | — | — |
| — | shadcn-admin | settings-dialog | uninvent | — | — | — | — | — | — |
| — | shadcn-admin | confirm-delete | baseline | — | — | — | — | — | — |
| — | shadcn-admin | confirm-delete | uninvent | — | — | — | — | — | — |
| — | shadcn-admin | role-filter | baseline | — | — | — | — | — | — |
| — | shadcn-admin | role-filter | uninvent | — | — | — | — | — | — |
| — | shadcn-admin | invite-form | baseline | — | — | — | — | — | — |
| — | shadcn-admin | invite-form | uninvent | — | — | — | — | — | — |
| — | shadcn-admin | users-empty | baseline | — | — | — | — | — | — |
| — | shadcn-admin | users-empty | uninvent | — | — | — | — | — | — |
| — | taxonomy | settings-dialog | baseline | — | — | — | — | — | — |
| — | taxonomy | settings-dialog | uninvent | — | — | — | — | — | — |
| — | taxonomy | confirm-delete | baseline | — | — | — | — | — | — |
| — | taxonomy | confirm-delete | uninvent | — | — | — | — | — | — |
| — | taxonomy | post-filter | baseline | — | — | — | — | — | — |
| — | taxonomy | post-filter | uninvent | — | — | — | — | — | — |
| — | taxonomy | newsletter-form | baseline | — | — | — | — | — | — |
| — | taxonomy | newsletter-form | uninvent | — | — | — | — | — | — |
| — | taxonomy | posts-empty | baseline | — | — | — | — | — | — |
| — | taxonomy | posts-empty | uninvent | — | — | — | — | — | — |

A live run repeats these rows once per model. Variance is the sample standard deviation across scored runs of that arm. It stays blank until at least two scored runs exist. Cost stays blank unless the provider returned a cost field. A run that errors is not counted as zero.
<!-- trial-results:end -->

## Diff excerpts

<!-- trial-excerpts:start -->
**Diff excerpts are pending.** After a real run, this section quotes up to two tasks whose saved diffs are in `bench/trial/artifacts`. Canned dry-run diffs are not shown here.
<!-- trial-excerpts:end -->

What a miss looks like on the demo app, which is the checker and not this trial:

```text
rebuilt Confirm dialog in src/components/Confirm.tsx:7, use ui/Dialog + ui/Button
reinvented loading on Button in src/components/SaveButton.tsx:11, use ui/Button loading
```

`uninvent check src/pages/Customers.tsx` prints nothing.

## Benchmark

The fixed corpus in `bench/corpus` is a separate measurement from the agent trial. 0.3.0 is the Storybook-state release. 0.4.1 is the current unpublished line: package and monorepo sources (landed as 0.4.0), the faster hook, and variant lines on a raw control. Counts below are generated from the result files.

<!-- bench-highlights:start -->
Taken from `bench/results/0.3.0.json` and `bench/results/0.4.1.json`. This is the fixed corpus, not the agent trial. `npm run bench` rewrites the 0.4.1 file and this section.

|  | 0.3.0 | 0.4.1 |
| --- | --- | --- |
| Raw controls | 4 / 4 | 4 / 4 |
| Recipes | 2 / 2 | 2 / 2 |
| Documented states | 6 / 6 | 6 / 6 |
| Name collisions | 2 / 2 | 2 / 2 |
| Package sources | 0 / 3 | 3 / 3 |
| Variants | — | 4 / 4 |
| Clean false positives | 0 fp / 13 | 0 fp / 15 |
| Skill tokens | 630 | 779 |
| exists tokens | 30 | 30 |
| Hook line (mean tokens) | 19.9 | 20.8 |
| Scan (ms) | 357.4 | 378.8 |
| Clean-file check (ms) | 85.2 | 42.6 |
| Hook cold p50 (ms) | 84.5 | 39.6 |
| Hook cold p95 (ms) | 86.9 | 44.6 |
| Hook warm p50 (ms) | 77.4 | 36.2 |
| Hook warm p95 (ms) | 87.2 | 41.1 |
<!-- bench-highlights:end -->

Full tables, including 0.1.0 through 0.4.0, are in [BENCHMARK.md](BENCHMARK.md).

## Run the trial

The commands and the cost budget are in [bench/trial/README.md](bench/trial/README.md). Short version, for OpenRouter:

1. Create an OpenRouter key.
2. Locally, export `UNINVENT_BENCH_API_KEY`, `UNINVENT_BENCH_BASE_URL=https://openrouter.ai/api/v1`, and `UNINVENT_BENCH_MODEL` (one id, or several separated by commas).
3. On GitHub, store the same three names. The key is a secret. The base URL and the model may be a secret or a repository variable. Dispatch `.github/workflows/agent-trial.yml` and, to compare models, set the `models` input to `anthropic/claude-sonnet-4.5, openai/gpt-4o-mini`. That input overrides `UNINVENT_BENCH_MODEL` for one run. `dry_run` replays canned files and does not need the key.
4. `npm run trial -- --write-case-study` fills the table above only when the status is `ran`.

The workflow uploads results and diffs. It does not open a pull request and it does not publish to npm. A release runs the trial only when the key is present.
