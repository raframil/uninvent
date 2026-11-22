import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { extractFile } from "../src/scanner/extract.js";
import { repoRoot } from "./helpers.js";

test("extracts CVA variants, own props, and the rendered element", () => {
  const file = "examples/demo-app/src/components/ui/button.tsx";
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  const [button] = extractFile(file, source);
  assert.ok(button);
  assert.equal(button.name, "Button");
  assert.equal(button.props.some((prop) => prop.name === "asChild"), true);
  assert.deepEqual(button.primitives, [{ library: "radix", package: "@radix-ui/react-slot" }]);
  assert.deepEqual(
    button.variants.map((variant) => variant.name),
    ["variant", "size"],
  );
  const variant = button.variants.find((entry) => entry.name === "variant");
  assert.deepEqual(variant?.options, ["default", "destructive", "outline", "secondary", "ghost", "link"]);
  assert.equal(variant?.defaultValue, "default");
  assert.equal(button.elements.includes("button"), true);
});

test("extracts tailwind-variants from the first argument", () => {
  const source = `
    import { tv } from "tailwind-variants";
    const chip = tv({
      base: "inline-flex",
      variants: { tone: { neutral: "bg-muted", info: "bg-primary" } },
      defaultVariants: { tone: "neutral" },
    });
    export function Chip({ tone }: { tone?: "neutral" | "info" }) {
      return <span className={chip({ tone })} />;
    }
  `;
  const [chip] = extractFile("chip.tsx", source);
  assert.ok(chip);
  assert.equal(chip.variants[0]?.name, "tone");
  assert.deepEqual(chip.variants[0]?.options, ["neutral", "info"]);
  assert.equal(chip.variants[0]?.defaultValue, "neutral");
});

test("keeps dialog siblings and does not treat a cva helper as a component", () => {
  const file = "examples/demo-app/src/components/ui/dialog.tsx";
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  const names = extractFile(file, source).map((component) => component.name);
  assert.ok(names.includes("Dialog"));
  assert.ok(names.includes("DialogContent"));
  assert.ok(names.includes("DialogTrigger"));
  assert.equal(names.includes("buttonVariants"), false);
  const dialog = extractFile(file, source).find((component) => component.name === "Dialog");
  assert.deepEqual(
    dialog?.props.map((prop) => prop.name),
    ["open", "onOpenChange", "children"],
  );
  assert.deepEqual(dialog?.primitives, [{ library: "radix", package: "@radix-ui/react-dialog" }]);
});

test("records Base UI, React Aria, and Ark through the adapter map", () => {
  const base = extractFile(
    "dialog.tsx",
    `import { Dialog as DialogPrimitive } from "@base-ui-components/react/dialog";
     export function Dialog(props: DialogPrimitive.Root.Props) {
       return <DialogPrimitive.Root {...props} />;
     }`,
  );
  assert.deepEqual(base[0]?.primitives, [{ library: "base-ui", package: "@base-ui-components/react/dialog" }]);

  const current = extractFile(
    "button.tsx",
    `import { Button as ButtonPrimitive } from "@base-ui/react/button";
     export function Button(props: ButtonPrimitive.Props) {
       return <ButtonPrimitive {...props} />;
     }`,
  );
  assert.deepEqual(current[0]?.primitives, [{ library: "base-ui", package: "@base-ui/react/button" }]);
  assert.equal(current[0]?.elements.includes("button"), false);

  const aria = extractFile(
    "button.tsx",
    `import { Button } from "react-aria-components";
     export function AriaButton(props: { children?: string }) { return <Button {...props} />; }`,
  );
  assert.deepEqual(aria[0]?.primitives, [{ library: "react-aria", package: "react-aria-components" }]);

  const ark = extractFile(
    "dialog.tsx",
    `import { Dialog } from "@ark-ui/react/dialog";
     export function DialogRoot() { return <Dialog.Root />; }`,
  );
  assert.deepEqual(ark[0]?.primitives, [{ library: "ark", package: "@ark-ui/react/dialog" }]);
});
