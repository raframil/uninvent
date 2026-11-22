# uninvent

Storybook and shadcn teach the agent what exists, if it asks. **uninvent checks whether it actually used it.**

Coding agents invent a `<button>`, a `Modal.tsx`, or a second `Button` when the project already has one. uninvent is a local catalog of the design system in the repo, a way to query it, and a quiet check that runs after the agent writes a file. It does not install components, lint color tokens, or decide if the screen looks good.

From `examples/demo-app`:

```text
$ uninvent check
rebuilt Confirm dialog in src/components/Confirm.tsx:7, use ui/Dialog + ui/Button
raw <dialog> in src/components/Modal.tsx:10, use ui/Dialog
raw <input> in src/pages/Login.tsx:9, use ui/Input
raw <button> in src/pages/Login.tsx:10, use ui/Button
```

A clean file prints nothing.

## Demo

[`examples/demo-app`](examples/demo-app) is a small Radix, Tailwind, and CVA app in the shadcn shape: `Button`, `Input`, `Dialog`, `PageHeader`, and `Table`. `src/pages/Customers.tsx` uses them. `src/pages/Login.tsx` and `src/components/Modal.tsx` do not. `src/components/Confirm.tsx` rebuilds the confirm-dialog recipe from a raw `<dialog>` and two buttons.

From `examples/demo-app`:

```text
$ uninvent scan
16 components, 2 stories, 1 recipe, catalog written to .uninvent/catalog.json

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
  stories: src/components/ui/dialog.stories.tsx
  also: DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription

$ uninvent check src/pages/Customers.tsx
# no output, exit 0
```

