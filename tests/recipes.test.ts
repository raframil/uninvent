import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCatalog, writeCatalog } from "../src/catalog.js";
import { analyzeSource } from "../src/check/analyze.js";
import { formatMarkdown } from "../src/check/format.js";
import { checkProject } from "../src/check/run.js";
import { loadConfig } from "../src/config.js";
import { renderExists } from "../src/exists.js";
import { detectFromFiles } from "../src/recipes/detect.js";
import { finalizeRecipes, parseRecipes } from "../src/recipes/parse.js";
import { scanCommand } from "../src/project.js";
import { renderAgentsBlock, renderSkill } from "../src/skill.js";
import type { Recipe } from "../src/types.js";
import { buttonComponent, repoRoot, sampleCatalog, sampleConfig, tempDir } from "./helpers.js";

const fixture = path.join(repoRoot, "tests/fixtures/recipes");

const confirmExample = `<Dialog>
  <DialogContent>
    <DialogTitle>Delete customer?</DialogTitle>
    <Button>Cancel</Button>
    <Button>Delete</Button>
  </DialogContent>
</Dialog>`;

const fieldExample = `<div>
  <label htmlFor="email">Email</label>
  <Input id="email" />
  <p>Enter a valid email.</p>
</div>`;

function confirmRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "confirm-dialog",
    title: "Confirm dialog",
    intents: ["Confirm dialog", "confirm dialog", "are you sure"],
    uses: ["Dialog", "DialogContent", "Button"],
    summary: "Ask before a destructive action.",
    example: confirmExample,
    source: "declared",
    file: "uninvent.recipes.md",
    ...overrides,
  };
}

function fieldRecipe(): Recipe {
  return {
    id: "form-field",
    title: "Form field",
    intents: ["Form field", "form field", "labeled input"],
    uses: ["Input"],
    summary: "A label, an Input, and a short error line.",
    example: fieldExample,
    source: "declared",
    file: "uninvent.recipes.md",
  };
}

function recipeCatalog(recipes: Recipe[] = [confirmRecipe(), fieldRecipe()]) {
  const catalog = sampleCatalog([
    buttonComponent(),
    buttonComponent({
      name: "Dialog",
      file: "src/components/ui/dialog.tsx",
      importPath: "@/components/ui/dialog",
      elements: [],
      variants: [],
      primitives: [{ library: "radix", package: "@radix-ui/react-dialog" }],
      props: [],
    }),
    buttonComponent({
      name: "DialogContent",
      file: "src/components/ui/dialog.tsx",
      importPath: "@/components/ui/dialog",
      elements: [],
      variants: [],
      primitives: [],
      props: [],
    }),
    buttonComponent({
      name: "Input",
      file: "src/components/ui/input.tsx",
      importPath: "@/components/ui/input",
      elements: ["input"],
      variants: [],
      primitives: [],
      props: [],
    }),
  ]);
  catalog.recipes = recipes;
  return catalog;
}

test("parses a recipe file and ignores prose outside sections", () => {
  const parsed = parseRecipes(`# Recipes

Patterns this project already uses.

## Confirm dialog

intents: confirm dialog, are you sure
uses: Dialog, Button
summary: Ask first.
note: this is not a field

\`\`\`tsx
<Dialog>
  <Button>Cancel</Button>
  <Button>Delete</Button>
</Dialog>
\`\`\`

## Confirm dialog

uses: Dialog
`);
  assert.equal(parsed.recipes.length, 1);
  assert.equal(parsed.recipes[0]?.id, "confirm-dialog");
  assert.equal(parsed.recipes[0]?.title, "Confirm dialog");
  assert.deepEqual(parsed.recipes[0]?.intents, ["Confirm dialog", "are you sure"]);
  assert.deepEqual(parsed.recipes[0]?.uses, ["Dialog", "Button"]);
  assert.equal(parsed.recipes[0]?.summary, "Ask first.");
  assert.match(parsed.recipes[0]?.example ?? "", /<Button>Delete<\/Button>/);
  assert.equal(parsed.recipes[0]?.source, "declared");
  assert.ok(parsed.warnings.some((warning) => warning.includes("unknown field")));
  assert.ok(parsed.warnings.some((warning) => warning.includes("duplicate recipe")));
});

