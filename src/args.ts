import { UserError } from "./errors.js";

export interface Args {
  command?: string;
  positionals: string[];
  cwd?: string;
  format: "text" | "json" | "markdown";
  base?: string;
  file?: string;
  ui: string[];
  packages: string[];
  agents: string[];
  commit: boolean;
  pre: boolean;
  force: boolean;
  help: boolean;
  version: boolean;
}

const VALUE_FLAGS = new Set(["cwd", "format", "base", "file", "ui", "package", "agent"]);

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    positionals: [],
    format: "text",
    ui: [],
    packages: [],
    agents: [],
    commit: false,
    pre: false,
    force: false,
    help: false,
    version: false,
  };
  let command: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === "--") {
      args.positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("-")) {
      const [flag, inline] = splitFlag(token);
      if (flag === "h" || flag === "help") {
        args.help = true;
        continue;
      }
      if (flag === "v" || flag === "version") {
        args.version = true;
        continue;
      }
      if (flag === "commit" || flag === "pre" || flag === "force") {
        if (inline !== undefined) throw new UserError(`--${flag} does not take a value.`);
        args[flag] = true;
        continue;
      }
      if (!VALUE_FLAGS.has(flag)) throw new UserError(`Unknown flag --${flag}.`);
      const value = inline ?? argv[index + 1];
      if (value === undefined || (inline === undefined && value.startsWith("-"))) {
        throw new UserError(`--${flag} needs a value.`);
      }
      if (inline === undefined) index += 1;
      assign(args, flag, value);
      continue;
    }
    if (!command) command = token;
    else args.positionals.push(token);
  }
  args.command = command;
  const format = args.format as string;
  if (format === "md") args.format = "markdown";
  else if (format !== "text" && format !== "json" && format !== "markdown") {
    throw new UserError(`Unknown format "${format}". Use text, json, or markdown.`);
  }
  return args;
}

function assign(args: Args, flag: string, value: string): void {
  if (flag === "cwd") args.cwd = value;
  else if (flag === "base") args.base = value;
  else if (flag === "file") args.file = value;
  else if (flag === "ui") args.ui.push(value);
  else if (flag === "package") args.packages.push(value);
  else if (flag === "agent") args.agents.push(value);
  else if (flag === "format") args.format = value as Args["format"];
}

function splitFlag(token: string): [string, string | undefined] {
  const body = token.startsWith("--") ? token.slice(2) : token.slice(1);
  const eq = body.indexOf("=");
  if (eq === -1) return [body, undefined];
  return [body.slice(0, eq), body.slice(eq + 1)];
}
