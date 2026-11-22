import path from "node:path";

export interface PathMapping {
  /** Alias prefix, including a trailing slash for wildcard patterns (`@/`). */
  prefix: string;
  /** Directory inside the project, with a trailing slash (`src/`). Empty means the project root. */
  target: string;
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** Project-relative posix path. A package outside the project starts with `..`. */
export function projectRelative(root: string, file: string): string {
  const relative = toPosix(path.relative(root, file));
  return relative === "" ? "." : relative;
}

export function stripExt(file: string): string {
  return file.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, "");
}

export function posixDir(file: string): string {
  const index = file.lastIndexOf("/");
  return index === -1 ? "" : file.slice(0, index);
}

export function posixNormalize(value: string): string {
  const absolute = value.startsWith("/");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined;
}

export function joinAlias(prefix: string, rest: string): string {
  const base = prefix.replace(/\/$/, "");
  const tail = rest.replace(/^\//, "");
  if (!base) return tail;
  if (!tail) return base;
  return `${base}/${tail}`;
}

/**
 * Turn a project-relative source file into the import specifier agents should paste.
 * Mappings are tried longest-target first so `@/components/ui/*` wins over `@/*`.
 */
export function toImportPath(relativeFile: string, mappings: PathMapping[]): string {
  const noExt = stripExt(toPosix(relativeFile));
  const ordered = [...mappings].sort((a, b) => b.target.length - a.target.length);
  for (const mapping of ordered) {
    if (mapping.target === "") continue;
    if (noExt === mapping.target.replace(/\/$/, "") || noExt.startsWith(mapping.target)) {
      const rest = noExt.slice(mapping.target.length);
      return joinAlias(mapping.prefix, rest);
    }
  }
  const fallback = ordered.find((mapping) => mapping.target === "");
  if (fallback) return joinAlias(fallback.prefix, noExt);
  if (noExt.startsWith("src/")) return `@/${noExt.slice(4)}`;
  return `@/${noExt}`;
}

/** Resolve an import specifier to a project-relative path without an extension. */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  mappings: PathMapping[],
): string | null {
  if (specifier.startsWith(".")) {
    const base = posixDir(toPosix(fromFile));
    const joined = posixNormalize(base ? `${base}/${specifier}` : specifier);
    return stripExt(joined);
  }
  const ordered = [...mappings].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const mapping of ordered) {
    if (specifier !== mapping.prefix.replace(/\/$/, "") && !specifier.startsWith(mapping.prefix)) {
      continue;
    }
    const rest = specifier.startsWith(mapping.prefix)
      ? specifier.slice(mapping.prefix.length)
      : "";
    const target = mapping.target.replace(/\/$/, "");
    const joined = target ? (rest ? `${target}/${rest}` : target) : rest;
    return stripExt(posixNormalize(joined));
  }
  return null;
}
