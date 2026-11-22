import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCatalog, writeCatalog } from "../src/catalog.js";
import { analyzeSource } from "../src/check/analyze.js";
import { loadConfig } from "../src/config.js";
import { renderExists } from "../src/exists.js";
import { scanCommand } from "../src/project.js";
import { parseStorySource } from "../src/stories/parse.js";
import { renderCoverage } from "../src/stories/coverage.js";
import { deriveStates } from "../src/stories/states.js";
import { buttonComponent, repoRoot, sampleCatalog, sampleConfig, tempDir } from "./helpers.js";

const fixture = path.join(repoRoot, "tests/fixtures/stories");

test("scan reads CSF, TypeScript stories, and MDX into documented states", () => {
  const summary = scanCommand(fixture);
  assert.equal(summary, "5 components, 3 stories, 9 states, catalog written to .uninvent/catalog.json");
  const config = loadConfig(fixture);
  const catalog = readCatalog(fixture, config.catalog);
  const button = catalog.components.find((component) => component.name === "Button");
  assert.ok(button);
  assert.deepEqual(
    button.states?.map((state) => state.id),
    ["disabled", "loading", "variant:default", "variant:destructive", "size:default", "size:sm", "busy"],
  );
  assert.equal(button.states?.find((state) => state.id === "busy")?.kind, "story");
  assert.deepEqual(button.states?.find((state) => state.id === "size:sm")?.stories, [
    "Destructive",
    "Loading",
    "Disabled",
    "Busy",
  ]);
  assert.equal(button.variants.find((variant) => variant.name === "variant")?.classes?.destructive, "bg-destructive text-destructive-foreground");

  const input = catalog.components.find((component) => component.name === "Input");
  assert.deepEqual(input?.states?.map((state) => state.id), ["invalid"]);
  assert.equal(input?.storyDocs?.[0]?.file, "src/components/ui/input.stories.ts");

  const dialog = catalog.components.find((component) => component.name === "Dialog");
  assert.deepEqual(dialog?.states?.map((state) => `${state.id}:${state.stories.join("+")}`), ["open:Open"]);
  assert.equal(dialog?.storyDocs?.some((doc) => doc.file.endsWith(".stories.mdx")), true);

  const loading = renderExists(catalog, "loading button");
  assert.match(loading.text, /state: loading  story Loading/);
  assert.equal(loading.text.includes("busy"), false);
  const invalid = renderExists(catalog, "invalid input");
  assert.match(invalid.text, /state: invalid  story Invalid/);
  const destructive = renderExists(catalog, "destructive button");
  assert.match(destructive.text, /state: variant=destructive  story Destructive/);

  const coverage = renderCoverage(catalog, "", "text");
  assert.equal(coverage.exitCode, 0);
  assert.match(coverage.text, /variant=outline  —/);
  assert.match(coverage.text, /size=sm  Destructive, Loading, Disabled, Busy/);
  assert.match(coverage.text, /busy  Busy \(name only\)/);
  assert.match(coverage.text, /Spinner  src\/components\/ui\/spinner\.tsx\n  no stories/);
  assert.match(coverage.text, /does not fail the check/);
  assert.equal(renderCoverage(catalog, "Missing", "text").exitCode, 1);

  const sourceOf = (body: string) => analyzeSource({ source: body, file: "src/pages/Page.tsx", catalog, config }).findings.map((finding) => finding.message.replace(/:\d+,/, ":N,"));

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Save() {
      return (
        <Button disabled={true}>
          <span className="mr-2 animate-spin" />
          Save
        </Button>
      );
    }
  `), ["reinvented loading on Button in src/pages/Page.tsx:N, use ui/Button loading"]);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Save() {
      return <div><Button>Save</Button><Loader2 /></div>;
    }
  `), ["reinvented loading on Button in src/pages/Page.tsx:N, use ui/Button loading"]);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Save() {
      return <Button loading>Save</Button>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Save() {
      return <Button className="animate-spin">Save</Button>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    import { Spinner } from "@/components/ui/spinner";
    export function Save() {
      return <div><Button>Save</Button><Spinner /></div>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Page() {
      return <div><Button>Save</Button><section><span className="animate-spin" /></section></div>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Page() {
      return <div><Button>Save</Button><span className="animate-spin" /><Button>Cancel</Button></div>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Danger() {
      return <Button className="bg-destructive text-destructive-foreground">Delete</Button>;
    }
  `), ['reinvented variant=destructive on Button in src/pages/Page.tsx:N, use ui/Button variant="destructive"']);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Danger() {
      return <Button variant="destructive" className="bg-destructive text-destructive-foreground">Delete</Button>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Danger() {
      return <Button className="bg-destructive">Delete</Button>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Quiet() {
      return <Button className="border border-border bg-background">Save</Button>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Quiet() {
      return <Button className="h-9 px-3">Save</Button>;
    }
  `), []);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Quiet() {
      return <Button className="opacity-50 pointer-events-none">Save</Button>;
    }
  `), ["reinvented disabled on Button in src/pages/Page.tsx:N, use ui/Button disabled"]);

  assert.deepEqual(sourceOf(`
    import { Button } from "@/components/ui/button";
    export function Quiet() {
      return <Button disabled className="opacity-50 pointer-events-none">Save</Button>;
    }
  `), []);

  const ignored = analyzeSource({
    source: `export function Story() { return <button>Save</button>; }`,
    file: "src/components/ui/button.stories.tsx",
    catalog,
    config,
  });
  assert.equal(ignored.findings.length, 0);
});

test("a story name without an arg is not a check, and a pre-v0.3 catalog stays silent", () => {
  const namedOnly = deriveStates(
    buttonComponent({ props: [{ name: "asChild", optional: true }], variants: [] }),
    [{ file: "button.stories.tsx", name: "Loading", args: [] }],
  );
  assert.equal(namedOnly.find((state) => state.id === "loading")?.kind, "story");

  const withProp = deriveStates(
    buttonComponent({ props: [{ name: "loading", optional: true }], variants: [] }),
    [{ file: "button.stories.tsx", name: "Loading", args: [] }],
  );
  assert.equal(withProp.find((state) => state.id === "loading")?.kind, "prop");

  const legacy = sampleCatalog([buttonComponent()]);
  const spun = analyzeSource({
    source: `import { Button } from "@/components/ui/button";
      export function Save() { return <Button><span className="animate-spin" /></Button>; }`,
    file: "src/pages/Save.tsx",
    catalog: legacy,
    config: sampleConfig(),
  });
  assert.equal(spun.findings.length, 0);

  const root = tempDir();
  mkdirSync(path.join(root, ".uninvent"), { recursive: true });
  writeFileSync(path.join(root, "uninvent.json"), `${JSON.stringify(sampleConfig())}\n`);
  writeCatalog(root, ".uninvent/catalog.json", legacy);
  const roundTrip = readCatalog(root, ".uninvent/catalog.json");
  assert.equal(roundTrip.components[0]?.states, undefined);
  const coverage = renderCoverage(roundTrip, "", "text");
  assert.match(coverage.text, /No parsed states in this catalog/);
  assert.equal(coverage.exitCode, 0);
});

test("CSF and MDX parsers keep literal args and ignore a file they cannot read", () => {
  const csf = parseStorySource("button.stories.tsx", `
    import { Button } from "./button";
    const meta = { title: "UI/Button", component: Button, args: { disabled: true } } satisfies Record<string, unknown>;
    export default meta;
    export const Primary = { args: { children: "Save", variant: "destructive" } };
    export const Loading = { render: () => <Button loading>Save</Button> };
    const Template = () => <Button variant="outline" />;
    export const Outline = Template.bind({});
    Outline.args = { disabled: false };
  `);
  assert.equal(csf.componentName, "Button");
  assert.deepEqual(csf.metaArgs, [{ name: "disabled", value: "true" }]);
  assert.deepEqual(csf.stories.find((story) => story.name === "Primary")?.args, [
    { name: "children", value: "Save" },
    { name: "variant", value: "destructive" },
  ]);
  assert.deepEqual(csf.stories.find((story) => story.name === "Loading")?.tags, [
    { name: "Button", args: [{ name: "loading", value: "true" }] },
  ]);
  assert.deepEqual(csf.stories.find((story) => story.name === "Outline")?.args, [{ name: "disabled", value: "false" }]);
  assert.equal(csf.stories.find((story) => story.name === "Outline")?.tags[0]?.args.some((arg) => arg.name === "variant"), true);

  const mdx = parseStorySource("dialog.stories.mdx", `
    import { Dialog } from "./dialog";
    <Meta title="UI/Dialog" component={Dialog} />
    <Story name="Open" args={{ open: true }}>
      <Dialog open>Hi</Dialog>
    </Story>
    <Story of={DialogStories.Loading} />
  `);
  assert.equal(mdx.componentName, "Dialog");
  assert.equal(mdx.stories[0]?.name, "Open");
  assert.deepEqual(mdx.stories[0]?.args, [{ name: "open", value: "true" }]);
  assert.deepEqual(mdx.stories[0]?.tags, [{ name: "Dialog", args: [{ name: "open", value: "true" }] }]);
  assert.equal(mdx.stories[1]?.name, "Loading");

  const broken = parseStorySource("button.stories.tsx", "export const !!! = <");
  assert.deepEqual(broken.stories, []);
});

test("coverage is informational on the command line", () => {
  const cli = path.join(repoRoot, "src/cli.ts");
  const run = spawnSync("node", ["--import", "tsx", cli, "coverage", "--cwd", fixture], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /variant=outline  —/);
  assert.match(run.stdout, /does not fail the check/);
});
