import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { toPosix } from "./paths.js";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".uninvent", ".next", ".turbo"]);

export function walkSourceFiles(root: string, dir = "."): string[] {
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
      if (!/\.(tsx|jsx)$/.test(entry.name)) continue;
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
