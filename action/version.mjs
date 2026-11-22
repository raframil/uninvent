#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_VERSION = /^(?:latest|next|[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?)$/;

/**
 * @param {{ requested?: string, actionPackageVersion: string, localBuildExists: boolean }} input
 * @returns {{ source: "local" } | { source: "npm", version: string }}
 */
export function resolveVersion(input) {
  const requested = String(input.requested ?? "").trim().replace(/^v(?=\d)/, "");
  if (requested === "local") {
    if (!input.localBuildExists) {
      throw new Error("version=local requires dist/cli.js. Build this repo first (npm run build).");
    }
    return { source: "local" };
  }
  if (requested === "") {
    if (input.localBuildExists) return { source: "local" };
    return { source: "npm", version: assertVersion(input.actionPackageVersion) };
  }
  return { source: "npm", version: assertVersion(requested) };
}

/**
 * @param {string} version
 */
function assertVersion(version) {
  if (!SAFE_VERSION.test(version)) {
    throw new Error(
      `Invalid uninvent version "${version}". Use a semver (0.3.0), latest, next, or local.`,
    );
  }
  return version;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const requested = process.argv[2] ?? "";
  const actionPath = process.argv[3];
  if (!actionPath) {
    process.stderr.write("version.mjs needs the action directory.\n");
    process.exit(1);
  }
  try {
    const pkgPath = path.join(actionPath, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const decision = resolveVersion({
      requested,
      actionPackageVersion: typeof pkg.version === "string" ? pkg.version : "",
      localBuildExists: existsSync(path.join(actionPath, "dist", "cli.js")),
    });
    if (decision.source === "local") process.stdout.write("local\n");
    else process.stdout.write(`npm ${decision.version}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
