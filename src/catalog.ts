import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { UserError } from "./errors.js";
import type { PrimitiveUse } from "./primitives.js";
import type { Catalog, CatalogComponent } from "./types.js";

export function catalogPath(root: string, relative: string): string {
  return path.join(root, relative);
}

export function readCatalog(root: string, relative: string): Catalog {
  const file = catalogPath(root, relative);
  if (!existsSync(file)) {
    throw new UserError(
      `No catalog at ${relative}. Run \`uninvent scan\` from the project root.`,
    );
  }
  let parsed: Catalog;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as Catalog;
  } catch {
    throw new UserError(`Could not parse ${relative} as JSON.`);
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.components)) {
    throw new UserError(`${relative} is not an uninvent catalog (expected version 1).`);
  }
  parsed.paths ??= [];
  parsed.tokens ??= [];
  for (const component of parsed.components) normalizePrimitives(component);
  return parsed;
}

/** Accept catalogs written before `primitives` replaced the Radix-only field. */
function normalizePrimitives(component: CatalogComponent & { radix?: unknown }): void {
  if (Array.isArray(component.primitives)) {
    component.primitives = component.primitives.filter(isPrimitiveUse);
    return;
  }
  const legacy = component.radix;
  component.primitives = Array.isArray(legacy)
    ? legacy.filter((pkg): pkg is string => typeof pkg === "string").map((pkg) => ({ library: "radix", package: pkg }))
    : [];
  delete component.radix;
}

function isPrimitiveUse(value: unknown): value is PrimitiveUse {
  if (!value || typeof value !== "object") return false;
  const entry = value as { library?: unknown; package?: unknown };
  return typeof entry.library === "string" && typeof entry.package === "string";
}

export function writeCatalog(root: string, relative: string, catalog: Catalog): void {
  const file = catalogPath(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
}

export function siblingsOf(component: CatalogComponent, catalog: Catalog): CatalogComponent[] {
  return catalog.components.filter((entry) => entry.file === component.file);
}

export function importStatement(component: CatalogComponent, catalog: Catalog): string {
  const names = siblingsOf(component, catalog)
    .map((entry) => entry.name)
    .join(", ");
  return `import { ${names} } from "${component.importPath}";`;
}

export function suggestionLabel(name: string): string {
  return `ui/${name}`;
}
