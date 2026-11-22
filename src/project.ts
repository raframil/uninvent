import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeCatalog } from "./catalog.js";
import { cleanDir, configDocument, loadConfig } from "./config.js";
import { UserError } from "./errors.js";
import { discoverUiDirs, readPathMappings } from "./scanner/discover.js";
import { scanProject } from "./scanner/scan.js";
import { skillsInstalled, writeSkills } from "./skill.js";
import { DEFAULT_CATALOG, DEFAULT_IGNORE, type Config } from "./types.js";

/** Scan, write the catalog, and quietly refresh a skill that init already generated. */
export function scanCommand(root: string): string {
  const config = loadConfig(root);
  const { catalog, summary } = scanProject(root, config);
  writeCatalog(root, config.catalog, catalog);
  if (skillsInstalled(root)) writeSkills(root, catalog);
  return summary;
}

export function initCommand(options: {
  root: string;
  commit: boolean;
  force: boolean;
  ui: string[];
}): string[] {
  const configPath = path.join(options.root, "uninvent.json");
  const hadConfig = existsSync(configPath);
  let config = hadConfig ? loadConfig(options.root) : emptyConfig();
  const lines: string[] = [];

  if (!hadConfig || options.force || options.ui.length > 0 || options.commit) {
    const mappings = readPathMappings(options.root);
    const discovered = options.ui.length > 0
      ? options.ui.map(cleanDir)
      : config.ui.length > 0
        ? config.ui
        : discoverUiDirs(options.root, [], mappings);
    if (discovered.length === 0) {
      throw new UserError(
        [
          "No UI directory found.",
          "Looked for components.json aliases.ui, src/components/ui, and components/ui.",
          "Create the folder or re-run with --ui <dir>.",
        ].join("\n"),
      );
    }
    for (const dir of discovered) {
      if (!existsSync(path.join(options.root, dir))) {
        throw new UserError(`UI directory not found: ${dir}`);
      }
    }
    config = {
      ui: discovered,
      ignore: config.ignore.length > 0 ? config.ignore : [...DEFAULT_IGNORE],
      catalog: config.catalog || DEFAULT_CATALOG,
      commitCatalog: options.commit ? true : config.commitCatalog,
    };
    if (!hadConfig) {
      config.ignore = [...DEFAULT_IGNORE];
      config.catalog = DEFAULT_CATALOG;
      config.commitCatalog = options.commit;
    }
    writeFileSync(configPath, `${JSON.stringify(configDocument(config), null, 2)}\n`);
    lines.push(hadConfig ? "Updated uninvent.json" : "Wrote uninvent.json");
  }

  const ignoreNote = ensureGitignore(options.root, config.commitCatalog);
  if (ignoreNote) lines.push(ignoreNote);

  const { catalog, summary } = scanProject(options.root, config);
  writeCatalog(options.root, config.catalog, catalog);
  lines.push(summary);
  for (const file of writeSkills(options.root, catalog, true)) lines.push(`Wrote ${file}`);
  lines.push("Next: uninvent install");
  return lines;
}

function emptyConfig(): Config {
  return {
    ui: [],
    ignore: [...DEFAULT_IGNORE],
    catalog: DEFAULT_CATALOG,
    commitCatalog: false,
  };
}

function ensureGitignore(root: string, commitCatalog: boolean): string | null {
  const file = path.join(root, ".gitignore");
  const entry = ".uninvent/";
  const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
  const present = existing
    ? existing.split(/\r?\n/).some((line) => line.trim() === entry || line.trim() === ".uninvent")
    : false;
  if (commitCatalog) {
    return present ? ".uninvent/ is in .gitignore. Remove that line to commit the catalog." : null;
  }
  if (present) return null;
  if (existing === null) {
    writeFileSync(file, `${entry}\n`);
    return "Created .gitignore with .uninvent/";
  }
  const suffix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  writeFileSync(file, `${existing}${suffix}${entry}\n`);
  return "Added .uninvent/ to .gitignore";
}
