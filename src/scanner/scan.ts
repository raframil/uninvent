import { readFileSync } from "node:fs";
import path from "node:path";
import { UserError } from "../errors.js";
import { walkSourceFiles } from "../fs-walk.js";
import { resolveSpecifier, toImportPath, toPosix, type PathMapping } from "../paths.js";
import { detectRecipes } from "../recipes/detect.js";
import { RECIPES_FILE, finalizeRecipes, loadDeclaredRecipes } from "../recipes/parse.js";
import type { Catalog, CatalogComponent, Config } from "../types.js";
import {
  discoverStylesheet,
  discoverUiDirs,
  isGeneratedUiNoise,
  readPathMappings,
  readTokens,
} from "./discover.js";
import { extractFile } from "./extract.js";

export interface ScanResult {
  catalog: Catalog;
  summary: string;
}

export function scanProject(root: string, config: Config): ScanResult {
  const mappings = readPathMappings(root);
  const uiDirs = discoverUiDirs(root, config.ui, mappings);
  if (uiDirs.length === 0) {
    throw new UserError(
      [
        "No UI directory found.",
        "Looked for components.json aliases.ui, src/components/ui, and components/ui.",
        "Create the folder or re-run with --ui <dir>.",
      ].join("\n"),
    );
  }

  const components: CatalogComponent[] = [];
  for (const dir of uiDirs) {
    for (const file of walkSourceFiles(root, dir)) {
      if (isGeneratedUiNoise(file)) continue;
      const source = readFileSync(path.join(root, file), "utf8");
      for (const extracted of extractFile(file, source)) {
        components.push({
          ...extracted,
          file,
          importPath: toImportPath(file, mappings),
          stories: [],
        });
      }
    }
  }

  components.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  attachStories(root, components, mappings);

  const stylesheet = discoverStylesheet(root);
  const tokens = stylesheet ? readTokens(readFileSync(path.join(root, stylesheet), "utf8")) : [];
  const loaded = loadDeclaredRecipes(root);
  const finalized = finalizeRecipes(loaded.recipes, components);
  const detected = detectRecipes({
    root,
    config,
    components,
    paths: mappings,
    declared: finalized.recipes,
  });
  const catalog: Catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    paths: mappings,
    components,
    tokens,
    recipes: [...finalized.recipes, ...detected],
  };
  const storyCount = new Set(components.flatMap((component) => component.stories)).size;
  const declaredCount = finalized.recipes.length;
  const recipeLabel = declaredCount === 1 ? "recipe" : "recipes";
  let summary = `${components.length} components, ${storyCount} stories`;
  if (declaredCount > 0) summary += `, ${declaredCount} ${recipeLabel}`;
  summary += `, catalog written to ${toPosix(config.catalog)}`;
  const notes = [...loaded.warnings, ...finalized.warnings];
  if (detected.length > 0) {
    const hint = detected
      .map((recipe) => `${recipe.title} (${(recipe.seenIn ?? []).join(", ")})`)
      .join("; ");
    notes.push(`detected ${hint} — add a recipe to ${RECIPES_FILE} to check it`);
  }
  if (notes.length > 0) summary += `\n${notes.join("\n")}`;
  return { catalog, summary };
}

function attachStories(root: string, components: CatalogComponent[], mappings: PathMapping[]): void {
  const byFile = new Map<string, CatalogComponent[]>();
  for (const component of components) {
    const list = byFile.get(component.file) ?? [];
    list.push(component);
    byFile.set(component.file, list);
  }
  const stories = walkSourceFiles(root).filter((file) => /\.stories\.(tsx|jsx)$/.test(file));
  for (const story of stories) {
    const targets = new Set<string>();
    const source = readFileSync(path.join(root, story), "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveSpecifier(story, specifier, mappings);
      if (!resolved) continue;
      for (const file of byFile.keys()) {
        if (stripKnown(file) === resolved) targets.add(file);
      }
    }
    const base = story.replace(/\.stories\.(tsx|jsx)$/, "");
    for (const file of byFile.keys()) {
      if (stripKnown(file) === base) targets.add(file);
    }
    for (const file of targets) {
      for (const component of byFile.get(file) ?? []) {
        if (!component.stories.includes(story)) component.stories.push(story);
      }
    }
  }
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const pattern = /from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier) specs.push(specifier);
  }
  return specs;
}

function stripKnown(file: string): string {
  return file.replace(/\.(tsx|ts|jsx|js)$/, "");
}
