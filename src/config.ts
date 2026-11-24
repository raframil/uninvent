import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { UserError } from "./errors.js";
import { toPosix } from "./paths.js";
import type { PrimitiveConfig } from "./primitives.js";
import { DEFAULT_CATALOG, DEFAULT_IGNORE, type Config, type StatesConfig, type StatesSourceToggle } from "./types.js";

export interface ConfigFile {
  ui?: unknown;
  packages?: unknown;
  ignore?: unknown;
  catalog?: unknown;
  commitCatalog?: unknown;
  primitives?: unknown;
  states?: unknown;
}

export function findUp(start: string, fileName: string): string | null {
  let dir = path.resolve(start);
  const root = path.parse(dir).root;
  while (true) {
    if (existsSync(path.join(dir, fileName))) return dir;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

/**
 * Nearest directory that owns an uninvent project.
 * A nested `uninvent.json` (the demo app) wins over a parent `package.json`.
 */
export function findProjectRoot(start: string): string {
  const resolved = path.resolve(start);
  let origin = resolved;
  try {
    if (existsSync(resolved) && statSync(resolved).isFile()) origin = path.dirname(resolved);
  } catch {
    origin = resolved;
  }
  return (
    findUp(origin, "uninvent.json") ??
    findUp(origin, "components.json") ??
    findUp(origin, "package.json") ??
    origin
  );
}

export function loadConfig(root: string): Config {
  const file = path.join(root, "uninvent.json");
  if (!existsSync(file)) {
    return {
      ui: [],
      packages: [],
      ignore: [...DEFAULT_IGNORE],
      catalog: DEFAULT_CATALOG,
      commitCatalog: false,
      primitives: [],
    };
  }
  let parsed: ConfigFile;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as ConfigFile;
  } catch {
    throw new UserError(`Could not parse ${toPosix(path.relative(root, file)) || "uninvent.json"} as JSON.`);
  }
  return normalizeConfig(parsed);
}

export function normalizeConfig(parsed: ConfigFile): Config {
  const ui = Array.isArray(parsed.ui)
    ? parsed.ui.filter((entry): entry is string => typeof entry === "string").map(cleanDir)
    : [];
  const packages = Array.isArray(parsed.packages)
    ? parsed.packages.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map(cleanDir)
    : [];
  const ignore = Array.isArray(parsed.ignore)
    ? parsed.ignore.filter((entry): entry is string => typeof entry === "string")
    : [...DEFAULT_IGNORE];
  const catalog = typeof parsed.catalog === "string" && parsed.catalog.length > 0
    ? toPosix(parsed.catalog)
    : DEFAULT_CATALOG;
  const primitives = normalizePrimitives(parsed.primitives);
  const states = normalizeStates(parsed.states);
  return {
    ui,
    packages,
    ignore,
    catalog,
    commitCatalog: parsed.commitCatalog === true,
    primitives,
    ...(states ? { states } : {}),
  };
}

export function cleanDir(dir: string): string {
  return toPosix(dir).replace(/^\.\//, "").replace(/\/$/, "");
}

export function configDocument(config: Config): ConfigFile {
  const document: ConfigFile = {
    ui: config.ui,
    ignore: config.ignore,
    catalog: config.catalog,
    commitCatalog: config.commitCatalog,
  };
  if (config.packages.length > 0) document.packages = config.packages;
  if (config.primitives.length > 0) document.primitives = config.primitives;
  if (config.states) document.states = config.states;
  return document;
}

function normalizePrimitives(value: unknown): PrimitiveConfig[] {
  if (!Array.isArray(value)) return [];
  const list: PrimitiveConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { library?: unknown; packages?: unknown; parts?: unknown };
    const library = typeof record.library === "string" ? record.library.trim() : "";
    const packages = stringList(record.packages);
    if (!library || packages.length === 0) continue;
    const parts = normalizeParts(record.parts);
    list.push({ library, packages, ...(parts ? { parts } : {}) });
  }
  return list;
}

function normalizeParts(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const parts: Record<string, string[]> = {};
  for (const [name, elements] of Object.entries(value)) {
    const list = stringList(elements);
    if (!name.trim() || list.length === 0) continue;
    parts[name.trim()] = list;
  }
  return Object.keys(parts).length > 0 ? parts : undefined;
}

function normalizeStates(value: unknown): StatesConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const states: StatesConfig = {};
  const globs = stringList(entry.globs);
  if (globs.length > 0) states.globs = globs;
  if (entry.manifest === false) states.manifest = false;
  else if (typeof entry.manifest === "string" && entry.manifest.trim()) states.manifest = cleanDir(entry.manifest);
  for (const key of ["storybook", "ladle", "histoire", "jsdoc"] as const) {
    const toggle = normalizeToggle(entry[key]);
    if (toggle !== undefined) states[key] = toggle;
  }
  return Object.keys(states).length > 0 ? states : undefined;
}

function normalizeToggle(value: unknown): boolean | StatesSourceToggle | undefined {
  if (value === true || value === false) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const globs = stringList((value as { globs?: unknown }).globs);
  return globs.length > 0 ? { globs } : true;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

export function isInsideDir(file: string, dir: string): boolean {
  const relative = toPosix(file).replace(/^\.\//, "");
  const root = cleanDir(dir);
  return relative === root || relative.startsWith(`${root}/`);
}
