import { parse } from "@babel/parser";
import { resolveSpecifier, stripExt } from "../paths.js";
import type { Catalog } from "../types.js";

export interface JsxNode {
  /** Intrinsic tag, component name, or "" for a fragment. */
  name: string;
  kind: "intrinsic" | "component" | "fragment";
  line: number;
  endLine: number;
  /** `<a role="button">` counts as a button. */
  buttonRole: boolean;
  children: JsxNode[];
}

export interface ImportRef {
  local: string;
  imported: string;
  specifier: string;
}

export interface ParsedUi {
  tree: JsxNode[];
  imports: ImportRef[];
}

interface BabelNode {
  type: string;
  loc?: { start: { line: number }; end?: { line: number } };
  [key: string]: unknown;
}

/** Parse a TSX module into a JSX forest and its named imports. Null when Babel gives up. */
export function parseUi(source: string, filename: string): ParsedUi | null {
  let ast: BabelNode;
  try {
    ast = parse(source, {
      sourceType: "module",
      sourceFilename: filename,
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    }) as unknown as BabelNode;
  } catch {
    return null;
  }
  return { tree: forest(ast), imports: importsOf(ast) };
}

/**
 * A recipe example is often a JSX snippet, not a module.
 * Wrap it the same way a snippet check does, and keep the JSX tree.
 */
export function parseExample(source: string): JsxNode[] | null {
  const direct = parseUi(source, "recipe.tsx");
  if (direct && direct.tree.length > 0) return direct.tree;
  const wrapped = parseUi(`export function Recipe() {\nreturn (\n${source}\n);\n}\n`, "recipe.tsx");
  if (wrapped && wrapped.tree.length > 0) return wrapped.tree;
  return null;
}

/** Map a local JSX name to the catalog component it imports, when it does. */
export function catalogLocals(parsed: ParsedUi, file: string, catalog: Catalog): Map<string, string> {
  const locals = new Map<string, string>();
  for (const spec of parsed.imports) {
    const resolved = resolveSpecifier(file, spec.specifier, catalog.paths);
    if (!resolved) continue;
    const component = catalog.components.find(
      (entry) => stripExt(entry.file) === resolved && entry.name === spec.imported,
    );
    if (component) locals.set(spec.local, component.name);
  }
  return locals;
}

export function visitJsx(nodes: JsxNode[], visit: (node: JsxNode) => void): void {
  for (const node of nodes) {
    visit(node);
    visitJsx(node.children, visit);
  }
}

export function intrinsicTag(node: JsxNode): string | null {
  if (node.kind !== "intrinsic") return null;
  if (node.buttonRole) return "button";
  return node.name;
}

function forest(ast: BabelNode): JsxNode[] {
  const roots: JsxNode[] = [];
  collect(ast, roots);
  return roots;
}

function collect(node: BabelNode, found: JsxNode[]): void {
  const element = buildElement(node);
  if (element) {
    found.push(element);
    return;
  }
  for (const child of babelChildren(node)) collect(child, found);
}

function buildElement(node: BabelNode): JsxNode | null {
  if (node.type === "JSXFragment") {
    return {
      name: "",
      kind: "fragment",
      line: node.loc?.start.line ?? 1,
      endLine: node.loc?.end?.line ?? node.loc?.start.line ?? 1,
      buttonRole: false,
      children: nested(node),
    };
  }
  if (node.type !== "JSXElement") return null;
  const opening = asNode(node.openingElement);
  if (!opening) return null;
  const tag = jsxName(opening.name);
  const buttonRole = tag?.kind === "intrinsic" && tag.name === "a" && roleOf(opening) === "button";
  const kind = tag?.kind === "intrinsic" ? "intrinsic" : tag ? "component" : "fragment";
  return {
    name: tag?.name ?? "",
    kind,
    line: opening.loc?.start.line ?? node.loc?.start.line ?? 1,
    endLine: node.loc?.end?.line ?? opening.loc?.start.line ?? 1,
    buttonRole,
    children: nested(node),
  };
}

function nested(node: BabelNode): JsxNode[] {
  const found: JsxNode[] = [];
  for (const child of babelChildren(node)) collect(child, found);
  return found;
}

function jsxName(name: unknown): { kind: "intrinsic" | "component" | "member"; name: string } | null {
  const node = asNode(name);
  if (!node) return null;
  if (node.type === "JSXIdentifier") {
    const value = typeof node.name === "string" ? node.name : "";
    if (!value) return null;
    if (value[0] === value[0]?.toLowerCase()) return { kind: "intrinsic", name: value };
    return { kind: "component", name: value };
  }
  if (node.type === "JSXMemberExpression") {
    const object = asNode(node.object);
    const objectName = object && typeof object.name === "string" ? object.name : "";
    if (!objectName) return null;
    return { kind: "member", name: objectName };
  }
  return null;
}

function roleOf(opening: BabelNode): string | null {
  for (const attribute of asNodes(opening.attributes)) {
    if (attribute.type !== "JSXAttribute") continue;
    const name = asNode(attribute.name);
    if (!name || name.name !== "role") continue;
    return attributeValue(attribute.value);
  }
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

function importsOf(ast: BabelNode): ImportRef[] {
  const program = asNode(ast.program);
  if (!program) return [];
  const refs: ImportRef[] = [];
  for (const statement of asNodes(program.body)) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const source = asNode(statement.source);
    const specifier = source && typeof source.value === "string" ? source.value : null;
    if (!specifier) continue;
    for (const spec of asNodes(statement.specifiers)) {
      if (spec.type !== "ImportSpecifier" || spec.importKind === "type") continue;
      const imported = specifierName(spec.imported);
      const local = specifierName(spec.local);
      if (!imported || !local) continue;
      refs.push({ local, imported, specifier });
    }
  }
  return refs;
}

function specifierName(value: unknown): string | null {
  const node = asNode(value);
  if (!node) return null;
  if (typeof node.name === "string") return node.name;
  if (typeof node.value === "string") return node.value;
  return null;
}

function babelChildren(node: BabelNode): BabelNode[] {
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

function asNode(value: unknown): BabelNode | null {
  if (!value || typeof value !== "object") return null;
  if (!("type" in value) || typeof (value as { type?: unknown }).type !== "string") return null;
  return value as BabelNode;
}

function asNodes(value: unknown): BabelNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const node = asNode(item);
    return node ? [node] : [];
  });
}
