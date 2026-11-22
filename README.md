# uninvent

Storybook and shadcn teach the agent what exists, if it asks. **uninvent checks whether it actually used it.**

Coding agents invent a `<button>`, a `Modal.tsx`, or a second `Button` when the project already has one. uninvent is a local catalog of the design system in the repo, a way to query it, and a quiet check that runs after the agent writes a file. It does not install components, lint color tokens, or decide if the screen looks good.

From `examples/demo-app`:

```text
$ uninvent check
rebuilt Confirm dialog in src/components/Confirm.tsx:7, use ui/Dialog + ui/Button
raw <dialog> in src/components/Modal.tsx:10, use ui/Dialog
reinvented loading on Button in src/components/SaveButton.tsx:11, use ui/Button loading
raw <input> in src/pages/Login.tsx:9, use ui/Input
raw <button> in src/pages/Login.tsx:10, use ui/Button
```

A clean file prints nothing.

## Demo

[`examples/demo-app`](examples/demo-app) is a small Radix, Tailwind, and CVA app in the shadcn shape: `Button`, `Input`, `Dialog`, `PageHeader`, and `Table`. `src/pages/Customers.tsx` uses them. `src/pages/Login.tsx` and `src/components/Modal.tsx` do not. `src/components/Confirm.tsx` rebuilds the confirm-dialog recipe from a raw `<dialog>` and two buttons. `src/components/SaveButton.tsx` puts a spinner inside `Button`, which already has a `loading` state in its stories.

From `examples/demo-app`:

```text
$ uninvent scan
16 components, 3 stories, 6 states, 1 recipe, catalog written to .uninvent/catalog.json

$ uninvent exists "loading button"
Button  src/components/ui/button.tsx:39
  state: loading  story Loading
  import { Button } from "@/components/ui/button";

$ uninvent exists "confirm dialog"
Confirm dialog  recipe confirm-dialog
  Ask before a destructive action. A title, a description, and a cancel/confirm Button row.
  uses: Dialog, DialogContent, DialogTitle, DialogDescription, Button
  import { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
  import { Button } from "@/components/ui/button";

$ uninvent exists Dialog
Dialog  src/components/ui/dialog.tsx:5
  import { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
  props: open?, onOpenChange?, children?
  primitives: radix (@radix-ui/react-dialog)
  states: open (Open)
  stories: src/components/ui/dialog.stories.tsx
  also: DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription

$ uninvent check src/pages/Customers.tsx
# no output, exit 0
```