There is no GIF in the repo yet. [`scripts/record-demo.sh`](scripts/record-demo.sh) plays that demo in the terminal. With [vhs](https://github.com/charmbracelet/vhs) installed, `vhs scripts/demo.tape` records it to `docs/demo.gif` (dark theme, a short GIF). Crop to the terminal. The interesting frame is the `check` line that names the confirm-dialog recipe, then the clean file that prints nothing.

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

The skill names the components that were actually scanned, and the declared recipes. It tells the agent to run `uninvent exists <Component>` before creating UI. `scan` refreshes that skill when it is already there.

`install` adds a **PostToolUse** hook for Claude Code (`.claude/settings.json`) and Cursor (`.cursor/hooks.json`). It merges into the files you already have. The hook runs after an edit, reads the catalog, and:

- prints nothing when the edit is clean
- on a miss, adds one line per finding and nothing else, for example `raw <button> in src/Form.tsx:42, use ui/Button`

That line is the whole message the agent sees. The hook does not block the write. PreToolUse is off unless you pass `--pre`, and even then it only warns.

Inside this repo the demo hook points at `../../node_modules/.bin/uninvent`, which `npm run build` creates. In an app that depends on uninvent, `install` points at `node_modules/.bin/uninvent` instead.

## Commands

| Command | What it does |
|---|---|
| `uninvent init` | Config, gitignore, first scan, skill. `--commit` keeps the catalog in git. `--ui <dir>` sets the design-system folder. |
| `uninvent scan` | Rebuild `.uninvent/catalog.json`. |
| `uninvent exists <name>` | A component, or a recipe when the query is a phrase (`confirm dialog`). Exit 1 when nothing matches. |
| `uninvent check [path...]` | Report reinvented UI. Exit 1 when there is a miss. |
| `uninvent install` | Hook for Claude Code, Cursor, or both. `--pre` also installs PreToolUse. |
| `uninvent hook` | The hook entrypoint. Reads a tool event on stdin. |

`check` accepts `--base <ref>` and reads `git diff <ref>...HEAD`, so a pull request can be checked without scanning the whole tree. `--format` is `text` (default), `json`, or `markdown`.

Text is the short lines, and it is empty when every file is clean. JSON and markdown always include the reuse / invent counts, which is what you want on a pull request:

```markdown
## uninvent

**reuse 11 / invent 4**

- rebuilt `Confirm dialog` in `src/components/Confirm.tsx:7`, use `ui/Dialog` + `ui/Button`
- raw `<dialog>` in `src/components/Modal.tsx:10`, use `ui/Dialog`
- raw `<input>` in `src/pages/Login.tsx:9`, use `ui/Input`
- raw `<button>` in `src/pages/Login.tsx:10`, use `ui/Button`

Reused: Button, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow
```

`reuse` counts JSX tags imported from the catalog. `invent` counts the misses below. uninvent does not rewrite the file.

### What counts as inventing

Two rules, both exact:

1. A raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<dialog>`, or `<a role="button">` in app code, when the catalog has `Button`, `Input`, `Textarea`, `Select`, or `Dialog`. The match is the component name. A Base UI wrapper and a Radix wrapper are the same miss.
2. A new export whose name matches a catalog component (`export function Button` outside `components/ui`).
3. A small subtree that rebuilds a declared recipe from the raw elements in its example, without using the components that recipe names. One line names the recipe. The raw elements inside that subtree are not listed again.

A `<div>` is not a miss. A file named `Modal.tsx` is not a miss by itself — the native `<dialog>` inside it is, and the suggestion is `ui/Dialog`. A `<dialog>` with one button is not a confirm dialog. Files inside the design-system folder, stories, and tests are skipped. uninvent does not guess that a custom card is "80% our Card".

## CI

The catalog is gitignored by default, so CI scans and then checks the pull-request diff. Exit code 1 fails the job. Markdown is a reasonable pull-request comment; a bot that posts it can come later.

```yaml
- name: Design system reuse
  run: |
    set -o pipefail
    npx uninvent scan
    npx uninvent check --base "origin/${{ github.base_ref }}" --format markdown | tee "$GITHUB_STEP_SUMMARY"
```

To keep the catalog in git (slower monorepos, or a hook that must not rescan):

```bash
npx uninvent init --commit
```

That leaves `.uninvent/catalog.json` un-ignored. Remove the `.uninvent/` line from `.gitignore` if an earlier `init` added it.

## Catalog

`scan` writes `.uninvent/catalog.json`. It is a normal JSON file, version 1. For each exported component it stores the file, the import specifier (from `tsconfig` paths and `components.json`), own props, `cva()` / `tv()` variants and defaults, headless primitives, the intrinsic element when the source says so (`<button>`, or `asChild ? Slot : "button"`), sibling story files, and CSS variables declared in the stylesheet from `components.json`.

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

Discovery looks at `uninvent.json` `"ui"`, then `components.json` `aliases.ui`, then `src/components/ui` and `components/ui`.

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

## Supported stack

uninvent understands React + TypeScript files in a shadcn-style folder: Radix or Base UI primitives (React Aria and Ark are on the same adapter map), Tailwind (v3 `theme.extend` or v4 `@theme`), and variants from `class-variance-authority` or `tailwind-variants`. Story files are recorded, not generated. The demo app wraps Radix. `tests/fixtures/base-ui` is the same check against shadcn's Base UI wrappers.

Not in this version: Vue, CSS-in-JS, multi-package monorepos, Storybook state coverage, an MCP server, autofix, and token linting. A recipe with no example, or an example that is not a small concrete shape, is listed by `exists` and the skill and is not flagged.

## Related tools

| Tool | What it is for | What uninvent is for |
|---|---|---|
| [Storybook MCP](https://storybook.js.org/docs/ai/mcp/overview) | Docs and stories, when Storybook is up or a build manifest exists. | An offline catalog, a check on the diff, a hook on the write. |
| [shadcn MCP](https://ui.shadcn.com/docs/mcp) | Find and install registry items. | Watch the `ui` folder that is already in the repo, including components that were never published. |
| [craft](https://github.com/diego3g/craft) | The design process: brief, states, sync with the tool. | The code the agent just wrote. |
| [ds-canon](https://github.com/jtrainer357/ds-canon) | An authored canon over MCP, plus drift. | No MCP in v0.1. The check and the hook come first. |
| [ReuseGate](https://github.com/SuperMarioYL/reusegate) | A generic gate on symbols. | UI only: CVA, Radix, Base UI, raw controls, design-system names. |
| Buoy, design-lint, remediation | Loose tokens and one-off values. | Not this. uninvent records CSS variables and then leaves them alone. |

## Development

```bash
npm install
npm test
npm run build
```

`npm test` is the TypeScript compiler plus the Node test runner. The tests scan the demo, assert that `Customers.tsx` is silent, and assert that the login page, `Modal.tsx`, and `Confirm.tsx` are not. `tests/fixtures/recipes` covers recipe parsing, repeated-composition detection, `exists`, and `check`.

Publishing: `package.json` is set up for a public npm package (`prepublishOnly` builds `dist/`). v0.2 has not been published.

## Status

v0.2. The catalog, recipes, `exists`, `check`, the generated skill, and the PostToolUse hook are the product. Suggested Storybook stories for missing states come after this.

## License

[MIT](LICENSE) © 2026 raframil
