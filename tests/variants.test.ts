import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readCatalog } from "../src/catalog.js";
import { analyzeSource } from "../src/check/analyze.js";
import { formatMarkdown } from "../src/check/format.js";
import { loadConfig } from "../src/config.js";
import { renderExists } from "../src/exists.js";
import { checkProject } from "../src/check/run.js";
import { scanCommand } from "../src/project.js";
import { renderSkill } from "../src/skill.js";
import { buttonComponent, repoRoot, sampleCatalog, sampleConfig } from "./helpers.js";

const root = path.join(repoRoot, "tests/fixtures/variants");

function messages(file: string): string[] {
  const config = loadConfig(root);
  const catalog = readCatalog(root, config.catalog);
  const result = checkProject({ root, config, catalog, targets: [file] });
  return result.findings.map((finding) => finding.message.replace(/:\d+,/, ":N,"));
}

test("scan reads cva, tv, source unions, and a package declaration file", () => {
  const summary = scanCommand(root);
  assert.match(summary, /catalog written/);
  const config = loadConfig(root);
  const catalog = readCatalog(root, config.catalog);

  const button = catalog.components.find((component) => component.name === "Button");
  assert.ok(button);
  assert.equal(button.variants.find((variant) => variant.name === "variant")?.defaultValue, "default");
  assert.equal(
    button.variants.find((variant) => variant.name === "variant")?.classes?.destructive,
    "bg-destructive text-destructive-foreground",
  );
  assert.deepEqual(button.variants.find((variant) => variant.name === "size")?.options, ["default", "sm"]);

  const chip = catalog.components.find((component) => component.name === "Chip");
  assert.equal(chip?.variants[0]?.name, "tone");
  assert.equal(chip?.variants[0]?.defaultValue, "neutral");
  assert.equal(chip?.variants[0]?.classes?.info, "bg-primary");

  const badge = catalog.components.find((component) => component.name === "Badge");
  assert.deepEqual(badge?.variants, [{ name: "tone", options: ["neutral", "info"] }]);
  assert.equal(badge?.props.some((prop) => prop.name === "children"), true);

  const alert = catalog.components.find((component) => component.name === "Alert");
  assert.equal(alert?.importPath, "@vendor/ui");
  assert.deepEqual(alert?.variants.find((variant) => variant.name === "tone")?.options, ["info", "warning"]);
  assert.equal(alert?.props.some((prop) => prop.name === "title" && prop.optional), true);

  const exists = renderExists(catalog, "Button");
  assert.match(
    exists.text,
    /variants: variant=default\|destructive\|outline \(default default\), size=default\|sm \(default default\)/,
  );
  assert.match(exists.text, /props: loading\?/);
  const skill = renderSkill(catalog);
  assert.match(skill, /variants: variant=default\|destructive\|outline, size=default\|sm/);
  assert.match(skill, /<Button variant="destructive" size="sm">/);
});

test("check names a confident variant and flags a value the catalog does not list", () => {
  scanCommand(root);
  assert.deepEqual(messages("src/pages/Delete.tsx"), [
    'raw <button> in src/pages/Delete.tsx:N, use <Button variant="destructive" size="sm">',
  ]);
  assert.deepEqual(messages("src/pages/Outline.tsx"), [
    'raw <button> in src/pages/Outline.tsx:N, use <Button variant="outline">',
  ]);
  assert.deepEqual(messages("src/pages/Plain.tsx"), [
    "raw <button> in src/pages/Plain.tsx:N, use ui/Button",
  ]);
  assert.deepEqual(messages("src/pages/Wrong.tsx"), [
    'invalid variant="danger" on Button in src/pages/Wrong.tsx:N, use <Button variant="destructive">',
  ]);
  assert.deepEqual(messages("src/pages/WrongChip.tsx"), [
    'invalid tone="error" on Chip in src/pages/WrongChip.tsx:N, use ui/Chip',
  ]);
  assert.deepEqual(messages("src/pages/WrongAlert.tsx"), [
    'invalid tone="danger" on Alert in src/pages/WrongAlert.tsx:N, use @vendor/ui Alert',
  ]);
  assert.deepEqual(messages("src/pages/Right.tsx"), []);
  assert.deepEqual(messages("src/pages/Partial.tsx"), []);
});