test("fills uses from the example and warns when a name is not in the catalog", () => {
  const parsed = parseRecipes(`## Save dialog

\`\`\`tsx
<Dialog>
  <Button>Save</Button>
</Dialog>
\`\`\`

## Ghost

uses: FormField
`);
  const catalog = recipeCatalog([]);
  const finalized = finalizeRecipes(parsed.recipes, catalog.components);
  assert.deepEqual(
    finalized.recipes.map((recipe) => recipe.id),
    ["save-dialog", "ghost"],
  );
  assert.deepEqual(finalized.recipes[0]?.uses, ["Dialog", "Button"]);
  assert.match(finalized.recipes[0]?.summary ?? "", /Uses Dialog and Button/);
  assert.deepEqual(finalized.recipes[1]?.uses, ["FormField"]);
  assert.ok(finalized.warnings.some((warning) => warning.includes("FormField")));
  const dropped = finalizeRecipes(parseRecipes("## Empty\n").recipes, catalog.components);
  assert.deepEqual(dropped.recipes, []);
  assert.ok(dropped.warnings.some((warning) => warning.includes("names no components")));
});

test("an unclosed fence is a warning and does not throw", () => {
  const parsed = parseRecipes("## Confirm dialog\n\nuses: Dialog, Button\n\n```tsx\n<Dialog />\n");
  assert.equal(parsed.recipes.length, 1);
  assert.equal(parsed.recipes[0]?.example, undefined);
  assert.ok(parsed.warnings.some((warning) => warning.includes("unclosed")));
});

test("v0.1 catalogs load with an empty recipe list", () => {
  const root = tempDir();
  mkdirSync(path.join(root, ".uninvent"), { recursive: true });
  writeFileSync(
    path.join(root, ".uninvent/catalog.json"),
    JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      paths: [],
      components: [buttonComponent()],
      tokens: [],
    }),
  );
  const catalog = readCatalog(root, ".uninvent/catalog.json");
  assert.deepEqual(catalog.recipes, []);
  writeCatalog(root, ".uninvent/catalog.json", catalog);
  const roundTrip = readCatalog(root, ".uninvent/catalog.json");
  assert.deepEqual(roundTrip.recipes, []);
});

test("exists answers an intent with the recipe and still answers a component name", () => {
  const catalog = recipeCatalog();
  const recipe = renderExists(catalog, "confirm dialog");
  assert.equal(recipe.found, true);
  assert.match(recipe.text, /^Confirm dialog  recipe confirm-dialog\n/);
  assert.match(recipe.text, /uses: Dialog, DialogContent, Button/);
  assert.match(recipe.text, /import \{ Dialog, DialogContent \} from "@\/components\/ui\/dialog";/);
  assert.match(recipe.text, /import \{ Button \} from "@\/components\/ui\/button";/);
  assert.match(recipe.text, /<DialogTitle>Delete customer\?<\/DialogTitle>/);

  const intent = renderExists(catalog, "are you sure");
  assert.match(intent.text, /^Confirm dialog  recipe confirm-dialog\n/);

  const component = renderExists(catalog, "Dialog");
  assert.match(component.text, /^Dialog  src\/components\/ui\/dialog\.tsx:\d+\n/);
  assert.equal(component.text.includes("recipe"), false);

  const missing = renderExists(catalog, "toaster");
  assert.equal(missing.found, false);
});

