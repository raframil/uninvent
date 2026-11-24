#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enableCompileCache, flushCompileCache } from "./compile-cache.js";
import { UserError } from "./errors.js";

// Turn the compile cache on before the command modules load.
enableCompileCache();

const BOOLEAN_FLAGS = new Set(["help", "h", "version", "v", "commit", "pre", "force"]);
const VALUE_FLAGS = new Set(["cwd", "format", "base", "file", "ui", "package", "agent"]);

/** Enough of the argument list to choose the hook entry without loading the rest of the CLI. */
function peekCommand(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === "--") return undefined;
    if (!token.startsWith("-")) return token;
    const body = token.startsWith("--") ? token.slice(2) : token.slice(1);
    const eq = body.indexOf("=");
    const flag = eq === -1 ? body : body.slice(0, eq);
    if (eq !== -1 || BOOLEAN_FLAGS.has(flag)) continue;
    if (VALUE_FLAGS.has(flag)) index += 1;
  }
  return undefined;
}

function fail(error: unknown): never {
  if (error instanceof UserError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

async function start(argv: string[]): Promise<number> {
  if (peekCommand(argv) === "hook") {
    const { hookMain } = await import("./hook/main.js");
    return hookMain(argv);
  }
  const { main } = await import("./main.js");
  return main(argv);
}

const entry = process.argv[1] ? realpathSync(path.resolve(process.argv[1])) : "";
if (entry && entry === realpathSync(fileURLToPath(import.meta.url))) {
  start(process.argv.slice(2))
    .then((code) => {
      flushCompileCache();
      process.exit(code);
    })
    .catch((error: unknown) => fail(error));
}
