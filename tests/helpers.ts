import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Catalog, CatalogComponent, Config } from "../src/types.js";

export const repoRoot = path.resolve(import.meta.dirname, "..");

export function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "uninvent-"));
}

export function buttonComponent(overrides: Partial<CatalogComponent> = {}): CatalogComponent {
  return {
    name: "Button",
    file: "src/components/ui/button.tsx",
    line: 20,
    importPath: "@/components/ui/button",
    props: [{ name: "asChild", optional: true, type: "boolean" }],
    extends: ["React.ButtonHTMLAttributes<HTMLButtonElement>"],
    variants: [
      { name: "variant", options: ["default", "ghost"], defaultValue: "default" },
      { name: "size", options: ["default", "sm"], defaultValue: "default" },
    ],
    primitives: [{ library: "radix", package: "@radix-ui/react-slot" }],
    elements: ["button"],
    stories: [],
    ...overrides,
  };
}

export function sampleCatalog(components: CatalogComponent[] = [buttonComponent()]): Catalog {
  return {
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    paths: [{ prefix: "@/", target: "src/" }],
    components,
    tokens: [],
  };
}

export function sampleConfig(overrides: Partial<Config> = {}): Config {
  return {
    ui: ["src/components/ui"],
    packages: [],
    ignore: ["**/*.stories.tsx", "**/*.test.tsx"],
    catalog: ".uninvent/catalog.json",
    commitCatalog: false,
    ...overrides,
  };
}
