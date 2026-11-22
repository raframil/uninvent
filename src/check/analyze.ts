import { parse } from "@babel/parser";
import { importStatement, suggestionLabel } from "../catalog.js";
import { describeFinding } from "./format.js";
import { matchesIgnore } from "../ignore.js";
import { isInsideDir } from "../config.js";
import { posixDir, resolveSpecifier, stripExt } from "../paths.js";
import {
  RAW_ELEMENTS,
  type Catalog,
  type CatalogComponent,
  type Config,
  type Finding,
  type Reuse,
} from "../types.js";

export interface AnalyzeResult {
  findings: Finding[];
  reuses: Reuse[];
  parseError?: string;
}

interface BabelNode {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
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

  const parsed = parseUi(options.source, file, Boolean(options.snippet));
  if (!parsed) {
    return {
      findings: [],
      reuses: [],
      parseError: `Could not parse ${file}.`,
    };
  }

  const imported = new Map<string, CatalogComponent>();
  const defined = new Map<string, number>();
  const exported = new Set<string>();
  collectModules(parsed, file, options.catalog, imported, defined, exported);

  const findings: Finding[] = [];
  const reuses: Reuse[] = [];

  if (!options.snippet) {
    for (const name of exported) {
      const component = options.catalog.components.find((entry) => entry.name === name);
      const line = defined.get(name);
      if (!component || line === undefined) continue;
      if (!keepLine(line, options.lines)) continue;
      findings.push(collisionFinding(file, line, name, component, options.catalog, !options.snippet));
    }
  }

  walk(parsed, (node) => {
    if (node.type !== "JSXOpeningElement" && node.type !== "JSXSelfClosingElement") return;
    const line = node.loc?.start.line ?? 1;
    if (!keepLine(line, options.lines)) return;
    const tag = jsxTag(node.name);
    if (!tag) return;
    if (tag.kind === "intrinsic") {
      const finding = rawFinding(file, line, tag.name, rawElementRole(node), options.catalog, !options.snippet);
      if (finding) findings.push(finding);
      return;
    }
    const local = tag.kind === "member" ? tag.object : tag.name;
    const component = imported.get(local);
    if (!component) return;
    if (defined.has(local)) return;
    reuses.push({ name: component.name, file, line });
  });

  return {
    findings: dedupe(findings),
    reuses,
  };
}

export function isDesignSystemFile(file: string, config: Config, catalog: Catalog): boolean {
  if (config.ui.some((dir) => isInsideDir(file, dir))) return true;
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
    suggestion: suggestionLabel(component.name),
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
): Finding | null {
  const buttonLink = element === "a" && role === "button";
  const wanted = buttonLink ? "Button" : RAW_ELEMENTS[element];
  if (!wanted) return null;
  const component = catalog.components.find((entry) => entry.name === wanted);
  if (!component) return null;
  const finding: Finding = {
    kind: "raw-element",
    file,
    line,
    element,
    suggestion: suggestionLabel(component.name),
    import: importStatement(component, catalog),
    message: "",
  };
  finding.message = describeFinding(finding, withLine);
  return finding;
}

function keepLine(line: number, lines: Set<number> | undefined): boolean {
  return !lines || lines.has(line);
}

function collectModules(
  ast: BabelNode,
  file: string,
  catalog: Catalog,
  imported: Map<string, CatalogComponent>,
  defined: Map<string, number>,
  exported: Set<string>,
): void {
  const body = programBody(ast);
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") {
      if (statement.importKind === "type") continue;
      const specifier = asString(statement.source);
      if (!specifier) continue;
      const resolved = resolveSpecifier(file, specifier, catalog.paths);
      if (!resolved) continue;
      const specifiers = asNodes(statement.specifiers);
      for (const spec of specifiers) {
        if (spec.type !== "ImportSpecifier" || spec.importKind === "type") continue;
        const importedName = specifierName(spec.imported);
        const local = specifierName(spec.local);
        if (!importedName || !local) continue;
        const component = catalog.components.find(
          (entry) => stripExt(entry.file) === resolved && entry.name === importedName,
        );
        if (component) imported.set(local, component);
      }
      continue;
    }

    const declaration = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
      ? asNode(statement.declaration)
      : statement;
    const isExported = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
    rememberDeclaration(declaration, isExported, defined, exported);

    if (statement.type === "ExportNamedDeclaration" && !statement.source) {
      for (const spec of asNodes(statement.specifiers)) {
        if (spec.type !== "ExportSpecifier") continue;
        const local = specifierName(spec.local);
        const publicName = specifierName(spec.exported);
        if (!local || !publicName) continue;
        if (defined.has(local)) {
          exported.add(publicName);
          if (publicName !== local) {
            const line = defined.get(local);
            if (line !== undefined) defined.set(publicName, line);
          }
        }
      }
    }
  }
}

