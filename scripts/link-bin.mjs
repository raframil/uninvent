import { chmodSync, existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli.js");
chmodSync(cli, 0o755);

const binDir = path.join(root, "node_modules", ".bin");
mkdirSync(binDir, { recursive: true });
const bin = path.join(binDir, "uninvent");
if (existsSync(bin)) unlinkSync(bin);
symlinkSync(path.relative(binDir, cli), bin);
