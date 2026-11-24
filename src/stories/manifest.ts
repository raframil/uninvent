import type { StoryArg } from "../types.js";

export interface ManifestStory {
  component: string;
  file?: string;
  name: string;
  args: StoryArg[];
}

/**
 * `uninvent.states.json`.
 *
 * A component name maps to stories. A string is shorthand (`loading`,
 * `variant=destructive`). An object sets the story name and literal args.
 * `components` is the same list with an optional `file` when two components
 * share a name.
 */
export function manifestStories(value: unknown): { stories: ManifestStory[]; warnings: string[] } {
  const stories: ManifestStory[] = [];
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push("The states manifest must be a JSON object.");
    return { stories, warnings };
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.components)) {
    for (const entry of record.components) addComponentEntry(entry, stories, warnings);
  }
  for (const [name, entry] of Object.entries(record)) {
    if (name === "components") continue;
    stories.push(...storiesFromValue(name, undefined, entry, warnings));
  }
  return { stories, warnings };
}

function addComponentEntry(value: unknown, stories: ManifestStory[], warnings: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const entry = value as { name?: unknown; file?: unknown; stories?: unknown };
  if (typeof entry.name !== "string" || entry.name.length === 0) return;
  const file = typeof entry.file === "string" && entry.file.length > 0 ? entry.file : undefined;
  stories.push(...storiesFromValue(entry.name, file, entry.stories, warnings));
}

function storiesFromValue(
  component: string,
  file: string | undefined,
  value: unknown,
  warnings: string[],
): ManifestStory[] {
  if (typeof value === "string") {
    const story = storyFromShorthand(component, file, value);
    return story ? [story] : [];
  }
  if (!Array.isArray(value)) {
    warnings.push(`States for ${component} must be an array.`);
    return [];
  }
  const stories: ManifestStory[] = [];
  for (const entry of value) {
    const story = storyFromEntry(component, file, entry);
    if (story) stories.push(story);
  }
  return stories;
}

function storyFromEntry(component: string, file: string | undefined, value: unknown): ManifestStory | null {
  if (typeof value === "string") return storyFromShorthand(component, file, value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as { name?: unknown; args?: unknown };
  if (typeof entry.name !== "string" || entry.name.length === 0) return null;
  return { component, ...(file ? { file } : {}), name: entry.name, args: argsFrom(entry.args) };
}

function storyFromShorthand(component: string, file: string | undefined, text: string): ManifestStory | null {
  const parsed = parseStateSpec(text);
  if (!parsed) return null;
  return {
    component,
    ...(file ? { file } : {}),
    name: parsed.story,
    args: [{ name: parsed.prop, value: parsed.value }],
  };
}

export function parseStateSpec(text: string): { prop: string; value: string; story: string } | null {
  const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0);
  const spec = tokens[0];
  if (!spec) return null;
  if (spec.includes("=")) {
    const eq = spec.indexOf("=");
    const prop = spec.slice(0, eq);
    const value = spec.slice(eq + 1);
    if (!prop || !value) return null;
    return { prop, value, story: tokens[1] ?? titleWord(value) };
  }
  return { prop: spec, value: "true", story: tokens[1] ?? titleWord(spec) };
}

function argsFrom(value: unknown): StoryArg[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const args: StoryArg[] = [];
  for (const [name, raw] of Object.entries(value)) {
    if (args.length >= 16) break;
    const literal = literalArg(raw);
    if (literal === null) continue;
    args.push({ name, value: literal });
  }
  return args;
}

function literalArg(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function titleWord(value: string): string {
  if (!value) return "State";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