function rememberDeclaration(
  declaration: BabelNode | null,
  isExported: boolean,
  defined: Map<string, number>,
  exported: Set<string>,
): void {
  if (!declaration) return;
  if (declaration.type === "FunctionDeclaration") {
    const name = identifierName(declaration.id);
    if (!name || !/^[A-Z]/.test(name)) return;
    defined.set(name, declaration.loc?.start.line ?? 1);
    if (isExported) exported.add(name);
    return;
  }
  if (declaration.type !== "VariableDeclaration") return;
  for (const declarator of asNodes(declaration.declarations)) {
    if (declarator.type !== "VariableDeclarator") continue;
    const name = identifierName(declarator.id);
    if (!name || !/^[A-Z]/.test(name)) continue;
    defined.set(name, declarator.loc?.start.line ?? declaration.loc?.start.line ?? 1);
    if (isExported) exported.add(name);
  }
}

function parseUi(source: string, filename: string, snippet: boolean): BabelNode | null {
  const direct = tryParse(source, filename);
  if (direct) return direct;
  if (!snippet) return null;
  const wrapped = `export function __Snippet() {\nreturn (\n${source}\n);\n}\n`;
  return tryParse(wrapped, filename);
}

function tryParse(source: string, filename: string): BabelNode | null {
  try {
    return parse(source, {
      sourceType: "module",
      sourceFilename: filename,
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    }) as unknown as BabelNode;
  } catch {
    return null;
  }
}

function rawElementRole(node: BabelNode): string | null {
  for (const attribute of asNodes(node.attributes)) {
    if (attribute.type !== "JSXAttribute") continue;
    if (identifierName(attribute.name) !== "role") continue;
    return attributeValue(attribute.value);
  }
  return null;
}

function jsxTag(name: unknown): { kind: "intrinsic"; name: string } | { kind: "name"; name: string } | { kind: "member"; object: string } | null {
  const node = asNode(name);
  if (!node) return null;
  if (node.type === "JSXIdentifier") {
    const value = identifierName(node);
    if (!value) return null;
    if (value[0] === value[0]?.toLowerCase()) return { kind: "intrinsic", name: value };
    return { kind: "name", name: value };
  }
  if (node.type === "JSXMemberExpression") {
    const object = asNode(node.object);
    const objectName = object ? identifierName(object) : null;
    if (!objectName) return null;
    return { kind: "member", object: objectName };
  }
  return null;
}

function walk(node: BabelNode, visit: (node: BabelNode) => void): void {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

function children(node: BabelNode): BabelNode[] {
  const found: BabelNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = asNode(item);
        if (child) found.push(child);
      }
    } else {
      const child = asNode(value);
      if (child) found.push(child);
    }
  }
  return found;
}

function programBody(ast: BabelNode): BabelNode[] {
  const program = asNode(ast.program);
  if (!program) return [];
  return asNodes(program.body);
}

function asNode(value: unknown): BabelNode | null {
  if (!value || typeof value !== "object") return null;
  if (!("type" in value) || typeof value.type !== "string") return null;
  return value as BabelNode;
}

function asNodes(value: unknown): BabelNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const node = asNode(item);
    return node ? [node] : [];
  });
}

function asString(value: unknown): string | null {
  const node = asNode(value);
  if (!node) return null;
  return typeof node.value === "string" ? node.value : null;
}

function identifierName(value: unknown): string | null {
  const node = asNode(value);
  if (!node) return null;
  return typeof node.name === "string" ? node.name : null;
}

function specifierName(value: unknown): string | null {
  const node = asNode(value);
  if (!node) return null;
  if (typeof node.name === "string") return node.name;
  if (typeof node.value === "string") return node.value;
  return null;
}

function attributeValue(value: unknown): string | null {
  const node = asNode(value);
  if (!node) return null;
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value;
  if (node.type === "JSXExpressionContainer") {
    const expression = asNode(node.expression);
    if (expression?.type === "StringLiteral" && typeof expression.value === "string") return expression.value;
  }
  return null;
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
