import path from "node:path";
import { parseArgs } from "../args.js";
import { runHook } from "./run.js";

/** The hook command. It does not load scan, exists, or install. */
export async function hookMain(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || args.version) {
    const { main } = await import("../main.js");
    return main(argv);
  }
  if (!args.file && process.stdin.isTTY) {
    process.stderr.write("uninvent hook reads a Claude Code or Cursor tool event on stdin.\n");
    return 0;
  }
  const stdin = args.file ? "" : await readStdin();
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const result = runHook({ stdin, file: args.file, cwd });
  process.stdout.write(result.stdout);
  return result.exitCode;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}
