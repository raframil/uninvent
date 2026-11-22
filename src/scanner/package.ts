import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { projectRelative } from "../paths.js";
import { matchPrimitive, type PrimitiveUse } from "../primitives.js";
import type { CatalogComponent } from "../types.js";
import { packageExportTargets, readPackageJson, type ResolvedPackage } from "../workspace.js";
import { extractFile, type ExtractedComponent } from "./extract.js";

const SOURCE_EXT = [".tsx", ".ts", ".jsx", ".d.ts", ".js", ".mjs", ".cjs"];
const MAX_FILES = 400;

interface EntryPoint {
  specifier: string;
  file: string;
}

interface ExportEdge {
  name: string;
  imported: string;
  from: string;
}

interface ModuleRecord {
  declared: ExtractedComponent[];
  edges: ExportEdge[];
}

/**
 * Catalog the public components of one package.
 * Source (`.tsx` / `.ts`) wins over a sibling `.d.ts`. Declarations are the fallback
 * when the package only shipped build output.
 */
export function scanPackage(projectRoot: string, pkg: ResolvedPackage): CatalogComponent[] {
  const meta = readPackageJson(pkg.dir);
  if (!meta) return [];
  const entries = entryPoints(pkg);
  const modules = new Map<string, ModuleRecord>();
  const byOrigin = new Map<string, { component: ExtractedComponent; file: string; specifiers: Set<string> }>();

  for (const entry of entries) {
    for (const [name, origin] of exportedComponents(pkg.dir, entry.file, modules, new Set())) {
      const key = `${origin.file}\0${origin.component.name}\0${name}`;
      const existing = byOrigin.get(key);
      if (existing) {
        existing.specifiers.add(entry.specifier);
        continue;
      }
      byOrigin.set(key, { component: { ...origin.component, name }, file: origin.file, specifiers: new Set([entry.specifier]) });
    }
  }

  const components: CatalogComponent[] = [];
  for (const item of byOrigin.values()) {
    const specifiers = orderSpecifiers(pkg.name, [...item.specifiers]);
    const importPath = specifiers[0] ?? pkg.name;
    const rest = specifiers.filter((specifier) => specifier !== importPath);
    const relative = projectRelative(projectRoot, item.file);
    components.push({
      ...item.component,
      file: relative,
      importPath,
      ...(rest.length > 0 ? { specifiers: rest } : {}),
      stories: [],
    });
  }
  components.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  return components;
}

