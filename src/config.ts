import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { UserError } from "./errors.js";
import { toPosix } from "./paths.js";
import { DEFAULT_CATALOG, DEFAULT_IGNORE, type Config } from "./types.js";

export interface ConfigFile {
  ui?: unknown;
  ignore?: unknown;
  catalog?: unknown;
  commitCatalog?: unknown;
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
      ignore: [...DEFAULT_IGNORE],
      catalog: DEFAULT_CATALOG,
      commitCatalog: false,
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
  const ignore = Array.isArray(parsed.ignore)
    ? parsed.ignore.filter((entry): entry is string => typeof entry === "string")
    : [...DEFAULT_IGNORE];
  const catalog = typeof parsed.catalog === "string" && parsed.catalog.length > 0
    ? toPosix(parsed.catalog)
    : DEFAULT_CATALOG;
  return {
    ui,
    ignore,
    catalog,
    commitCatalog: parsed.commitCatalog === true,
  };
}

export function cleanDir(dir: string): string {
  return toPosix(dir).replace(/^\.\//, "").replace(/\/$/, "");
}

export function configDocument(config: Config): ConfigFile {
  return {
    ui: config.ui,
    ignore: config.ignore,
    catalog: config.catalog,
    commitCatalog: config.commitCatalog,
  };
}

export function isInsideDir(file: string, dir: string): boolean {
  const relative = toPosix(file).replace(/^\.\//, "");
  const root = cleanDir(dir);
  return relative === root || relative.startsWith(`${root}/`);
}
