import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCatalog, writeCatalog } from "../src/catalog.js";
import { checkProject } from "../src/check/run.js";
import { loadConfig } from "../src/config.js";
import { renderExists } from "../src/exists.js";
import { matchPrimitive, resolveLibraries } from "../src/primitives.js";
import { scanCommand } from "../src/project.js";
import { renderSkill } from "../src/skill.js";
import { renderCoverage } from "../src/stories/coverage.js";
import { repoRoot, tempDir } from "./helpers.js";

const fixture = path.join(repoRoot, "tests/fixtures/base-ui");

test("adapter map matches the built-in libraries and ignores styling packages", () => {
  assert.deepEqual(matchPrimitive("@radix-ui/react-slot"), { library: "radix", package: "@radix-ui/react-slot" });
  assert.deepEqual(matchPrimitive("@base-ui/react/button"), {
    library: "base-ui",
    package: "@base-ui/react/button",
  });
  assert.deepEqual(matchPrimitive("@base-ui-components/react/dialog"), {
    library: "base-ui",
    package: "@base-ui-components/react/dialog",
  });
  assert.equal(matchPrimitive("@react-aria/button")?.library, "react-aria");
  assert.equal(matchPrimitive("@ark-ui/react")?.library, "ark");
  assert.equal(matchPrimitive("radix-ui")?.library, "radix");
  assert.equal(matchPrimitive("@headlessui/react")?.library, "headless-ui");
  assert.equal(matchPrimitive("@mantine/core")?.library, "mantine");
  assert.equal(matchPrimitive("@chakra-ui/react")?.library, "chakra");
  assert.equal(matchPrimitive("class-variance-authority"), null);
  assert.equal(matchPrimitive("react"), null);
  const extended = resolveLibraries([
    { library: "base-ui", packages: ["@acme/base"], parts: { Fancy: ["button"] } },
    { library: "acme", packages: ["@acme/headless"], parts: { "Modal.Popup": ["dialog"] } },
  ]);
  assert.equal(matchPrimitive("@acme/base/button", extended)?.library, "base-ui");
  assert.equal(matchPrimitive("@base-ui/react/button", extended)?.library, "base-ui");
  assert.equal(matchPrimitive("@acme/headless/modal", extended)?.library, "acme");
});

test("a Base UI catalog still flags raw HTML and a hand-rolled dialog", () => {
  const summary = scanCommand(fixture);
  assert.match(summary, /^9 components, 0 stories,/);

  const config = loadConfig(fixture);
  const catalog = readCatalog(fixture, config.catalog);
  const button = catalog.components.find((component) => component.name === "Button");
  const dialog = catalog.components.find((component) => component.name === "Dialog");
  const content = catalog.components.find((component) => component.name === "DialogContent");
  const input = catalog.components.find((component) => component.name === "Input");
  const select = catalog.components.find((component) => component.name === "Select");
  const textarea = catalog.components.find((component) => component.name === "Textarea");
  assert.deepEqual(button?.primitives, [{ library: "base-ui", package: "@base-ui/react/button", parts: ["Button"] }]);
  assert.equal(button?.elements.includes("button"), true);
  assert.deepEqual(dialog?.primitives, [{ library: "base-ui", package: "@base-ui/react/dialog", parts: ["Dialog.Root"] }]);
  assert.equal(dialog?.elements.includes("dialog"), true);
  assert.equal(content?.elements.includes("dialog"), false);
  assert.deepEqual(content?.primitives[0]?.parts, ["Dialog.Backdrop", "Dialog.Popup", "Dialog.Portal"]);
  assert.deepEqual(input?.primitives, [{ library: "base-ui", package: "@base-ui/react/input", parts: ["Input"] }]);
  assert.equal(input?.elements.includes("input"), true);
  assert.deepEqual(select?.primitives[0]?.parts, ["Select.Root"]);
  assert.equal(select?.elements.includes("select"), true);
  assert.deepEqual(textarea?.primitives, []);
  assert.equal(textarea?.elements.includes("textarea"), true);
  assert.deepEqual(
    button?.variants.find((variant) => variant.name === "variant")?.options,
    ["default", "outline", "secondary", "ghost", "destructive", "link"],
  );

  const exists = renderExists(catalog, "Dialog");
  assert.match(exists.text, /primitives: base-ui \(@base-ui\/react\/dialog\)/);
  assert.match(exists.text, /parts: Dialog\.Root/);
  assert.match(exists.text, /renders: <dialog>/);
  assert.match(renderSkill(catalog), /primitives: base-ui \(@base-ui\/react\/button\)/);
  assert.match(renderSkill(catalog), /uninvent\.json/);
  assert.doesNotMatch(renderSkill(catalog), /may be Radix, Base UI/);
  assert.equal(renderCoverage(catalog, "", "text").text, "No states source found.\n");

  const clean = checkProject({ root: fixture, config, catalog, targets: ["src/pages/Home.tsx"] });
  assert.equal(clean.findings.length, 0);
  assert.ok(clean.reuses.some((reuse) => reuse.name === "Button"));

  const login = checkProject({ root: fixture, config, catalog, targets: ["src/pages/Login.tsx"] });
  assert.deepEqual(
    login.findings.map((finding) => finding.message.replace(/:\d+,/, ":N,")),
    [
      "raw <input> in src/pages/Login.tsx:N, use ui/Input",
      "raw <button> in src/pages/Login.tsx:N, use ui/Button",
    ],
  );

  const modal = checkProject({ root: fixture, config, catalog, targets: ["src/components/Modal.tsx"] });
  assert.match(modal.findings[0]?.message ?? "", /raw <dialog> in src\/components\/Modal\.tsx:\d+, use ui\/Dialog/);

  const filters = checkProject({ root: fixture, config, catalog, targets: ["src/pages/Filters.tsx"] });
  assert.deepEqual(
    filters.findings.map((finding) => finding.message.replace(/:\d+,/, ":N,")),
    [
      "raw <select> in src/pages/Filters.tsx:N, use ui/Select",
      "raw <textarea> in src/pages/Filters.tsx:N, use ui/Textarea",
    ],
  );
});

test("reads a catalog that still has the old radix field", () => {
  const root = tempDir();
  mkdirSync(path.join(root, ".uninvent"), { recursive: true });
  writeFileSync(
    path.join(root, ".uninvent/catalog.json"),
    JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      paths: [],
      tokens: [],
      components: [
        {
          name: "Button",
          file: "src/components/ui/button.tsx",
          line: 1,
          importPath: "@/components/ui/button",
          props: [],
          extends: [],
          variants: [],
          radix: ["@radix-ui/react-slot"],
          elements: ["button"],
          stories: [],
        },
      ],
    }),
  );
  writeCatalog(root, ".uninvent/catalog.json", readCatalog(root, ".uninvent/catalog.json"));
  const catalog = readCatalog(root, ".uninvent/catalog.json");
  assert.deepEqual(catalog.components[0]?.primitives, [{ library: "radix", package: "@radix-ui/react-slot" }]);
  assert.equal("radix" in (catalog.components[0] ?? {}), false);
  assert.deepEqual(catalog.recipes, []);
});
