# Changelog

Versions below 0.4.1 were not published to npm. 0.4.1 is the release line that contains everything on `main` since 0.3.0. The maintainer publishes. This repository does not publish from CI.

## 0.4.1

Unpublished. The package version stays 0.4.1. It is the hook-speed release plus the package sources from 0.4.0, the pull-request action, and the release benchmark, all of which landed after the 0.3.0 commit and have not been published separately.

- **Faster hook.** `uninvent hook` parses JSX without loading Babel on the hot path, and it keeps a V8 compile cache. On the fixed corpus the warm hook is about half the 0.3.0 time. See [BENCHMARK.md](BENCHMARK.md). The hook is still PostToolUse only, silent when the edit is clean, one line per finding, and it never blocks the write.
- **Variant suggestions.** `scan` records `cva()` / `tv()` variants and string-literal unions on a component's props, including a package `.d.ts`. When a raw control's classes point at one option, the same finding line names it (`use <Button variant="destructive" size="sm">`). A variant value the catalog does not list (`variant="danger"`) is one line. A generic class, or a different `className` on a listed value, stays quiet. The catalog version stays 1. New fields stay optional.
- **Package and monorepo design systems** (the 0.4.0 commit). `uninvent.json` `"packages"` scans a workspace package (`packages/ui`, imported as `@acme/ui`) or an installed package that shipped `.d.ts` and JavaScript. `init` notices workspace packages named `ui`, `design-system`, or `ui-kit`. Imports from the package root and from a subpath both count as reuse. The GitHub Action's `working-directory` input is the app inside a monorepo. A catalog from before this field still loads.
- **GitHub Action.** `raframil/uninvent` scans, runs `check --base` on the pull request, writes the markdown report to the job summary, and posts or updates one comment. `fail-on-findings` defaults to false, so a miss does not fail the job. A fork pull request cannot comment. The token is not switched to `pull_request_target`.
- **Release benchmark.** `npm run bench` writes `bench/results/<version>.json` and regenerates [BENCHMARK.md](BENCHMARK.md). Detection is checked twice and must match. The workflow `.github/workflows/benchmark.yml` runs on a published release and on `workflow_dispatch`. It does not need a secret.
- **Real-repository trial.** `bench/trial` runs the same UI task with and without uninvent (init, skill, PostToolUse hook) and scores the diff with `uninvent check --base`. The client is OpenAI-compatible. The primary setup is OpenRouter (`UNINVENT_BENCH_API_KEY`, `UNINVENT_BENCH_BASE_URL`, `UNINVENT_BENCH_MODEL`). The model value may be a comma-separated list. `--dry-run` replays canned files without a key. [CASE_STUDY.md](CASE_STUDY.md) stays pending until a real run writes `bench/trial/results/trial.json`.

## 0.4.0

Package and monorepo design-system sources, as described under 0.4.1. The hook in this commit still loaded the slower parser. Those timings are in `bench/results/0.4.0.json`. Not published.

## 0.3.0

- Storybook states, read statically from CSF and MDX. `uninvent exists` and `uninvent coverage` show them. `check` flags a documented state only when the pattern is specific (a spinner beside `Button` when stories set `loading`, a copied variant class, `disabled` rebuilt with opacity and `pointer-events`).
- `coverage` lists missing stories and exits 0. It is not a failing gate.
- A v0.1 or v0.2 catalog has no `states` field and still loads. `check` does not invent state findings from it.

## 0.2.0

- Composition recipes in `uninvent.recipes.md`. `exists` answers an intent such as "confirm dialog". `check` reports one `rebuilt …` line when a new subtree matches the example without using the components the recipe names, and it does not also list the raw elements inside that subtree.
- `scan` can note a repeated composition. That note is not a finding until someone copies it into the recipe file.

## 0.1.0

- Catalog, `exists`, `check`, the generated skill, and the PostToolUse hook.
- Raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<dialog>`, and `<a role="button">` when the catalog has the matching component, plus a second export of a catalog name.
- Radix primitives, with Base UI recorded on the same adapter map.
