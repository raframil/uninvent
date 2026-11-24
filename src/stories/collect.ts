import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { specifierExports } from "../catalog.js";
import { UserError } from "../errors.js";
import { isStoryFilename, walkAllFiles, walkNamedFiles, walkStoryFiles } from "../fs-walk.js";
import { matchesIgnore } from "../ignore.js";
import { projectRelative, resolveSpecifier, stripExt, type PathMapping } from "../paths.js";
import type { CatalogComponent, Config, StatesSourceInfo, StatesSourceToggle, StoryDoc } from "../types.js";
import { assignStoryDocs } from "./assign.js";
import { jsdocStates } from "./jsdoc.js";
import { manifestStories, type ManifestStory } from "./manifest.js";
import { parseStorySource } from "./parse.js";
import { deriveStates, relevantArgs } from "./states.js";

export interface CollectedStates {
  sources: StatesSourceInfo[];
  /** One line when the only thing found is a source scan does not parse. */
  note?: string;
  warnings: string[];
}

const VUE_NOTE =
  "No states source found. Histoire .story.vue files are Vue single-file components and are not parsed; use a React .story.tsx file or uninvent.states.json.";
const VUE_WARNING = "skipped Histoire Vue stories; React .story.tsx and uninvent.states.json are supported";

type Toggle = boolean | StatesSourceToggle | undefined;
type SourceMode = "on" | "off" | "auto";

/**
 * Read every states source that applies to this project and attach the
 * resulting docs. Storybook stays the CSF reader. Ladle uses that same reader.
 * Histoire React stories are CSF-shaped `.story.tsx` files. Vue SFCs are skipped.
 * A manifest and `@state` tags cover in-house docs.
 */
export function collectStates(
  root: string,
  components: CatalogComponent[],
  mappings: PathMapping[],
  packageDirs: string[],
  config: Config,
): CollectedStates {
  const warnings: string[] = [];
  const claimed = new Set<string>();
  const sources: StatesSourceInfo[] = [];
  const byFile = indexByFile(components);
  const deps = dependencyNames(root);
  const storybookSignal = existsSync(path.join(root, ".storybook")) || hasDependency(deps, "storybook", "@storybook/");
  const ladleSignal = existsSync(path.join(root, ".ladle")) || deps.has("@ladle/react") || deps.has("ladle");
  const histoireSignal =
    deps.has("histoire") ||
    existsSync(path.join(root, ".histoire")) ||
    ["histoire.config.ts", "histoire.config.js", "histoire.config.mjs", "histoire.config.mts"].some((name) =>
      existsSync(path.join(root, name)),
    );

  const csfDefault = namedFiles(root, packageDirs, isStoryFilename, walkStoryFiles);
  const histoireDefault = namedFiles(root, packageDirs, (name) => /\.story\.(tsx|ts|jsx|js)$/.test(name));
  const vueFiles = namedFiles(root, packageDirs, (name) => name.endsWith(".story.vue"));

  const storybookMode = mode(config.states?.storybook);
  const ladleMode = mode(config.states?.ladle);
  const histoireMode = mode(config.states?.histoire);
  const csfId = csfOwner(storybookMode, ladleMode, storybookSignal, ladleSignal, csfDefault.length > 0);
  if (csfId) {
    const toggle = csfId === "ladle" ? config.states?.ladle : config.states?.storybook;
    const files = chooseFiles(root, packageDirs, toggle, csfDefault).filter((file) => claim(claimed, file));
    absorbModules(root, files, csfId, components, mappings, byFile, sources);
  }

  const histoireOn =
    histoireMode === "on" || (histoireMode === "auto" && (histoireSignal || histoireDefault.length > 0 || vueFiles.length > 0));
  if (histoireOn) {
    const files = chooseFiles(root, packageDirs, config.states?.histoire, histoireDefault).filter((file) => claim(claimed, file));
    absorbModules(root, files, "histoire", components, mappings, byFile, sources);
  }

  if (config.states?.manifest !== false) {
    const relative = typeof config.states?.manifest === "string" ? config.states.manifest : "uninvent.states.json";
    const full = path.join(root, relative);
    if (existsSync(full) && claim(claimed, relative)) {
      const parsed = readManifest(full, relative);
      warnings.push(...parsed.warnings);
      attachManifest(relative, parsed.stories, components, sources);
    }
  }

  if (mode(config.states?.jsdoc) !== "off") {
    const jsdocGlobs = globsOf(config.states?.jsdoc);
    const files = [...new Set(components.map((component) => component.file))]
      .filter((file) => jsdocGlobs.length === 0 || matchesIgnore(file, jsdocGlobs))
      .sort();
    const hit: string[] = [];
    for (const file of files) {
      let source = "";
      try {
        source = readFileSync(path.join(root, file), "utf8");
      } catch {
        continue;
      }
      const names = components.filter((component) => component.file === file).map((component) => component.name);
      const states = jsdocStates(file, source, names);
      if (states.length === 0) continue;
      hit.push(file);
      for (const state of states) {
        for (const component of components.filter((entry) => entry.file === file && entry.name === state.component)) {
          pushDoc(component, { file, name: state.name, args: relevantArgs(state.args) });
        }
      }
    }
    if (hit.length > 0) sources.push({ id: "jsdoc", files: hit });
  }

  const extra = globsOf(config.states);
  if (extra.length > 0) {
    const files = matchGlobs(root, packageDirs, extra).filter((file) => claim(claimed, file));
    const modules: string[] = [];
    const manifests: string[] = [];
    for (const file of files) {
      if (file.endsWith(".vue")) continue;
      if (file.endsWith(".json")) {
        manifests.push(file);
        continue;
      }
      modules.push(file);
    }
    absorbModules(root, modules, "glob", components, mappings, byFile, sources);
    for (const file of manifests) {
      const full = path.join(root, file);
      if (!existsSync(full)) continue;
      const parsed = readManifest(full, file);
      warnings.push(...parsed.warnings);
      attachManifest(file, parsed.stories, components, sources, "glob");
    }
  }

  for (const component of components) {
    component.storyDocs ??= [];
    component.states = deriveStates(component, component.storyDocs);
  }

  if (vueFiles.length > 0) warnings.push(VUE_WARNING);
  const note = sources.length === 0 && vueFiles.length > 0 ? VUE_NOTE : undefined;
  return { sources, ...(note ? { note } : {}), warnings };
}

