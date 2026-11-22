import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { analyzeSource } from "../src/check/analyze.js";
import { parseUnifiedDiff } from "../src/check/diff.js";
import { formatMarkdown, formatText } from "../src/check/format.js";
import { matchesIgnore } from "../src/ignore.js";
import { buttonComponent, sampleCatalog, sampleConfig } from "./helpers.js";

const catalog = sampleCatalog([
  buttonComponent(),
  buttonComponent({
    name: "Input",
    file: "src/components/ui/input.tsx",
    importPath: "@/components/ui/input",
    elements: ["input"],
    variants: [],
    radix: [],
    props: [],
  }),
  buttonComponent({
    name: "Dialog",
    file: "src/components/ui/dialog.tsx",
    importPath: "@/components/ui/dialog",
    elements: [],
    variants: [],
    radix: ["@radix-ui/react-dialog"],
    props: [{ name: "open", optional: true }],
  }),
]);
const config = sampleConfig();

test("flags raw controls only when the catalog has the component", () => {
  const source = `
    export function Form() {
      return (
        <form>
          <input placeholder="Email" />
          <button type="submit">Continue</button>
          <textarea />
          <a href="/signup">Create an account</a>
          <a role="button">Save</a>
          <a role={"button"}>Other</a>
        </form>
      );
    }
  `;
  const result = analyzeSource({ source, file: "src/pages/Login.tsx", catalog, config });
  assert.deepEqual(
    result.findings.map((finding) => finding.message),
    [
      "raw <input> in src/pages/Login.tsx:5, use ui/Input",
      "raw <button> in src/pages/Login.tsx:6, use ui/Button",
      "raw <a role=\"button\"> in src/pages/Login.tsx:9, use ui/Button",
      "raw <a role=\"button\"> in src/pages/Login.tsx:10, use ui/Button",
    ],
  );
  assert.equal(formatText([]), "");
  assert.match(formatText(result.findings), /^raw <input>/);
});

test("counts catalog imports as reuse and stays quiet inside the design system", () => {
  const page = analyzeSource({
    source: `import { Button } from "@/components/ui/button";
      export function Page() { return <Button>Invite</Button>; }`,
    file: "src/pages/Customers.tsx",
    catalog,
    config,
  });
  assert.equal(page.findings.length, 0);
  assert.equal(page.reuses.length, 1);
  assert.equal(page.reuses[0]?.name, "Button");

  const system = analyzeSource({
    source: `export function Button() { return <button>Save</button>; }`,
    file: "src/components/ui/button.tsx",
    catalog,
    config,
  });
  assert.equal(system.findings.length, 0);
});

test("flags an exported name that collides with the catalog, not a re-export", () => {
  const collision = analyzeSource({
    source: `export function Button() { return <button>Save</button>; }`,
    file: "src/components/Button.tsx",
    catalog,
    config,
  });
  assert.equal(collision.findings.some((finding) => finding.kind === "name-collision"), true);
  assert.match(collision.findings.map((finding) => finding.message).join("\n"), /export Button in src\/components\/Button.tsx:\d+, use ui\/Button/);

  const reexport = analyzeSource({
    source: `export { Button } from "@/components/ui/button";`,
    file: "src/components/index.tsx",
    catalog,
    config,
  });
  assert.equal(reexport.findings.length, 0);
});

test("a native dialog suggests Dialog and does not guess from the filename", () => {
  const result = analyzeSource({
    source: `export function Modal() { return <dialog open><h2>Hi</h2></dialog>; }`,
    file: "src/components/Modal.tsx",
    catalog,
    config,
  });
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0]?.message ?? "", /raw <dialog> in src\/components\/Modal.tsx:\d+, use ui\/Dialog/);
  assert.equal(result.findings.some((finding) => finding.kind === "name-collision"), false);
});

test("ignores stories and limits a diff to added lines", () => {
  assert.equal(matchesIgnore("src/ui/button.stories.tsx", config.ignore), true);
  assert.equal(matchesIgnore("src/ui/button.tsx", config.ignore), false);
  const source = `import { Button } from "@/components/ui/button";
    export function Page() {
      return (
        <div>
          <Button>Keep</Button>
          <button>New</button>
        </div>
      );
    }`;
  const all = analyzeSource({ source, file: "src/pages/Page.tsx", catalog, config });
  const diff = analyzeSource({
    source,
    file: "src/pages/Page.tsx",
    catalog,
    config,
    lines: new Set([6]),
  });
  assert.equal(all.reuses.length, 1);
  assert.equal(diff.reuses.length, 0);
  assert.equal(diff.findings.length, 1);
  assert.match(diff.findings[0]?.message ?? "", /raw <button>/);
});

test("parses a unified diff into added lines", () => {
  const diff = [
    "diff --git a/src/pages/Login.tsx b/src/pages/Login.tsx",
    "--- a/src/pages/Login.tsx",
    "+++ b/src/pages/Login.tsx",
    "@@ -4,0 +5,2 @@",
    "+      <input />",
    "+      <button>Go</button>",
    "diff --git a/src/pages/Old.tsx b/src/pages/Old.tsx",
    "--- a/src/pages/Old.tsx",
    "+++ /dev/null",
  ].join("\n");
  const files = parseUnifiedDiff(diff);
  assert.deepEqual([...(files.get("src/pages/Login.tsx") ?? [])], [5, 6]);
  assert.equal(files.has("src/pages/Old.tsx"), false);
});

test("markdown report carries the reuse and invent counts", () => {
  const findings = analyzeSource({
    source: `export function Form() { return <button>Go</button>; }`,
    file: "src/Form.tsx",
    catalog,
    config,
  }).findings;
  const markdown = formatMarkdown(findings, [{ name: "PageHeader", file: "src/Home.tsx", line: 3 }]);
  assert.match(markdown, /\*\*reuse 1 \/ invent 1\*\*/);
  assert.match(markdown, /raw `<button>` in `src\/Form.tsx:\d+`, use `ui\/Button`/);
  assert.match(markdown, /Reused: PageHeader/);
});