There is no GIF in the repo yet. [`scripts/record-demo.sh`](scripts/record-demo.sh) plays that demo in the terminal. With [vhs](https://github.com/charmbracelet/vhs) installed, `vhs scripts/demo.tape` records it to `docs/demo.gif` (dark theme, a short GIF). Crop to the terminal. The interesting frame is the `check` line that names the confirm-dialog recipe, then the loading line, then the clean file that prints nothing.

The demo does not need its own `npm install`. From this repo, after `npm install` and `npm run build`:

```bash
node dist/cli.js scan --cwd examples/demo-app
node dist/cli.js check --cwd examples/demo-app
```

## Install

Node 20 or newer.

```bash
npm install -D uninvent
npx uninvent init
npx uninvent install
```

`init` writes `uninvent.json`, adds `.uninvent/` to `.gitignore`, scans, and generates a project skill:

- `.claude/skills/uninvent/SKILL.md`
- `.cursor/skills/uninvent/SKILL.md`
- `.agents/skills/uninvent/SKILL.md`
- a marked block in `AGENTS.md`

The skill names the components that were actually scanned, the declared recipes, and the states stories document. It tells the agent to run `uninvent exists <Component>` before creating UI. `scan` refreshes that skill when it is already there.

`install` adds a **PostToolUse** hook for Claude Code (`.claude/settings.json`) and Cursor (`.cursor/hooks.json`). It merges into the files you already have. The hook runs after an edit, reads the catalog, and:

- prints nothing when the edit is clean
- on a miss, adds one line per finding and nothing else, for example `raw <button> in src/Form.tsx:42, use ui/Button`

That line is the whole message the agent sees. The hook does not block the write. PreToolUse is off unless you pass `--pre`, and even then it only warns.

Inside this repo the demo hook points at `../../node_modules/.bin/uninvent`, which `npm run build` creates. In an app that depends on uninvent, `install` points at `node_modules/.bin/uninvent` instead.

## Commands

| Command | What it does |
|---|---|
| `uninvent init` | Config, gitignore, first scan, skill. `--commit` keeps the catalog in git. `--ui <dir>` sets a design-system folder. `--package <name>` adds a package. |
| `uninvent scan` | Rebuild `.uninvent/catalog.json`. |
| `uninvent exists <name>` | A component, a recipe (`confirm dialog`), or a documented state (`loading button`). Exit 1 when nothing matches. |
| `uninvent check [path...]` | Report reinvented UI. Exit 1 when there is a miss. |
| `uninvent coverage [name]` | Which variants and states have stories. Exit 0. Not a failing gate. |
| `uninvent install` | Hook for Claude Code, Cursor, or both. `--pre` also installs PreToolUse. |
| `uninvent hook` | The hook entrypoint. Reads a tool event on stdin. |

`check` accepts `--base <ref>` and reads `git diff <ref>...HEAD`, so a pull request can be checked without scanning the whole tree. `--format` is `text` (default), `json`, or `markdown`.

Text is the short lines, and it is empty when every file is clean. JSON and markdown always include the reuse / invent counts, which is what you want on a pull request:

```markdown
## uninvent

**reuse 12 / invent 5**

- rebuilt `Confirm dialog` in `src/components/Confirm.tsx:7`, use `ui/Dialog` + `ui/Button`
- raw `<dialog>` in `src/components/Modal.tsx:10`, use `ui/Dialog`
- reinvented `loading` on `Button` in `src/components/SaveButton.tsx:11`, use `ui/Button loading`
- raw `<input>` in `src/pages/Login.tsx:9`, use `ui/Input`
- raw `<button>` in `src/pages/Login.tsx:10`, use `ui/Button`

Reused: Button, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow
```

`reuse` counts JSX tags imported from the catalog. `invent` counts the misses below. uninvent does not rewrite the file.

### What counts as inventing

Four rules. The last one only fires when a story already documented the state:

1. A raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<dialog>`, or `<a role="button">` in app code, when the catalog has `Button`, `Input`, `Textarea`, `Select`, or `Dialog`. The match is the component name. A Base UI wrapper and a Radix wrapper are the same miss.
2. A new export whose name matches a catalog component (`export function Button` outside `components/ui`).
3. A small subtree that rebuilds a declared recipe from the raw elements in its example, without using the components that recipe names. One line names the recipe. The raw elements inside that subtree are not listed again.
4. A documented state rebuilt around a catalog component. A spinner inside or directly beside `<Button>` when Button's stories set `loading` and the JSX does not pass it. A `className` that copies every class of one non-default variant option the stories show, when that prop is not set. `opacity-50` together with `pointer-events-none` when the stories set `disabled` and the JSX does not. Anything less specific is silence.

A `<div>` is not a miss. A file named `Modal.tsx` is not a miss by itself — the native `<dialog>` inside it is, and the suggestion is `ui/Dialog`. A `<dialog>` with one button is not a confirm dialog. Files inside the design-system folder or package, stories, and tests are skipped. uninvent does not guess that a custom card is "80% our Card".

## CI

The catalog is gitignored by default, so CI scans and then checks the pull request diff. `check` exits 1 when it finds a miss. The action in this repo does not fail the job for that. It writes the markdown report to the job summary and posts or updates one comment.

```yaml
name: uninvent

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: raframil/uninvent@v0.3.0
        with:
          version: 0.3.0
          # working-directory: apps/web
```

`fetch-depth: 0` gives git the history for `check --base`. The action fetches the base commit when the checkout does not have it. Node 20 or newer has to be on `PATH`. `setup-node` is the straightforward way.

The action is not on the Marketplace. `uses` points at a tag or commit of this repository. `version` is what `npm install` installs. v0.3 is not on npm yet, so pin both once a release exists. This repository runs the action on every pull request against [`examples/demo-app`](examples/demo-app), from [`.github/workflows/uninvent.yml`](.github/workflows/uninvent.yml). That workflow builds first and passes `version: local`, which runs `dist/cli.js` from the checkout.

| Input | Default | What it does |
|---|---|---|
| `working-directory` | `.` | Directory with `uninvent.json`. Set it for a package in a monorepo. |
| `version` | this action's `package.json` version | An npm version, `latest`, or `local`. Empty uses `dist/cli.js` when the checkout has one. |
| `fail-on-findings` | `false` | `true` fails the job when `check` exits 1. A scan or usage error still fails either way. |
| `comment` | `true` | `false` skips the comment. The job summary is still written. |
| `token` | `github.token` | Reads and writes the one comment. |
| `base` | pull request base SHA | Passed through to `check --base`. |

The comment is the markdown report. A hidden HTML marker makes the next push edit that comment instead of adding another. An unchanged report is left alone. A clean diff stays short: the counts, `Nothing reinvented.`, and the names that were reused. Each `working-directory` keeps its own comment, so two packages get two comments and each one updates in place. Two runs that start together can both create; [the workflow in this repo](.github/workflows/uninvent.yml) cancels the older run on that pull request.

Same-repository pull requests can comment with the default `GITHUB_TOKEN` when the workflow sets `pull-requests: write`. A pull request from a fork gets a read-only token on `pull_request`. The action skips the comment, leaves the report in the job summary, and does not fail. `pull_request_target` would have a write token, and it is the wrong event here. The workflow runs from the base branch with that token, and `scan` reads whatever you checked out. Checking out the fork head would run untrusted code with permission to write to the repository. This action does not check out code and does not switch the event.

To run the commands yourself, and to fail the job on the first miss:

```yaml
- name: Design system reuse
  run: |
    set -o pipefail
    npx uninvent scan
    npx uninvent check --base "origin/${{ github.base_ref }}" --format markdown | tee "$GITHUB_STEP_SUMMARY"
```

`check` exits 1, so that step is red when something was reinvented. The action is not, unless `fail-on-findings` is true.

To keep the catalog in git (slower monorepos, or a hook that must not rescan):

```bash
npx uninvent init --commit
```

That leaves `.uninvent/catalog.json` un-ignored. Remove the `.uninvent/` line from `.gitignore` if an earlier `init` added it.

## Catalog

`scan` writes `.uninvent/catalog.json`. It is a normal JSON file, version 1. For each exported component it stores the file, the import specifier (from `tsconfig` paths and `components.json`), own props, `cva()` / `tv()` variants and defaults, the class string of a variant option when it was a string literal, headless primitives, the intrinsic element when the source says so (`<button>`, or `asChild ? Slot : "button"`), sibling story files, the states those stories document, and CSS variables declared in the stylesheet from `components.json`.

Primitives come from a small adapter map in `src/primitives.ts`. Each hit is `{ library, package }`. Built in today:

| Library id | Import specifiers |
|---|---|
| `radix` | `@radix-ui/*` |
| `base-ui` | `@base-ui/react` and `@base-ui/react/*`, plus the older `@base-ui-components/react` |
| `react-aria` | `react-aria`, `react-aria-components`, `@react-aria/*` |
| `ark` | `@ark-ui/react` |

Another headless library is one entry on that list. `check` does not read it. The raw-element rule only cares that the catalog has a component with the matching name.

Recipes live on the same catalog, under `recipes`. A v0.1 catalog has no such field and still loads. `scan` fills it from [`uninvent.recipes.md`](examples/demo-app/uninvent.recipes.md) and from repeated compositions it is willing to name. See [Recipes](#recipes).

Scanning uses the TypeScript compiler API and does not typecheck the app, so it works on the fixture without installing React. `check` and the hook parse JSX with Babel and only read the JSON catalog, so they stay small enough to run on every edit.

Discovery looks at `uninvent.json` `"ui"`, then `components.json` `aliases.ui`, then `src/components/ui` and `components/ui`. Packages listed under `"packages"` are scanned too. See [Packages](#packages).

## Packages

The design system does not have to live in `components/ui`. It can be a workspace package (`packages/ui`, imported as `@acme/ui`) or a package in `node_modules` that shipped compiled JavaScript and `.d.ts` files.

```json
{
  "ui": ["src/components/ui"],
  "packages": ["@acme/ui"]
}
```

An entry is a package name (`@acme/ui`, `ui`) or a path to the package directory (`packages/ui`). `--package` repeats the same way `--ui` does. An empty `"ui"` array still searches the usual local folders. `"packages"` adds sources on top of that search.

`init` reads `pnpm-workspace.yaml` and the `workspaces` field npm and yarn use, walking up from the directory you started in. A workspace package is added when its name ends in `ui`, `design-system`, or `ui-kit`. From an app, that package also has to be a dependency of the app. An installed dependency with one of those names is added the same way. A package with any other name is a line you write yourself. An existing `uninvent.json` keeps its list until you pass `--package` or `--force`.

`scan` follows the package `exports` map, or `types` / `main` when there is no `exports`. It reads `.tsx` and `.ts` when those files exist, including `src/` when `exports` points at `dist/`. A package that only has declarations is read from the `.d.ts`: exported components, their props, and string-literal unions such as `variant?: "default" | "outline"`. `cva()` / `tv()` variants, stories, and recipes are recorded when those files are in the package. A catalog written before package sources has no `packages` key and still loads.

The import uninvent prints is a public specifier. A component re-exported from the package root is imported from `@acme/ui`. A component that is only a subpath is imported from `@acme/ui/button`. Both count as reuse, and so does `import { Button } from "@acme/ui/button"` when the root exports it too. `check`, `exists`, the generated skill, `AGENTS.md`, and the hook use that specifier. The suggestion for a package component names the specifier (`@acme/ui Button`). A local `components/ui` component keeps `ui/Button`. When the same name exists in both, the raw-element suggestion stays on the local one. An import from the package still counts as reuse of the package component.

The package directory is skipped, including when you run uninvent at the repo root and the source is `packages/ui`. Running it in the app resolves the package from that app's `node_modules` or from the workspace above it. Recipes are the `uninvent.recipes.md` next to the `uninvent.json` for that run.

A workspace package is preferred over a `node_modules` copy of the same name, so the monorepo scans the source you edit. Set the entry to `node_modules/@acme/ui` when you want the installed build.

## Recipes

A recipe is how this project assembles components it already has. A confirm dialog is a `Dialog`, a title, and a `Button` row.

The source of truth is `uninvent.recipes.md`, next to `uninvent.json`. It is meant to be committed and edited by hand. `scan` copies it into the catalog. Check reads the catalog, so run `scan` again after editing the file.

````md
## Confirm dialog

intents: confirm dialog, confirmation dialog, are you sure
uses: Dialog, DialogContent, DialogTitle, DialogDescription, Button
summary: Ask before a destructive action. A title, a description, and a cancel/confirm Button row.

```tsx
<Dialog>
  <DialogContent>
    <DialogTitle>Delete customer?</DialogTitle>
    <DialogDescription>This cannot be undone.</DialogDescription>
    <Button variant="outline">Cancel</Button>
    <Button>Delete</Button>
  </DialogContent>
</Dialog>
```
````

`intents` are the phrases `exists` matches. The heading is an intent too. `uses` names catalog components. The fenced example is the pattern `check` compares against. A `div` in the example is only a wrapper. A `label`, heading, or `p` is part of the pattern, so keep the example to the composition.

`exists "confirm dialog"` prints the recipe, the imports, and the example. `exists Dialog` still prints the component. A single token that is exactly a component name stays on that component.

`check` reports a rebuild only when the recipe was declared, the example has at least two concrete signals, one of those signals is a catalog component standing in for a raw element (`Dialog` for `<dialog>`, `Button` for `<button>`, `Input` for `<input>`), and the new subtree matches that shape without already using those components. The line replaces the raw-element lines it explains:

```text
rebuilt Confirm dialog in src/components/Confirm.tsx:7, use ui/Dialog + ui/Button
```

`scan` also notices an exact set of catalog components used in two or more app files, drawn from two or more UI modules. It records that set on the catalog as `source: "detected"` and prints one hint. It does not flag it, and the skill does not list it. Copy it into `uninvent.recipes.md` when it is a real pattern. A set already covered by a declared recipe is skipped.

The generated skill and the `AGENTS.md` block list each declared recipe in one line.

## States

Storybook is where a design system shows which states a component supports. `scan` reads that statically. It does not start Storybook, and it does not need Storybook installed. A project with no story files scans, checks, and writes the skill the same way it did before.

Story files it reads:

- CSF in `*.stories.tsx`, `*.stories.ts`, `*.stories.jsx`, and `*.stories.js`
- MDX in `*.stories.mdx` (`<Meta>`, `<Story name>` or `<Story of>`, and the JSX inside the story)

For each story it keeps the export name and the literal args or JSX props: a variant or size, and booleans such as `loading`, `disabled`, and `invalid`. Those are matched against the props and `cva()` / `tv()` options already on the component. The result is `states` on that component. A story named `Loading` with no literal arg is recorded too, but `check` only trusts a state when the story sets the prop or the component actually has it. `children`, `className`, and event handlers are not states.

`states` and `storyDocs` are absent on a v0.1 or v0.2 catalog. Readers still load that file. `check` does not invent state findings from it. Run `scan` again to fill them in.

```text
$ uninvent exists Button
  states: disabled (Disabled), loading (Loading), variant=default (Primary), variant=destructive (Destructive)

$ uninvent coverage Button
Button  src/components/ui/button.tsx
  variant=default  Primary
  variant=destructive  Destructive
  variant=outline  —
  ...
  loading  Loading
  disabled  Disabled

4 documented. 8 without a story. Coverage is informational and does not fail the check.
```

`coverage` exits 0 even when stories are missing. It is not a CI gate. `check` is the gate, and it only adds a line when the pattern is specific. From the demo:

```text
reinvented loading on Button in src/components/SaveButton.tsx:11, use ui/Button loading
```

A copied variant class uses the same shape: `reinvented variant=destructive on Button in src/Form.tsx:4, use ui/Button variant="destructive"`.

A spinner in another branch of the tree, a partial class (`bg-destructive` without the rest of the option), a variant prop that is already set, or a `<Spinner>` that is itself in the catalog: no line. The hook prints the same line, or nothing.

## Supported stack

uninvent understands React + TypeScript files in a shadcn-style folder: Radix or Base UI primitives (React Aria and Ark are on the same adapter map), Tailwind (v3 `theme.extend` or v4 `@theme`), and variants from `class-variance-authority` or `tailwind-variants`. Story files are parsed for the states they document, not generated. The demo app wraps Radix. `tests/fixtures/base-ui` is the same check against shadcn's Base UI wrappers. `tests/fixtures/stories` covers CSF, a `.stories.ts` file, and MDX.

Not in this version: Vue, CSS-in-JS, an MCP server, autofix, and token linting. A recipe with no example, or an example that is not a small concrete shape, is listed by `exists` and the skill and is not flagged. Coverage does not fail a build.

## Related tools

| Tool | What it is for | What uninvent is for |
|---|---|---|
| [Storybook MCP](https://storybook.js.org/docs/ai/mcp/overview) | Docs and stories, when Storybook is up or a build manifest exists. | An offline catalog, a check on the diff, a hook on the write. |
| [shadcn MCP](https://ui.shadcn.com/docs/mcp) | Find and install registry items. | Watch the `ui` folder that is already in the repo, including components that were never published. |
| [craft](https://github.com/diego3g/craft) | The design process: brief, states, sync with the tool. | The code the agent just wrote. |
| [ds-canon](https://github.com/jtrainer357/ds-canon) | An authored canon over MCP, plus drift. | No MCP in v0.1. The check and the hook come first. |
| [ReuseGate](https://github.com/SuperMarioYL/reusegate) | A generic gate on symbols. | UI only: CVA, Radix, Base UI, raw controls, design-system names. |
| Buoy, design-lint, remediation | Loose tokens and one-off values. | Not this. uninvent records CSS variables and then leaves them alone. |

## Benchmark

[BENCHMARK.md](BENCHMARK.md) compares versions on a fixed corpus. 0.4.0 catches 4/4 raw controls, 2/2 recipes, 6/6 documented states, 2/2 name collisions, and 3/3 package sources, with 0 false positives on 13 clean files. 0.1.0 catches the raw controls and the name collisions. 0.2.0 adds recipes. 0.3.0 adds documented states. `npm run bench` reproduces the numbers. A live agent trial runs only if you set `UNINVENT_BENCH_API_KEY`.

## Development

```bash
npm install
npm test
npm run build
```

`npm test` is the TypeScript compiler plus the Node test runner. The tests scan the demo, assert that `Customers.tsx` is silent, and assert that the login page, `Modal.tsx`, `Confirm.tsx`, and `SaveButton.tsx` are not. `tests/fixtures/recipes` covers recipes. `tests/fixtures/stories` covers story parsing, `exists`, `coverage`, and the state check. `tests/fixtures/workspace` is a pnpm-style workspace with `packages/ui` and an app. `tests/fixtures/installed` is a package that exists only as `.d.ts` and compiled JavaScript under `node_modules`. `tests/action.test.ts` covers the sticky pull request comment: create, update, a clean report, and a fork pull request where the token cannot write.

Publishing: `package.json` is set up for a public npm package (`prepublishOnly` builds `dist/`). v0.4 has not been published.

## Status

v0.4. The catalog, recipes, documented states, package sources, `exists`, `coverage`, `check`, the generated skill, and the PostToolUse hook are the product. The GitHub Action posts the markdown `check` report on a pull request. Coverage lists missing stories. It does not write them.

## License

[MIT](LICENSE) © 2026 raframil