test("a raw control keeps the component when the classes do not pick one option", () => {
  const catalog = sampleCatalog([
    buttonComponent({
      variants: [
        {
          name: "variant",
          options: ["default", "destructive", "outline", "info"],
          defaultValue: "default",
          classes: {
            default: "bg-primary text-primary-foreground",
            destructive: "bg-destructive text-destructive-foreground",
            outline: "border border-border bg-background",
            info: "bg-sky-500 text-white",
          },
        },
        {
          name: "size",
          options: ["default", "sm", "lg", "icon"],
          defaultValue: "default",
          classes: {
            default: "h-10 px-4",
            sm: "h-9 px-3",
            lg: "h-11 px-8",
            icon: "h-10 w-10",
          },
        },
      ],
    }),
  ]);
  const config = sampleConfig();
  const line = (source: string) =>
    analyzeSource({ source, file: "src/pages/Form.tsx", catalog, config }).findings.map((finding) => finding.message);

  assert.deepEqual(
    line(`export function Form() {
      return <button className={cn("bg-red-600", "h-9 px-3")}>Delete</button>;
    }`),
    ['raw <button> in src/pages/Form.tsx:2, use <Button variant="destructive" size="sm">'],
  );
  assert.deepEqual(
    line(`export function Form() {
      return <a role="button" className="border border-input">Cancel</a>;
    }`),
    ['raw <a role="button"> in src/pages/Form.tsx:2, use <Button variant="outline">'],
  );
  assert.deepEqual(
    line(`export function Form() {
      return <button className="h-10 w-10">+</button>;
    }`),
    ['raw <button> in src/pages/Form.tsx:2, use <Button size="icon">'],
  );
  assert.deepEqual(
    line(`export function Form() {
      return <button className="rounded-md px-4 font-medium focus:outline-none">Save</button>;
    }`),
    ["raw <button> in src/pages/Form.tsx:2, use ui/Button"],
  );
  assert.deepEqual(
    line(`export function Form() {
      return <button className="bg-red-500 bg-sky-500">Save</button>;
    }`),
    ["raw <button> in src/pages/Form.tsx:2, use ui/Button"],
  );
  assert.deepEqual(
    line(`export function Form() {
      return <button className="bg-amber-400 px-2 h-12">Save</button>;
    }`),
    ["raw <button> in src/pages/Form.tsx:2, use ui/Button"],
  );

  const reused = analyzeSource({
    source: `import { Button } from "@/components/ui/button";
      export function Form() {
        return <Button variant="danger" className="bg-destructive text-destructive-foreground">Delete</Button>;
      }`,
    file: "src/pages/Form.tsx",
    catalog: sampleCatalog([
      buttonComponent({
        states: [{
          id: "variant:destructive",
          label: "destructive",
          kind: "variant",
          stories: ["Destructive"],
          prop: "variant",
          value: "destructive",
        }],
        variants: [
          {
            name: "variant",
            options: ["default", "destructive"],
            defaultValue: "default",
            classes: {
              default: "bg-primary",
              destructive: "bg-destructive text-destructive-foreground",
            },
          },
        ],
      }),
    ]),
    config,
  });
  assert.deepEqual(
    reused.findings.map((finding) => finding.message),
    ['invalid variant="danger" on Button in src/pages/Form.tsx:3, use <Button variant="destructive">'],
  );
  const markdown = formatMarkdown(reused.findings, reused.reuses);
  assert.match(markdown, /invalid `variant="danger"` on `Button`/);

  const cased = analyzeSource({
    source: `import { Button } from "@/components/ui/button";
      export function Form() { return <Button variant="Destructive" size="SMALL">Delete</Button>; }`,
    file: "src/pages/Form.tsx",
    catalog,
    config,
  });
  assert.deepEqual(cased.findings.map((finding) => finding.message).sort(), [
    'invalid size="SMALL" on Button in src/pages/Form.tsx:2, use <Button size="sm">',
    'invalid variant="Destructive" on Button in src/pages/Form.tsx:2, use <Button variant="destructive">',
  ]);
});
