import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCatalog, writeCatalog } from "../src/catalog.js";
import { checkProject } from "../src/check/run.js";
import { loadConfig } from "../src/config.js";
import { renderExists } from "../src/exists.js";
import { matchPrimitive } from "../src/primitives.js";
import { scanCommand } from "../src/project.js";
import { renderSkill } from "../src/skill.js";
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
  assert.equal(matchPrimitive("class-variance-authority"), null);
  assert.equal(matchPrimitive("react"), null);
});

test("a Base UI catalog still flags raw HTML and a hand-rolled dialog", () => {
  const summary = scanCommand(fixture);
  assert.match(summary, /^5 components, 0 stories,/);

  const config = loadConfig(fixture);
  const catalog = readCatalog(fixture, config.catalog);
  const button = catalog.components.find((component) => component.name === "Button");
  const dialog = catalog.components.find((component) => component.name === "Dialog");
  const input = catalog.components.find((component) => component.name === "Input");
  assert.deepEqual(button?.primitives, [{ library: "base-ui", package: "@base-ui/react/button" }]);
  assert.deepEqual(dialog?.primitives, [{ library: "base-ui", package: "@base-ui/react/dialog" }]);
  assert.deepEqual(input?.primitives, [{ library: "base-ui", package: "@base-ui/react/input" }]);
  assert.deepEqual(
    button?.variants.find((variant) => variant.name === "variant")?.options,
    ["default", "outline", "secondary", "ghost", "destructive", "link"],
  );
  assert.equal(button?.elements.includes("button"), false);

  const exists = renderExists(catalog, "Dialog");
  assert.match(exists.text, /primitives: base-ui \(@base-ui\/react\/dialog\)/);
  assert.match(renderSkill(catalog), /primitives: base-ui \(@base-ui\/react\/button\)/);
  assert.match(renderSkill(catalog), /Radix, Base UI/);

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
});
