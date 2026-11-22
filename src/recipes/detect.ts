import { readFileSync } from "node:fs";
import path from "node:path";
import { isInsideDir } from "../config.js";
import { walkSourceFiles } from "../fs-walk.js";
import { matchesIgnore } from "../ignore.js";
import { posixDir, type PathMapping } from "../paths.js";
import type { Catalog, CatalogComponent, Config, Recipe } from "../types.js";
import { catalogLocals, parseUi, visitJsx } from "./jsx.js";
import { slug } from "./parse.js";

const MIN_FILES = 2;
const MIN_MODULES = 2;

/**
 * Exact set of catalog components, used in at least two app files, drawn from
 * at least two UI modules. A set that is already covered by a declared recipe
 * is skipped. Detected recipes are recorded, not checked.
 */
export function detectRecipes(options: {
  root: string;
  config: Config;
  components: CatalogComponent[];
  paths: PathMapping[];
  declared: Recipe[];
}): Recipe[] {
  const files: { file: string; source: string }[] = [];
  for (const file of walkSourceFiles(options.root)) {
    if (isUiFile(file, options.config, options.components)) continue;
    if (matchesIgnore(file, options.config.ignore)) continue;
    files.push({ file, source: readFileSync(path.join(options.root, file), "utf8") });
  }
  return detectFromFiles(files, options.components, options.paths, options.declared);
}

export function detectFromFiles(
  files: { file: string; source: string }[],
  components: CatalogComponent[],
  paths: PathMapping[],
  declared: Recipe[],
): Recipe[] {
  const catalog = stubCatalog(components, paths);
  const groups = new Map<string, { names: string[]; files: string[] }>();
  for (const entry of files) {
    const names = usedComponents(entry.file, entry.source, catalog);
    if (names.length < 2) continue;
    if (moduleCount(names, components) < MIN_MODULES) continue;
    const key = names.join("\0");
    const group = groups.get(key) ?? { names, files: [] };
    group.files.push(entry.file);
    groups.set(key, group);
  }

  const ids = new Set(declared.map((recipe) => recipe.id));
  const recipes: Recipe[] = [];
  const ordered = [...groups.values()].sort((a, b) => a.names.join("\0").localeCompare(b.names.join("\0")));
  for (const group of ordered) {
    if (group.files.length < MIN_FILES) continue;
    if (coveredByDeclared(group.names, declared)) continue;
    const title = compositionTitle(group.names, components);
    const id = uniqueId(slug(title), ids);
    const seenIn = [...group.files].sort();
    recipes.push({
      id,
      title,
      intents: [title],
      uses: group.names,
      summary: `Used together in ${seenIn.length} files.`,
      source: "detected",
      seenIn,
    });
  }
  recipes.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return recipes;
}

function usedComponents(file: string, source: string, catalog: Catalog): string[] {
  const parsed = parseUi(source, file);
  if (!parsed) return [];
  const locals = catalogLocals(parsed, file, catalog);
  const used = new Set<string>();
  visitJsx(parsed.tree, (node) => {
    if (node.kind !== "component") return;
    const name = locals.get(node.name);
    if (name) used.add(name);
  });
  return catalog.components.map((component) => component.name).filter((name) => used.has(name));
}

function moduleCount(names: string[], components: CatalogComponent[]): number {
  const files = new Set<string>();
  for (const name of names) {
    const component = components.find((entry) => entry.name === name);
    if (component) files.add(component.file);
  }
  return files.size;
}

function coveredByDeclared(names: string[], declared: Recipe[]): boolean {
  return declared.some((recipe) => names.every((name) => recipe.uses.includes(name)));
}

function compositionTitle(names: string[], components: CatalogComponent[]): string {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const component = components.find((entry) => entry.name === name);
    if (!component || seen.has(component.file)) continue;
    seen.add(component.file);
    const group = names.filter((candidate) => {
      const other = components.find((entry) => entry.name === candidate);
      return other?.file === component.file;
    });
    labels.push(primaryLabel(component.file, group));
  }
  return labels.join(" + ");
}

function primaryLabel(file: string, group: string[]): string {
  const base = file.split("/").pop()?.replace(/\.(tsx|jsx)$/, "") ?? "";
  const pascal = base
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return group.find((name) => name.toLowerCase() === pascal.toLowerCase()) ?? group[0] ?? pascal;
}

function uniqueId(stem: string, ids: Set<string>): string {
  let id = `detected-${stem || "composition"}`;
  let suffix = 2;
  while (ids.has(id)) {
    id = `detected-${stem || "composition"}-${suffix}`;
    suffix += 1;
  }
  ids.add(id);
  return id;
}

function isUiFile(file: string, config: Config, components: CatalogComponent[]): boolean {
  if (config.ui.some((dir) => isInsideDir(file, dir))) return true;
  const directory = posixDir(file);
  return components.some((component) => posixDir(component.file) === directory && directory !== "");
}

function stubCatalog(components: CatalogComponent[], paths: PathMapping[]): Catalog {
  return {
    version: 1,
    generatedAt: "",
    paths,
    components,
    tokens: [],
    recipes: [],
  };
}
