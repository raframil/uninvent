import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { TrialConfig } from "./types.js";

export function loadTrialConfig(file: string): TrialConfig {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as TrialConfig;
  if (parsed.schema !== 1 || !Array.isArray(parsed.repos)) {
    throw new Error(`Unsupported trial config ${file}`);
  }
  return parsed;
}

export function ensureParent(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
}