function absorbModules(
  root: string,
  files: string[],
  id: string,
  components: CatalogComponent[],
  mappings: PathMapping[],
  byFile: Map<string, CatalogComponent[]>,
  sources: StatesSourceInfo[],
): void {
  const read: string[] = [];
  for (const file of files) {
    let source = "";
    try {
      source = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    read.push(file);
    for (const target of storyTargets(file, source, byFile, mappings)) {
      for (const component of byFile.get(target) ?? []) {
        if (!component.stories.includes(file)) component.stories.push(file);
      }
    }
    const parsed = parseStorySource(file, source);
    for (const [component, docs] of assignStoryDocs(file, parsed, components, mappings)) {
      for (const doc of docs) pushDoc(component, doc);
    }
  }
  if (read.length > 0) pushSource(sources, id, read);
}

function attachManifest(
  file: string,
  stories: ManifestStory[],
  components: CatalogComponent[],
  sources: StatesSourceInfo[],
  id = "manifest",
): void {
  for (const story of stories) {
    const targets = components.filter((component) => {
      if (component.name !== story.component) return false;
      if (story.file && component.file !== story.file) return false;
      return true;
    });
    for (const component of targets) {
      if (!component.stories.includes(file)) component.stories.push(file);
      pushDoc(component, { file, name: story.name, args: relevantArgs(story.args) });
    }
  }
  pushSource(sources, id, [file]);
}

function readManifest(full: string, relative: string): { stories: ManifestStory[]; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(full, "utf8")) as unknown;
  } catch {
    throw new UserError(`Could not parse ${relative} as JSON.`);
  }
  const result = manifestStories(parsed);
  return { stories: result.stories, warnings: result.warnings.map((warning) => `${relative}: ${warning}`) };
}

function pushDoc(component: CatalogComponent, doc: StoryDoc): void {
  const list = component.storyDocs ?? [];
  component.storyDocs = [...list, doc];
}

