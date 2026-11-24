import { componentByName, componentForImport, importStatement, suggestionLabel } from "../catalog.js";
import { applyRecipeHits, findRecipeHits } from "../recipes/match.js";
import { matchesIgnore } from "../ignore.js";
import { isInsideDir } from "../config.js";
import { parseUiSource } from "../parse/file.js";
import type { ImportRef, StateNode } from "../parse/types.js";
import { posixDir } from "../paths.js";
import {
  RAW_ELEMENTS,
  type Catalog,
  type CatalogComponent,
  type Config,
  type Finding,
  type Reuse,
} from "../types.js";
import { describeFinding } from "./format.js";
import { findStateFindings } from "./states.js";
import { findInvalidVariants, suggestVariants, usageSuggestion } from "./variants.js";

export interface AnalyzeResult {
  findings: Finding[];
  reuses: Reuse[];
  parseError?: string;
}

/**
 * Compare one file with the catalog.
 * `lines`, when set, keeps only hits on those 1-based lines (a git diff).
 * Snippets (a PreToolUse patch) report raw elements and skip export collisions.
 */
export function analyzeSource(options: {
  source: string;
  file: string;
  catalog: Catalog;
  config: Config;
  lines?: Set<number>;
  snippet?: boolean;
}): AnalyzeResult {
  const file = options.file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (isDesignSystemFile(file, options.config, options.catalog) || matchesIgnore(file, options.config.ignore)) {
    return { findings: [], reuses: [] };
  }

  const parsed = parseUiSource(options.source, file, Boolean(options.snippet));
  if (!parsed) {
    return {
      findings: [],
      reuses: [],
      parseError: `Could not parse ${file}.`,
    };
  }

  const imported = importedComponents(parsed.imports, file, options.catalog);
  const defined = new Map(parsed.defined.map((entry) => [entry.name, entry.line]));
  const findings: Finding[] = [];
  const reuses: Reuse[] = [];

  if (!options.snippet) {
    for (const entry of parsed.exported) {
      const component = componentByName(options.catalog, entry.name);
      if (!component || !keepLine(entry.line, options.lines)) continue;
      findings.push(collisionFinding(file, entry.line, entry.name, component, options.catalog, !options.snippet));
    }
  }

  for (const opening of parsed.openings) {
    if (!keepLine(opening.line, options.lines)) continue;
    if (opening.kind === "intrinsic") {
      const node = findStateNode(parsed.stateTree, opening.line, opening.name);
      const finding = rawFinding(
        file,
        opening.line,
        opening.name,
        opening.role,
        options.catalog,
        !options.snippet,
        node?.classTokens ?? [],
      );
      if (finding) findings.push(finding);
      continue;
    }
    const component = imported.get(opening.name);
    if (!component || defined.has(opening.name)) continue;
    reuses.push({ name: component.name, file, line: opening.line });
    if (opening.kind !== "component") continue;
    const node = findStateNode(parsed.stateTree, opening.line, opening.name);
    findings.push(...findInvalidVariants({
      file,
      line: opening.line,
      component,
      catalog: options.catalog,
      attrs: node?.attrs ?? [],
      withLine: !options.snippet,
    }));
  }

  findings.push(...findStateFindings({
    source: options.source,
    file,
    catalog: options.catalog,
    lines: options.lines,
    snippet: Boolean(options.snippet),
    withLine: !options.snippet,
  }));

  const hits = findRecipeHits({
    source: options.source,
    file,
    catalog: options.catalog,
    lines: options.lines,
    withLine: !options.snippet,
  });
  return {
    findings: dedupe(applyRecipeHits(findings, hits)),
    reuses,
  };
}

export function isDesignSystemFile(file: string, config: Config, catalog: Catalog): boolean {
  if (config.ui.some((dir) => isInsideDir(file, dir))) return true;
  if ((catalog.packages ?? []).some((pkg) => pkg.dir && isInsideDir(file, pkg.dir))) return true;
  const directory = posixDir(file);
  return catalog.components.some((component) => posixDir(component.file) === directory && directory !== "");
}

function collisionFinding(
  file: string,
  line: number,
  name: string,
  component: CatalogComponent,
  catalog: Catalog,
  withLine: boolean,
): Finding {
  const finding: Finding = {
    kind: "name-collision",
    file,
    line,
    name,
    suggestion: suggestionLabel(name, catalog, component),
    import: importStatement(component, catalog),
    message: "",
  };
  finding.message = describeFinding(finding, withLine);
  return finding;
}

/**
 * Suggest the catalog component with the canonical name (`Button` for `<button>`).
 * The headless library that component wraps is not part of the match.
 */
function rawFinding(
  file: string,
  line: number,
  element: string,
  role: string | null,
  catalog: Catalog,
  withLine: boolean,
  classTokens: string[],
): Finding | null {
  const buttonLink = element === "a" && role === "button";
  const wanted = buttonLink ? "Button" : RAW_ELEMENTS[element];
  if (!wanted) return null;
  const component = componentByName(catalog, wanted);
  if (!component) return null;
  const choices = suggestVariants(component, classTokens);
  const finding: Finding = {
    kind: "raw-element",
    file,
    line,
    element,
    suggestion: usageSuggestion(component, catalog, choices),
    import: importStatement(component, catalog),
    message: "",
  };
  finding.message = describeFinding(finding, withLine);
  return finding;
}

function findStateNode(nodes: StateNode[], line: number, name: string): StateNode | undefined {
  for (const node of nodes) {
    if (node.line === line && node.name === name) return node;
    const child = findStateNode(node.children, line, name);
    if (child) return child;
  }
  return undefined;
}

function keepLine(line: number, lines: Set<number> | undefined): boolean {
  return !lines || lines.has(line);
}

function importedComponents(specs: ImportRef[], file: string, catalog: Catalog): Map<string, CatalogComponent> {
  const imported = new Map<string, CatalogComponent>();
  for (const spec of specs) {
    const component = componentForImport(catalog.components, catalog.paths, file, spec.specifier, spec.imported);
    if (component) imported.set(spec.local, component);
  }
  return imported;
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message));
  return unique;
}
