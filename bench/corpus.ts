import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseDef } from "./score.js";

const benchRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export function corpusSource(): string {
  return path.join(benchRoot, "corpus");
}

export function casesFile(): string {
  return path.join(benchRoot, "cases.json");
}

export function resultsDir(): string {
  return path.join(benchRoot, "results");
}

export function repoRoot(): string {
  return path.resolve(benchRoot, "..");
}

export interface BenchManifest {
  existsQuery: string;
  readSource: string[];
  cases: CaseDef[];
}

export function loadManifest(): BenchManifest {
  const parsed = JSON.parse(readFileSync(casesFile(), "utf8")) as BenchManifest;
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("bench/cases.json has no cases.");
  }
  if (typeof parsed.existsQuery !== "string" || !Array.isArray(parsed.readSource)) {
    throw new Error("bench/cases.json needs existsQuery and readSource.");
  }
  return parsed;
}

export function copyCorpus(from: string, to: string): void {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes(".uninvent"),
  });
}
