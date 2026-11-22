import { resolveSpecifier, stripExt } from "../paths.js";
import type { PathMapping } from "../paths.js";
import type { CatalogComponent, StoryArg, StoryDoc } from "../types.js";
import type { ParsedStoryModule } from "./parse.js";
import { relevantArgs } from "./states.js";

/**
 * Attach each story's literal args to the catalog component it documents.
 * Meta args apply to `meta.component`. JSX props apply to the tag they set.
 */
export function assignStoryDocs(
  file: string,
  parsed: ParsedStoryModule,
  components: CatalogComponent[],
  mappings: PathMapping[],
): Map<CatalogComponent, StoryDoc[]> {
  const imported = resolveImports(file, parsed, components, mappings);
  const base = storyBase(file);
  const fileComponents = components.filter((component) => stripExt(component.file) === base);
  const metaComponent = parsed.componentName
    ? imported.get(parsed.componentName) ?? fileComponents.find((component) => component.name === parsed.componentName)
    : undefined;
  const fallback = metaComponent ?? fallbackComponent(fileComponents, base);
  const docs = new Map<CatalogComponent, StoryDoc[]>();

  for (const story of parsed.stories) {
    const argsByComponent = new Map<CatalogComponent, StoryArg[]>();
    const target = metaComponent ?? fallback;
    if (target) argsByComponent.set(target, mergeArgs(parsed.metaArgs, story.args));
    for (const tag of story.tags) {
      const component = imported.get(tag.name) ?? fileComponents.find((entry) => entry.name === tag.name);
      if (!component) continue;
      const list = argsByComponent.get(component) ?? [];
      list.push(...tag.args);
      argsByComponent.set(component, list);
    }
    for (const [component, args] of argsByComponent) {
      const relevant = relevantArgs(mergeUnique(args));
      if (relevant.length === 0 && component !== target) continue;
      const list = docs.get(component) ?? [];
      list.push({ file, name: story.name, args: relevant });
      docs.set(component, list);
    }
  }
  return docs;
}

function resolveImports(
  file: string,
  parsed: ParsedStoryModule,
  components: CatalogComponent[],
  mappings: PathMapping[],
): Map<string, CatalogComponent> {
  const imported = new Map<string, CatalogComponent>();
  for (const specifier of parsed.imports) {
    const resolved = resolveSpecifier(file, specifier.from, mappings);
    if (!resolved) continue;
    const matches = components.filter((component) => stripExt(component.file) === resolved);
    const component = specifier.imported === "default"
      ? matches.find((entry) => entry.name === specifier.local) ?? (matches.length === 1 ? matches[0] : undefined)
      : matches.find((entry) => entry.name === specifier.imported);
    if (component) imported.set(specifier.local, component);
  }
  return imported;
}

function fallbackComponent(components: CatalogComponent[], base: string): CatalogComponent | undefined {
  if (components.length === 1) return components[0];
  const leaf = base.split("/").pop() ?? base;
  return components.find((component) => keyOf(component.name) === keyOf(leaf));
}

function storyBase(file: string): string {
  return stripExt(file.replace(/\.stories\.(tsx|ts|jsx|js|mdx)$/, "").replace(/\.mdx$/, ""));
}

function mergeArgs(base: StoryArg[], over: StoryArg[]): StoryArg[] {
  const names = new Set(over.map((arg) => arg.name));
  return [...base.filter((arg) => !names.has(arg.name)), ...over];
}

function mergeUnique(args: StoryArg[]): StoryArg[] {
  const seen = new Set<string>();
  const unique: StoryArg[] = [];
  for (const arg of args) {
    const key = `${arg.name}=${arg.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(arg);
  }
  return unique;
}

function keyOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
