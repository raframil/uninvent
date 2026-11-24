import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { readCatalog } from "../catalog.js";
import { analyzeSource } from "../check/analyze.js";
import { formatText } from "../check/format.js";
import { findProjectRoot, loadConfig } from "../config.js";
import { toPosix } from "../paths.js";
import { hookStdout, parseHookEvent, type HookEvent } from "./event.js";

const MAX_BYTES = 700_000;

export function runHook(options: {
  stdin?: string;
  file?: string;
  cwd: string;
}): { stdout: string; exitCode: number } {
  if (options.file) return runFile(options.file, options.cwd);
  const event = parseHookEvent(options.stdin ?? "");
  if (!event) return { stdout: "", exitCode: 0 };
  try {
    const lines = evaluate(event, options.cwd);
    return { stdout: hookStdout(event, lines), exitCode: 0 };
  } catch {
    return { stdout: event.host === "cline" ? "{}\n" : "", exitCode: 0 };
  }
}

function runFile(file: string, cwd: string): { stdout: string; exitCode: number } {
  const absolute = path.resolve(cwd, file);
  const root = findProjectRoot(absolute);
  const config = loadConfig(root);
  const catalog = readCatalog(root, config.catalog);
  const relative = toPosix(path.relative(root, absolute));
  const source = readFileSync(absolute, "utf8");
  const result = analyzeSource({ source, file: relative, catalog, config });
  return {
    stdout: formatText(result.findings),
    exitCode: result.findings.length > 0 ? 1 : 0,
  };
}

function evaluate(event: HookEvent, cwd: string): string[] {
  const paths = event.filePaths.length > 0 ? event.filePaths : [event.filePath];
  if (paths.length <= 1) {
    return evaluateOne({ ...event, filePath: paths[0] }, cwd);
  }
  const lines: string[] = [];
  for (const filePath of paths) {
    lines.push(...evaluateOne({ ...event, filePath, content: undefined, snippet: false }, cwd));
  }
  return lines;
}

function evaluateOne(event: HookEvent, cwd: string): string[] {
  const absolute = event.filePath ? path.resolve(event.cwd ?? cwd, event.filePath) : undefined;
  if (absolute && !/\.(tsx|jsx)$/.test(absolute)) return [];
  const root = findProjectRoot(absolute ?? event.cwd ?? cwd);
  const config = loadConfig(root);
  const catalog = readCatalog(root, config.catalog);
  const loaded = loadSource(event, absolute);
  if (!loaded) return [];
  const relative = absolute ? toPosix(path.relative(root, absolute)) : "scratch.tsx";
  if (relative.startsWith("../") || path.isAbsolute(relative)) return [];
  const result = analyzeSource({
    source: loaded.source,
    file: relative,
    catalog,
    config,
    snippet: loaded.snippet,
  });
  return result.findings.map((finding) => finding.message);
}

function loadSource(
  event: HookEvent,
  absolute: string | undefined,
): { source: string; snippet: boolean } | null {
  const preferDisk = event.phase === "post" && absolute && isReadableSource(absolute);
  if (preferDisk && absolute) {
    return { source: readFileSync(absolute, "utf8"), snippet: false };
  }
  if (event.content) return { source: event.content, snippet: event.snippet };
  if (absolute && isReadableSource(absolute)) {
    return { source: readFileSync(absolute, "utf8"), snippet: false };
  }
  return null;
}

function isReadableSource(file: string): boolean {
  try {
    const stat = statSync(file);
    return stat.isFile() && stat.size <= MAX_BYTES;
  } catch {
    return false;
  }
}