test("check flags a rebuilt recipe once and leaves nearby raw elements alone", () => {
  const catalog = recipeCatalog();
  const config = sampleConfig();
  const rebuilt = analyzeSource({
    source: `export function Confirm() {
      return (
        <dialog open>
          <h2>Delete?</h2>
          <button>Cancel</button>
          <button>Delete</button>
        </dialog>
      );
    }`,
    file: "src/components/Confirm.tsx",
    catalog,
    config,
  });
  assert.deepEqual(
    rebuilt.findings.map((finding) => finding.message.replace(/:\d+,/, ":N,")),
    ["rebuilt Confirm dialog in src/components/Confirm.tsx:N, use ui/Dialog + ui/Button"],
  );

  const bare = analyzeSource({
    source: `export function Confirm() {
      return (
        <dialog open>
          <button>Cancel</button>
          <button>Delete</button>
        </dialog>
      );
    }`,
    file: "src/components/Confirm.tsx",
    catalog: recipeCatalog([]),
    config,
  });
  assert.equal(bare.findings.some((finding) => finding.kind === "recipe"), false);
  assert.equal(bare.findings.length, 3);

  const notice = analyzeSource({
    source: `export function Notice() { return <dialog open><button>Ok</button></dialog>; }`,
    file: "src/components/Notice.tsx",
    catalog,
    config,
  });
  assert.deepEqual(
    notice.findings.map((finding) => finding.kind),
    ["raw-element", "raw-element"],
  );

  const composed = analyzeSource({
    source: `import { Button } from "@/components/ui/button";
      import { Dialog, DialogContent } from "@/components/ui/dialog";
      export function Delete() {
        return <Dialog><DialogContent><Button>Cancel</Button><Button>Delete</Button></DialogContent></Dialog>;
      }`,
    file: "src/pages/Delete.tsx",
    catalog,
    config,
  });
  assert.equal(composed.findings.length, 0);

  const partial = analyzeSource({
    source: `import { Button } from "@/components/ui/button";
      export function Partial() {
        return <dialog open><Button>Cancel</Button><button>Delete</button></dialog>;
      }`,
    file: "src/pages/Partial.tsx",
    catalog,
    config,
  });
  assert.equal(partial.findings.some((finding) => finding.kind === "recipe"), false);
  assert.ok(partial.findings.some((finding) => finding.element === "dialog"));
  assert.ok(partial.findings.some((finding) => finding.element === "button"));

  const field = analyzeSource({
    source: `export function Email() {
      return (
        <form>
          <label htmlFor="email">Email</label>
          <input id="email" />
          <p>Required</p>
          <button type="submit">Save</button>
        </form>
      );
    }`,
    file: "src/pages/Email.tsx",
    catalog,
    config,
  });
  const fieldMessages = field.findings.map((finding) => finding.message.replace(/:\d+,/, ":N,"));
  assert.deepEqual(fieldMessages, [
    "rebuilt Form field in src/pages/Email.tsx:N, use ui/Input",
    "raw <button> in src/pages/Email.tsx:N, use ui/Button",
  ]);

  const login = analyzeSource({
    source: `export function Login() { return <form><h1>Sign in</h1><input /><button>Go</button></form>; }`,
    file: "src/pages/Login.tsx",
    catalog,
    config,
  });
  assert.equal(login.findings.some((finding) => finding.kind === "recipe"), false);
  assert.equal(login.findings.length, 2);

  const markdown = formatMarkdown(rebuilt.findings, []);
  assert.match(markdown, /rebuilt `Confirm dialog` in `src\/components\/Confirm\.tsx:\d+`, use `ui\/Dialog` \+ `ui\/Button`/);
});

test("a recipe without an example is not checked", () => {
  const catalog = recipeCatalog([confirmRecipe({ example: undefined })]);
  const result = analyzeSource({
    source: `export function Confirm() {
      return (
        <dialog open>
          <button>Cancel</button>
          <button>Delete</button>
        </dialog>
      );
    }`,
    file: "src/components/Confirm.tsx",
    catalog,
    config: sampleConfig(),
  });
  assert.equal(result.findings.some((finding) => finding.kind === "recipe"), false);
  assert.equal(result.findings.length, 3);
});

test("a diff reports the recipe only when the rebuild is in the diff", () => {
  const source = `export function Confirm() {
  return (
    <dialog open>
      <button>Cancel</button>
      <button>Delete</button>
    </dialog>
  );
}`;
  const catalog = recipeCatalog();
  const config = sampleConfig();
  const outside = analyzeSource({
    source,
    file: "src/components/Confirm.tsx",
    catalog,
    config,
    lines: new Set([1]),
  });
  assert.equal(outside.findings.length, 0);
  const inside = analyzeSource({
    source,
    file: "src/components/Confirm.tsx",
    catalog,
    config,
    lines: new Set([4]),
  });
  assert.equal(inside.findings.length, 1);
  assert.equal(inside.findings[0]?.kind, "recipe");
});

test("detection keeps an exact repeated composition and skips sets a recipe already covers", () => {
  const catalog = recipeCatalog();
  const paths = catalog.paths;
  const invite = `import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function Invite() { return <form><Input /><Button>Send</Button></form>; }`;
  const dialogOnly = `import { Dialog, DialogContent } from "@/components/ui/dialog";
export function Box() { return <Dialog><DialogContent>Hi</DialogContent></Dialog>; }`;
  const confirm = `import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
export function Delete() { return <Dialog><Button>Delete</Button></Dialog>; }`;

  const detected = detectFromFiles(
    [
      { file: "src/pages/InviteA.tsx", source: invite },
      { file: "src/pages/InviteB.tsx", source: invite },
      { file: "src/pages/BoxA.tsx", source: dialogOnly },
      { file: "src/pages/BoxB.tsx", source: dialogOnly },
      { file: "src/pages/DeleteA.tsx", source: confirm },
      { file: "src/pages/DeleteB.tsx", source: confirm },
    ],
    catalog.components,
    paths,
    [confirmRecipe(), fieldRecipe()],
  );
  assert.deepEqual(detected.map((recipe) => recipe.title), ["Button + Input"]);
  assert.equal(detected[0]?.source, "detected");
  assert.deepEqual(detected[0]?.uses, ["Button", "Input"]);
  assert.deepEqual(detected[0]?.seenIn, ["src/pages/InviteA.tsx", "src/pages/InviteB.tsx"]);

  const once = detectFromFiles(
    [{ file: "src/pages/InviteA.tsx", source: invite }],
    catalog.components,
    paths,
    [],
  );
  assert.deepEqual(once, []);
});

