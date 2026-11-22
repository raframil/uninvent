import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { resolveSpecifier, toPosix, type PathMapping } from "../paths.js";

export interface ComponentsManifest {
  uiAlias?: string;
  css?: string;
}

export function readPathMappings(root: string): PathMapping[] {
  const tsconfig = path.join(root, "tsconfig.json");
  if (!existsSync(tsconfig)) return fallbackMappings(root);
  const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (read.error || !read.config) return fallbackMappings(root);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  const paths = parsed.options.paths ?? {};
  const baseUrl = parsed.options.baseUrl ?? root;
  const mappings: PathMapping[] = [];
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets?.[0];
    if (!target) continue;
    const star = key.indexOf("*");
    const prefix = star === -1 ? key : key.slice(0, star);
    const targetStar = target.indexOf("*");
    const targetPrefix = targetStar === -1 ? target : target.slice(0, targetStar);
    const absolute = path.resolve(baseUrl, targetPrefix);
    let relative = toPosix(path.relative(root, absolute));
    if (relative === "") relative = "";
    else if (!relative.endsWith("/")) relative += "/";
    mappings.push({ prefix, target: relative });
  }
  if (mappings.length === 0) return fallbackMappings(root);
  return mappings;
}

export function fallbackMappings(root: string): PathMapping[] {
  if (existsSync(path.join(root, "src"))) return [{ prefix: "@/", target: "src/" }];
  return [{ prefix: "@/", target: "" }];
}

export function readComponentsManifest(root: string): ComponentsManifest {
  const file = path.join(root, "components.json");
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      aliases?: { ui?: unknown };
      tailwind?: { css?: unknown };
    };
    return {
      uiAlias: typeof parsed.aliases?.ui === "string" ? parsed.aliases.ui : undefined,
      css: typeof parsed.tailwind?.css === "string" ? parsed.tailwind.css : undefined,
    };
  } catch {
    return {};
  }
}

export function discoverUiDirs(root: string, configured: string[], mappings: PathMapping[]): string[] {
  if (configured.length > 0) return configured;
  const manifest = readComponentsManifest(root);
  if (manifest.uiAlias) {
    const resolved = resolveSpecifier(".", manifest.uiAlias, mappings);
    if (resolved && existsSync(path.join(root, resolved))) return [resolved];
  }
  const candidates = [
    "src/components/ui",
    "components/ui",
    "app/components/ui",
    "src/app/components/ui",
  ];
  return candidates.filter((dir) => existsSync(path.join(root, dir)));
}

export function discoverStylesheet(root: string): string | null {
  const manifest = readComponentsManifest(root);
  const candidates = [
    manifest.css,
    "src/index.css",
    "src/app/globals.css",
    "app/globals.css",
    "src/styles/globals.css",
  ].filter((entry): entry is string => Boolean(entry));
  for (const candidate of candidates) {
    if (existsSync(path.join(root, candidate))) return toPosix(candidate);
  }
  return null;
}

/** CSS custom properties declared in the project's stylesheet. Not a token linter. */
export function readTokens(css: string): string[] {
  const names = new Set<string>();
  const pattern = /(^|[^\w-])(--[A-Za-z_][\w-]*)\s*:/g;
  for (const match of css.matchAll(pattern)) {
    const name = match[2];
    if (name) names.add(name);
    if (names.size >= 80) break;
  }
  return [...names].sort();
}

export function isGeneratedUiNoise(file: string): boolean {
  const base = file.split("/").pop() ?? file;
  return /\.(stories|test|spec)\.(tsx|ts|jsx|js|mdx)$/.test(base);
}
