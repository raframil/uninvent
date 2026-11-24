import { readFileSync } from "node:fs";
import path from "node:path";
import { UserError } from "../errors.js";
import { walkSourceFiles } from "../fs-walk.js";
import { projectRelative, toImportPath, toPosix } from "../paths.js";
import { resolveLibraries } from "../primitives.js";
import { detectRecipes } from "../recipes/detect.js";
import { RECIPES_FILE, finalizeRecipes, loadDeclaredRecipes } from "../recipes/parse.js";
import { collectStates } from "../stories/collect.js";
import type { Catalog, CatalogComponent, CatalogPackage, Config } from "../types.js";
import { resolvePackage, type ResolvedPackage } from "../workspace.js";
import {
  discoverStylesheet,
  discoverUiDirs,
  isGeneratedUiNoise,
  readPathMappings,
  readTokens,
} from "./discover.js";
import { extractFile } from "./extract.js";
import { scanPackage } from "./package.js";

export interface ScanResult {
  catalog: Catalog;
  summary: string;
}

const NO_SOURCE = [
  "No design-system source found.",
  "Looked for components.json aliases.ui, src/components/ui, components/ui, and the packages in uninvent.json.",
  "Re-run with --ui <dir> or --package <name>.",
].join("\n");

export function resolveConfiguredPackages(root: string, specs: string[]): ResolvedPackage[] {
  const resolved: ResolvedPackage[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const pkg = resolvePackage(root, spec);
    if (!pkg) {
      throw new UserError(
        [
          `Could not resolve design-system package ${spec}.`,
          "Looked for a workspace package (pnpm-workspace.yaml or package.json workspaces) and for node_modules walking up from the project.",
          "Pass a package name (@acme/ui) or a path (packages/ui).",
        ].join("\n"),
      );
    }
    if (seen.has(pkg.dir)) continue;
    seen.add(pkg.dir);
    resolved.push(pkg);
  }
  return resolved;
}

export function scanProject(root: string, config: Config): ScanResult {
  const mappings = readPathMappings(root);
  const uiDirs = discoverUiDirs(root, config.ui, mappings);
  const packages = resolveConfiguredPackages(root, config.packages);
  if (uiDirs.length === 0 && packages.length === 0) throw new UserError(NO_SOURCE);
  const libraries = resolveLibraries(config.primitives);

  const components: CatalogComponent[] = [];
  for (const dir of uiDirs) {
    for (const file of walkSourceFiles(root, dir)) {
      if (isGeneratedUiNoise(file)) continue;
      const source = readFileSync(path.join(root, file), "utf8");
      for (const extracted of extractFile(file, source, libraries)) {
        components.push({
          ...extracted,
          file,
          importPath: toImportPath(file, mappings),
          stories: [],
        });
      }
    }
  }

  const catalogPackages: CatalogPackage[] = [];
  for (const pkg of packages) {
    catalogPackages.push({ name: pkg.name, dir: projectRelative(root, pkg.dir) });
    for (const component of scanPackage(root, pkg, libraries)) mergeComponent(components, component);
  }

  components.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  const states = collectStates(root, components, mappings, packages.map((pkg) => pkg.dir), config);

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
    packageDirs: catalogPackages.map((pkg) => pkg.dir),
  });
  const catalog: Catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    paths: mappings,
    components,
    tokens,
    recipes: [...finalized.recipes, ...detected],
    ...(catalogPackages.length > 0 ? { packages: catalogPackages } : {}),
    statesSources: states.sources,
    ...(states.note ? { statesNote: states.note } : {}),
  };
  const storyCount = new Set(components.flatMap((component) => component.stories)).size;
  const stateCount = components.reduce((sum, component) => sum + (component.states?.length ?? 0), 0);
  const declaredCount = finalized.recipes.length;
  const recipeLabel = declaredCount === 1 ? "recipe" : "recipes";
  const storyLabel = storyCount === 1 ? "story" : "stories";
  let summary = `${components.length} components, ${storyCount} ${storyLabel}`;
  if (stateCount > 0) summary += `, ${stateCount} ${stateCount === 1 ? "state" : "states"}`;
  if (declaredCount > 0) summary += `, ${declaredCount} ${recipeLabel}`;
  if (catalogPackages.length > 0) summary += `, packages ${catalogPackages.map((pkg) => pkg.name).join(", ")}`;
  summary += `, catalog written to ${toPosix(config.catalog)}`;
  const notes = [...loaded.warnings, ...finalized.warnings, ...states.warnings];
  if (detected.length > 0) {
    const hint = detected
      .map((recipe) => `${recipe.title} (${(recipe.seenIn ?? []).join(", ")})`)
      .join("; ");
    notes.push(`detected ${hint} — add a recipe to ${RECIPES_FILE} to check it`);
  }
  if (notes.length > 0) summary += `\n${notes.join("\n")}`;
  return { catalog, summary };
}

function mergeComponent(components: CatalogComponent[], component: CatalogComponent): void {
  const existing = components.find((entry) => entry.file === component.file && entry.name === component.name);
  if (!existing) {
    components.push(component);
    return;
  }
  const specifiers = new Set([
    existing.importPath,
    ...(existing.specifiers ?? []),
    component.importPath,
    ...(component.specifiers ?? []),
  ]);
  specifiers.delete(existing.importPath);
  const extra = [...specifiers].sort();
  if (extra.length > 0) existing.specifiers = extra;
}