test("scan, exists, and check on the recipe fixture", () => {
  const summary = scanCommand(fixture);
  assert.match(summary, /^6 components, 0 stories, 2 recipes, catalog written to \.uninvent\/catalog\.json/);
  assert.match(summary, /detected Button \+ Input \(src\/pages\/InviteA\.tsx, src\/pages\/InviteB\.tsx\)/);

  const config = loadConfig(fixture);
  const catalog = readCatalog(fixture, config.catalog);
  const declared = (catalog.recipes ?? []).filter((recipe) => recipe.source === "declared");
  const detected = (catalog.recipes ?? []).filter((recipe) => recipe.source === "detected");
  assert.deepEqual(declared.map((recipe) => recipe.id), ["confirm-dialog", "form-field"]);
  assert.equal(detected.length, 1);
  assert.equal(detected[0]?.id, "detected-button-input");

  const skill = renderSkill(catalog);
  assert.match(skill, /Recipes: Confirm dialog, Form field/);
  assert.match(skill, /\*\*Confirm dialog\*\*/);
  assert.match(skill, /\*\*Form field\*\*/);
  assert.equal(skill.includes("Button + Input"), false);
  assert.match(renderAgentsBlock(catalog), /Recipes: Confirm dialog \(Dialog, DialogContent, DialogTitle, DialogDescription, Button\)/);

  assert.match(renderExists(catalog, "confirm dialog").text, /recipe confirm-dialog/);
  assert.match(renderExists(catalog, "Dialog").text, /^Dialog  /);
  assert.match(renderExists(catalog, "Button + Input").text, /recipe detected-button-input/);
  assert.match(renderExists(catalog, "Button + Input").text, /seen in: src\/pages\/InviteA\.tsx, src\/pages\/InviteB\.tsx/);

  const messages = (file: string) =>
    checkProject({ root: fixture, config, catalog, targets: [file] }).findings.map((finding) =>
      finding.message.replace(/:\d+,/, ":N,"),
    );

  assert.deepEqual(messages("src/pages/HandRolled.tsx"), [
    "rebuilt Confirm dialog in src/pages/HandRolled.tsx:N, use ui/Dialog + ui/Button",
  ]);
  assert.deepEqual(messages("src/pages/Notice.tsx"), [
    "raw <dialog> in src/pages/Notice.tsx:N, use ui/Dialog",
    "raw <button> in src/pages/Notice.tsx:N, use ui/Button",
  ]);
  assert.deepEqual(messages("src/pages/EmailField.tsx"), [
    "rebuilt Form field in src/pages/EmailField.tsx:N, use ui/Input",
  ]);
  assert.deepEqual(messages("src/pages/FieldAndButton.tsx"), [
    "rebuilt Form field in src/pages/FieldAndButton.tsx:N, use ui/Input",
    "raw <button> in src/pages/FieldAndButton.tsx:N, use ui/Button",
  ]);
  assert.deepEqual(messages("src/pages/Login.tsx"), [
    "raw <input> in src/pages/Login.tsx:N, use ui/Input",
    "raw <button> in src/pages/Login.tsx:N, use ui/Button",
  ]);
  assert.deepEqual(messages("src/pages/Mixed.tsx"), [
    "rebuilt Confirm dialog in src/pages/Mixed.tsx:N, use ui/Dialog + ui/Button",
    "raw <button> in src/pages/Mixed.tsx:N, use ui/Button",
  ]);
  assert.deepEqual(messages("src/pages/DeleteA.tsx"), []);
  assert.deepEqual(messages("src/pages/ComposedField.tsx"), []);
  assert.deepEqual(messages("src/pages/InviteA.tsx"), []);
  assert.equal(messages("src/pages/Partial.tsx").some((message) => message.startsWith("rebuilt")), false);
  assert.ok(messages("src/pages/Partial.tsx").some((message) => message.startsWith("raw <dialog>")));
  assert.ok(messages("src/pages/Partial.tsx").some((message) => message.startsWith("raw <button>")));
});
