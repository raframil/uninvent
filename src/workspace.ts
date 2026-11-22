import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A package uninvent can scan.
 * `dir` is the real directory that contains package.json.
 */
export interface ResolvedPackage {
  name: string;
  dir: string;
}

export interface PackageManifest {
  name?: string;
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

const SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git", ".uninvent", ".next", ".turbo"]);

/** `@acme/ui` and `ui`. A path (`packages/ui`, `./packages/ui`) is not a name. */
export function isPackageName(spec: string): boolean {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length === 2 && (parts[0]?.length ?? 0) > 1 && (parts[1]?.length ?? 0) > 0;
  }
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(spec);
}

export function isDesignSystemName(name: string): boolean {
  return /(^|\/)(ui|design-system|ui-kit)$/i.test(name);
}

export function readPackageJson(dir: string): PackageManifest | null {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * Resolve a config entry to a package directory.
 * Workspace packages win over `node_modules`, so a monorepo scans source
 * (and its stories) when both exist. Pass a path to force one directory.
 */
export function resolvePackage(projectRoot: string, spec: string): ResolvedPackage | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (!isPackageName(trimmed)) return packageFromPath(projectRoot, trimmed);
  const workspace = listWorkspacePackages(projectRoot).find((pkg) => pkg.name === trimmed);
  if (workspace) return workspace;
  return packageFromNodeModules(projectRoot, trimmed);
}

export function listWorkspacePackages(start: string): ResolvedPackage[] {
  const found = new Map<string, ResolvedPackage>();
  let dir = path.resolve(start);
  const root = path.parse(dir).root;
  while (true) {
    const globs = readWorkspaceGlobs(dir);
    if (globs) {
      for (const pattern of globs) {
        for (const pkgDir of expandWorkspaceGlob(dir, pattern)) {
          const meta = readPackageJson(pkgDir);
          if (!meta?.name || found.has(meta.name)) continue;
          found.set(meta.name, { name: meta.name, dir: tryRealpath(pkgDir) });
        }
      }
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...found.values()];
}

/**
 * Workspace packages named like a design system, plus installed dependencies
 * with those names. From an app, a workspace package counts only when the app
 * depends on it. Other names are configured with `packages` or `--package`.
 */
export function discoverDesignPackages(projectRoot: string): string[] {
  const names = new Set<string>();
  const self = readPackageJson(projectRoot)?.name;
  const deps = dependencyNames(readPackageJson(projectRoot));
  const atRoot = isWorkspaceRoot(projectRoot);
  for (const pkg of listWorkspacePackages(projectRoot)) {
    if (pkg.name === self) continue;
    if (tryRealpath(pkg.dir) === tryRealpath(projectRoot)) continue;
    if (!isDesignSystemName(pkg.name)) continue;
    if (!atRoot && !deps.has(pkg.name)) continue;
    names.add(pkg.name);
  }
  for (const name of deps) {
    if (!isDesignSystemName(name) || names.has(name)) continue;
    if (resolvePackage(projectRoot, name)) names.add(name);
  }
  return [...names].sort();
}

export function isWorkspaceRoot(dir: string): boolean {
  return readWorkspaceGlobs(dir) !== null;
}

function dependencyNames(pkg: PackageManifest | null): Set<string> {
  if (!pkg) return new Set();
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
}

function packageFromPath(projectRoot: string, spec: string): ResolvedPackage | null {
  const absolute = path.resolve(projectRoot, spec);
  const dir = existsSync(absolute) && statSync(absolute).isFile() ? path.dirname(absolute) : absolute;
  const meta = readPackageJson(dir);
  if (!meta?.name) return null;
  return { name: meta.name, dir: tryRealpath(dir) };
}

function packageFromNodeModules(start: string, name: string): ResolvedPackage | null {
  let dir = path.resolve(start);
  const root = path.parse(dir).root;
  const parts = name.split("/");
  while (true) {
    const candidate = path.join(dir, "node_modules", ...parts);
    if (existsSync(path.join(candidate, "package.json"))) {
      const meta = readPackageJson(candidate);
      if (meta?.name) return { name: meta.name, dir: tryRealpath(candidate) };
    }
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readWorkspaceGlobs(dir: string): string[] | null {
  const pnpm = readPnpmGlobs(dir);
  const npm = readNpmGlobs(dir);
  if (pnpm === null && npm === null) return null;
  return [...new Set([...(pnpm ?? []), ...(npm ?? [])])];
}

function readNpmGlobs(dir: string): string[] | null {
  const pkg = readPackageJson(dir);
  if (!pkg || pkg.workspaces === undefined) return null;
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces.filter((entry): entry is string => typeof entry === "string");
  if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
    return pkg.workspaces.packages.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

/** The `packages:` list from pnpm-workspace.yaml. No YAML dependency: the file is a short list. */
function readPnpmGlobs(dir: string): string[] | null {
  const file = path.join(dir, "pnpm-workspace.yaml");
  if (!existsSync(file)) return null;
  const globs: string[] = [];
  let inPackages = false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim() === "") continue;
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      const inline = line.match(/^packages\s*:\s*\[(.*)\]\s*$/);
      if (inline?.[1] !== undefined) {
        for (const part of inline[1].split(",")) {
          const value = unquote(part.trim());
          if (value) globs.push(value);
        }
        inPackages = false;
      }
      continue;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (!item?.[1]) {
      if (/^\S/.test(line)) inPackages = false;
      continue;
    }
    const value = unquote(item[1].replace(/\s+#.*$/, "").trim());
    if (value) globs.push(value);
  }
  return globs;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function expandWorkspaceGlob(root: string, pattern: string): string[] {
  const cleaned = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!cleaned || cleaned.includes("..")) return [];
  const parts = cleaned.split("/");
  let dirs = [root];
  for (const part of parts) {
    const next: string[] = [];
    for (const dir of dirs) {
      if (part === "**") next.push(...descendantDirs(dir));
      else if (part === "*") next.push(...childDirs(dir));
      else {
        const candidate = path.join(dir, part);
        if (isDirectory(candidate)) next.push(candidate);
      }
    }
    dirs = next;
  }
  return dirs.filter((dir) => existsSync(path.join(dir, "package.json")));
}

function childDirs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of safeRead(dir)) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    found.push(path.join(dir, entry.name));
  }
  return found;
}

function descendantDirs(dir: string): string[] {
  const found: string[] = [];
  const stack = childDirs(dir);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    found.push(current);
    stack.push(...childDirs(current));
  }
  return found;
}

function safeRead(dir: string): import("node:fs").Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function tryRealpath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

export function packageExportTargets(pkg: PackageManifest): { subpath: string; targets: string[] }[] {
  const exportsField = pkg.exports;
  if (typeof exportsField === "string") return [{ subpath: ".", targets: [exportsField] }];
  if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    const record = exportsField as Record<string, unknown>;
    const subpaths = Object.keys(record).filter((key) => key.startsWith("."));
    if (subpaths.length > 0) {
      return subpaths
        .map((subpath) => ({ subpath, targets: stringLeaves(record[subpath]) }))
        .filter((entry) => entry.targets.length > 0 && entry.subpath !== "./package.json");
    }
    const root = stringLeaves(record);
    if (root.length > 0) return [{ subpath: ".", targets: root }];
  }
  const fallback = [pkg.types, pkg.typings, pkg.module, pkg.main].filter((entry): entry is string => typeof entry === "string");
  return fallback.length > 0 ? [{ subpath: ".", targets: fallback }] : [];
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const found: string[] = [];
  for (const entry of Object.values(value)) found.push(...stringLeaves(entry));
  return found;
}
