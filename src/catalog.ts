import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { UserError } from "./errors.js";
import type { PrimitiveUse } from "./primitives.js";
import type { Catalog, CatalogComponent, Recipe } from "./types.js";

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
  parsed.recipes = normalizeRecipes(parsed.recipes);
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

/** v0.1 catalogs have no `recipes` field. Invalid entries are dropped. */
function normalizeRecipes(value: unknown): Recipe[] {
  if (!Array.isArray(value)) return [];
  const recipes: Recipe[] = [];
  for (const entry of value) {
    const recipe = normalizeRecipe(entry);
    if (recipe) recipes.push(recipe);
  }
  return recipes;
}

function normalizeRecipe(value: unknown): Recipe | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<Recipe>;
  if (typeof entry.id !== "string" || entry.id.length === 0) return null;
  if (typeof entry.title !== "string" || entry.title.length === 0) return null;
  if (entry.source !== "declared" && entry.source !== "detected") return null;
  if (!Array.isArray(entry.uses) || entry.uses.some((name) => typeof name !== "string")) return null;
  const uses = entry.uses.filter((name) => name.length > 0);
  if (uses.length === 0) return null;
  const intents = Array.isArray(entry.intents)
    ? entry.intents.filter((intent): intent is string => typeof intent === "string" && intent.length > 0)
    : [];
  const recipe: Recipe = {
    id: entry.id,
    title: entry.title,
    intents: intents.length > 0 ? intents : [entry.title],
    uses,
    summary: typeof entry.summary === "string" ? entry.summary : "",
    source: entry.source,
  };
  if (typeof entry.example === "string" && entry.example.length > 0) recipe.example = entry.example;
  if (typeof entry.file === "string" && entry.file.length > 0) recipe.file = entry.file;
  if (Array.isArray(entry.seenIn)) {
    const seenIn = entry.seenIn.filter((file): file is string => typeof file === "string" && file.length > 0);
    if (seenIn.length > 0) recipe.seenIn = seenIn;
  }
  return recipe;
}

function isPrimitiveUse(value: unknown): value is PrimitiveUse {
  if (!value || typeof value !== "object") return false;
  const entry = value as { library?: unknown; package?: unknown };
  return typeof entry.library === "string" && typeof entry.package === "string";
}

export function writeCatalog(root: string, relative: string, catalog: Catalog): void {
  const file = catalogPath(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  const document: Catalog = { ...catalog, recipes: catalog.recipes ?? [] };
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
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
