import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { toPosix } from "./paths.js";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".uninvent", ".next", ".turbo"]);

export function walkSourceFiles(root: string, dir = "."): string[] {
  return walkFiles(root, dir, (name) => /\.(tsx|jsx)$/.test(name));
}

/** CSF and MDX story files. Not limited to the design-system folder. */
export function walkStoryFiles(root: string, dir = "."): string[] {
  return walkFiles(root, dir, isStoryFilename);
}

export function isStoryFilename(name: string): boolean {
  return /\.stories\.(tsx|ts|jsx|js|mdx)$/.test(name) || name.endsWith(".mdx");
}

function walkFiles(root: string, dir: string, include: (name: string) => boolean): string[] {
  const start = path.resolve(root, dir);
  const files: string[] = [];
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!include(entry.name)) continue;
      files.push(toPosix(path.relative(root, full)));
    }
  }
  files.sort();
  return files;
}

export function isSourceFile(file: string): boolean {
  return /\.(tsx|jsx)$/.test(file);
}

export function fileExistsAsFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