function pushSource(sources: StatesSourceInfo[], id: string, files: string[]): void {
  const existing = sources.find((source) => source.id === id);
  if (!existing) {
    sources.push({ id, files: [...files] });
    return;
  }
  for (const file of files) {
    if (!existing.files.includes(file)) existing.files.push(file);
  }
}

function storyTargets(
  story: string,
  source: string,
  byFile: Map<string, CatalogComponent[]>,
  mappings: PathMapping[],
): Set<string> {
  const targets = new Set<string>();
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveSpecifier(story, specifier, mappings);
    if (resolved) {
      for (const file of byFile.keys()) {
        if (stripExt(file) === resolved) targets.add(file);
      }
    }
    for (const file of byFile.keys()) {
      const components = byFile.get(file) ?? [];
      if (components.some((component) => specifierExports(component, specifier))) targets.add(file);
    }
  }
  const base = story
    .replace(/\.stories\.(tsx|ts|jsx|js|mdx)$/, "")
    .replace(/\.story\.(tsx|ts|jsx|js)$/, "")
    .replace(/\.mdx$/, "");
  for (const file of byFile.keys()) {
    if (stripExt(file) === base) targets.add(file);
  }
  return targets;
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

function indexByFile(components: CatalogComponent[]): Map<string, CatalogComponent[]> {
  const byFile = new Map<string, CatalogComponent[]>();
  for (const component of components) {
    const list = byFile.get(component.file) ?? [];
    list.push(component);
    byFile.set(component.file, list);
  }
  return byFile;
}

function csfOwner(
  storybookMode: SourceMode,
  ladleMode: SourceMode,
  storybookSignal: boolean,
  ladleSignal: boolean,
  hasCsfFiles: boolean,
): "storybook" | "ladle" | null {
  const ladleOn = ladleMode === "on" || (ladleMode === "auto" && ladleSignal);
  const storyOn = storybookMode === "on" || (storybookMode === "auto" && (storybookSignal || hasCsfFiles));
  if (ladleOn && storybookMode !== "on" && !storybookSignal) return "ladle";
  if (storyOn) return "storybook";
  if (ladleOn) return "ladle";
  return null;
}

function chooseFiles(root: string, packageDirs: string[], toggle: Toggle, fallback: string[]): string[] {
  const globs = globsOf(toggle);
  if (globs.length > 0) return matchGlobs(root, packageDirs, globs);
  return fallback;
}

function namedFiles(
  root: string,
  packageDirs: string[],
  include: (name: string) => boolean,
  walk: (dir: string) => string[] = (dir) => walkNamedFiles(dir, ".", include),
): string[] {
  const files = new Set(walk(root));
  for (const dir of packageDirs) {
    for (const relative of walk(dir)) files.add(projectRelative(root, path.join(dir, relative)));
  }
  return [...files].sort();
}

function matchGlobs(root: string, packageDirs: string[], globs: string[]): string[] {
  const files = new Set(walkAllFiles(root).filter((file) => matchesIgnore(file, globs)));
  for (const dir of packageDirs) {
    for (const relative of walkAllFiles(dir)) {
      const projectFile = projectRelative(root, path.join(dir, relative));
      if (matchesIgnore(projectFile, globs) || matchesIgnore(relative, globs)) files.add(projectFile);
    }
  }
  return [...files].sort();
}

function claim(claimed: Set<string>, file: string): boolean {
  if (claimed.has(file)) return false;
  claimed.add(file);
  return true;
}

function mode(value: Toggle): SourceMode {
  if (value === false) return "off";
  if (value === true || (value !== undefined && typeof value === "object")) return "on";
  return "auto";
}

function globsOf(value: Toggle | Config["states"]): string[] {
  if (!value || typeof value === "boolean") return [];
  return value.globs ?? [];
}

function dependencyNames(root: string): Set<string> {
  const file = path.join(root, "package.json");
  if (!existsSync(file)) return new Set();
  try {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function hasDependency(deps: Set<string>, name: string, prefix: string): boolean {
  if (deps.has(name)) return true;
  for (const dep of deps) {
    if (dep === prefix || dep.startsWith(`${prefix}`)) return true;
  }
  return false;
}