export function entryPoints(pkg: ResolvedPackage): EntryPoint[] {
  const meta = readPackageJson(pkg.dir);
  const described = meta ? packageExportTargets(meta) : [];
  const entries: EntryPoint[] = [];
  const seen = new Set<string>();
  const add = (specifier: string, file: string) => {
    const key = `${specifier}\0${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ specifier, file });
  };

  if (described.length === 0) {
    for (const relative of ["src/index.tsx", "src/index.ts", "index.tsx", "index.ts", "dist/index.d.ts", "dist/index.js"]) {
      const file = preferSource(pkg.dir, path.join(pkg.dir, relative));
      if (file) add(pkg.name, file);
    }
    return entries;
  }

  for (const entry of described) {
    const wildcard = entry.targets.find((target) => target.includes("*"));
    if (wildcard && entry.subpath.includes("*")) {
      for (const match of expandWildcard(pkg.dir, wildcard)) {
        const subpath = subpathFromMatch(entry.subpath, wildcard, match.relative);
        const file = preferSource(pkg.dir, match.file);
        if (!subpath || !file) continue;
        add(specifierFor(pkg.name, subpath), file);
      }
    }
    const concrete = entry.targets.filter((target) => !target.includes("*"));
    if (concrete.length === 0 || entry.subpath.includes("*")) continue;
    const file = chooseFile(pkg.dir, concrete);
    if (file) add(specifierFor(pkg.name, entry.subpath), file);
  }
  return entries;
}

function exportedComponents(
  pkgDir: string,
  file: string,
  modules: Map<string, ModuleRecord>,
  seen: Set<string>,
): Map<string, { component: ExtractedComponent; file: string }> {
  const found = new Map<string, { component: ExtractedComponent; file: string }>();
  if (seen.has(file) || seen.size > MAX_FILES) return found;
  seen.add(file);
  const record = loadModule(pkgDir, file, modules);
  if (!record) return found;
  for (const component of record.declared) {
    found.set(component.name, { component, file });
  }
  for (const edge of record.edges) {
    if (edge.imported === "*") {
      const target = resolveModule(pkgDir, file, edge.from);
      if (!target) continue;
      for (const [name, origin] of exportedComponents(pkgDir, target, modules, seen)) {
        if (!found.has(name)) found.set(name, origin);
      }
      continue;
    }
    if (!isComponentName(edge.name)) continue;
    const target = resolveModule(pkgDir, file, edge.from);
    if (!target) {
      if (!found.has(edge.name)) found.set(edge.name, { component: externalComponent(edge.name, edge.from), file });
      continue;
    }
    const inner = exportedComponents(pkgDir, target, modules, seen);
    const origin = inner.get(edge.imported);
    if (origin) found.set(edge.name, { component: { ...origin.component, name: edge.name }, file: origin.file });
  }
  return found;
}

function externalComponent(name: string, specifier: string): ExtractedComponent {
  const primitive = matchPrimitive(specifier);
  const primitives: PrimitiveUse[] = primitive ? [primitive] : [];
  return { name, line: 1, props: [], extends: [], variants: [], primitives, elements: [] };
}

function loadModule(pkgDir: string, file: string, modules: Map<string, ModuleRecord>): ModuleRecord | null {
  const cached = modules.get(file);
  if (cached) return cached;
  let source = "";
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const relative = projectRelative(pkgDir, file);
  const record = { declared: extractFile(relative, source), edges: readReexports(relative, source) };
  modules.set(file, record);
  return record;
}

function readReexports(fileName: string, source: string): ExportEdge[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edges: ExportEdge[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = statement.moduleSpecifier.text;
    if (!statement.exportClause) {
      edges.push({ name: "*", imported: "*", from });
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      edges.push({ name: element.name.text, imported, from });
    }
  }
  return edges;
}

function chooseFile(pkgDir: string, targets: string[]): string | null {
  const candidates: string[] = [];
  for (const target of targets) {
    const resolved = resolveTarget(pkgDir, target);
    if (!resolved) continue;
    candidates.push(resolved);
    for (const alternative of sourceAlternatives(pkgDir, resolved)) candidates.push(alternative);
  }
  return bestFile(candidates);
}

function preferSource(pkgDir: string, file: string): string | null {
  if (!isFile(file) && !sourceAlternatives(pkgDir, file).some(isFile)) return null;
  return bestFile([file, ...sourceAlternatives(pkgDir, file)]);
}

function bestFile(candidates: string[]): string | null {
  const files = [...new Set(candidates.filter(isFile))];
  files.sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b));
  return files[0] ?? null;
}

function sourceRank(file: string): number {
  if (file.endsWith(".tsx") || file.endsWith(".jsx")) return 0;
  if (file.endsWith(".ts") && !file.endsWith(".d.ts")) return 1;
  if (file.endsWith(".d.ts")) return 3;
  return 4;
}

function sourceAlternatives(pkgDir: string, file: string): string[] {
  const relative = path.relative(pkgDir, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [];
  const stems = new Set<string>([stripSourceExt(relative)]);
  if (relative.replace(/\\/g, "/").startsWith("dist/")) stems.add(stripSourceExt(relative.replace(/\\/g, "/").replace(/^dist\//, "src/")));
  const found: string[] = [];
  for (const stem of stems) {
    for (const ext of [".tsx", ".ts", ".jsx"]) found.push(path.join(pkgDir, `${stem}${ext}`));
  }
  return found.filter((candidate) => isInside(pkgDir, candidate));
}

function stripSourceExt(file: string): string {
  const posix = file.replace(/\\/g, "/");
  if (posix.endsWith(".d.ts")) return posix.slice(0, -5);
  return posix.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, "");
}

function resolveTarget(pkgDir: string, target: string): string | null {
  if (!target.startsWith(".")) return null;
  const absolute = path.resolve(pkgDir, target);
  if (!isInside(pkgDir, absolute)) return null;
  if (isFile(absolute)) return absolute;
  if (isDirectory(absolute)) {
    for (const name of ["index.tsx", "index.ts", "index.d.ts", "index.js"]) {
      const candidate = path.join(absolute, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function resolveModule(pkgDir: string, fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const stem = stripSourceExt(base);
  const candidates = [
    base,
    ...SOURCE_EXT.map((ext) => `${stem}${ext}`),
    ...["index.tsx", "index.ts", "index.d.ts", "index.js"].map((name) => path.join(stem, name)),
  ];
  for (const candidate of candidates) {
    if (!isInside(pkgDir, candidate) || !isFile(candidate)) continue;
    return preferSource(pkgDir, candidate);
  }
  return null;
}

function expandWildcard(pkgDir: string, target: string): { relative: string; file: string }[] {
  const normalized = target.replace(/^\.\//, "");
  const star = normalized.indexOf("*");
  if (star === -1) return [];
  const prefix = normalized.slice(0, star);
  const suffix = normalized.slice(star + 1);
  if (prefix.includes("..") || suffix.includes("*")) return [];
  const dir = path.join(pkgDir, prefix);
  if (!isDirectory(dir)) return [];
  const matches: { relative: string; file: string }[] = [];
  for (const entry of safeRead(dir)) {
    if (!entry.isFile() || isNoiseFile(entry.name)) continue;
    if (suffix && !entry.name.endsWith(suffix)) continue;
    const relative = `${prefix}${entry.name}`.replace(/\\/g, "/");
    matches.push({ relative, file: path.join(dir, entry.name) });
  }
  return matches;
}

function subpathFromMatch(subpath: string, target: string, relative: string): string | null {
  const keyStar = subpath.indexOf("*");
  const targetStar = target.replace(/^\.\//, "").indexOf("*");
  if (keyStar === -1 || targetStar === -1) return null;
  const targetBody = target.replace(/^\.\//, "");
  const prefix = targetBody.slice(0, targetStar);
  const suffix = targetBody.slice(targetStar + 1);
  if (!relative.startsWith(prefix) || !relative.endsWith(suffix)) return null;
  const capture = relative.slice(prefix.length, relative.length - suffix.length);
  if (!capture || capture.includes("..")) return null;
  return `${subpath.slice(0, keyStar)}${capture}${subpath.slice(keyStar + 1)}`;
}

function specifierFor(packageName: string, subpath: string): string {
  if (subpath === "." || subpath === "./") return packageName;
  const rest = subpath.replace(/^\.\//, "");
  return rest ? `${packageName}/${rest}` : packageName;
}

function orderSpecifiers(packageName: string, specifiers: string[]): string[] {
  return [...new Set(specifiers)].sort((a, b) => {
    if (a === packageName) return -1;
    if (b === packageName) return 1;
    return a.length - b.length || a.localeCompare(b);
  });
}

function isNoiseFile(name: string): boolean {
  return /\.(stories|test|spec)\.(tsx|ts|jsx|js)$/.test(name) || name.endsWith(".map") || name === "package.json";
}

function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeRead(dir: string): import("node:fs").Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
