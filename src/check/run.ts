import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { UserError } from "../errors.js";
import { isSourceFile, walkSourceFiles } from "../fs-walk.js";
import { toPosix } from "../paths.js";
import type { Catalog, Config, Finding, Reuse } from "../types.js";
import { analyzeSource } from "./analyze.js";
import { diffAgainst } from "./diff.js";

export interface CheckResult {
  findings: Finding[];
  reuses: Reuse[];
  parseErrors: string[];
}

export function checkProject(options: {
  root: string;
  config: Config;
  catalog: Catalog;
  targets: string[];
  base?: string;
}): CheckResult {
  const files = filesToCheck(options.root, options.targets, options.base);
  const findings: Finding[] = [];
  const reuses: Reuse[] = [];
  const parseErrors: string[] = [];
  for (const entry of files) {
    if (!isSourceFile(entry.file)) continue;
    const absolute = path.join(options.root, entry.file);
    if (!existsSync(absolute)) continue;
    const source = readFileSync(absolute, "utf8");
    const result = analyzeSource({
      source,
      file: entry.file,
      catalog: options.catalog,
      config: options.config,
      lines: entry.lines,
    });
    findings.push(...result.findings);
    reuses.push(...result.reuses);
    if (result.parseError) parseErrors.push(result.parseError);
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message));
  reuses.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  return { findings, reuses, parseErrors };
}

function filesToCheck(
  root: string,
  targets: string[],
  base: string | undefined,
): { file: string; lines?: Set<number> }[] {
  if (base) {
    const diff = diffAgainst(root, base);
    let entries = [...diff.entries()].map(([file, lines]) => ({ file, lines }));
    if (targets.length > 0) {
      const wanted = targets.map((target) => normalizeTarget(root, target));
      entries = entries.filter((entry) =>
        wanted.some((target) => entry.file === target || entry.file.startsWith(`${target}/`)),
      );
    }
    return entries;
  }
  if (targets.length === 0) return walkSourceFiles(root).map((file) => ({ file }));
  const files: string[] = [];
  for (const target of targets) {
    const relative = normalizeTarget(root, target);
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) throw new UserError(`No such file: ${target}`);
    if (statSync(absolute).isDirectory()) files.push(...walkSourceFiles(root, relative));
    else files.push(relative);
  }
  return files.map((file) => ({ file }));
}

function normalizeTarget(root: string, target: string): string {
  const absolute = path.isAbsolute(target) ? target : path.resolve(root, target);
  const relative = toPosix(path.relative(root, absolute));
  if (relative.startsWith("../") || relative === "..") {
    throw new UserError(`${target} is outside the project.`);
  }
  return relative === "" ? "." : relative;
}
