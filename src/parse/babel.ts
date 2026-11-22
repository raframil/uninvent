import { createRequire } from "node:module";
import type { ImportRef, NameAt, Opening, ParsedFile, RecipeNode, StateNode } from "./types.js";

const require = createRequire(import.meta.url);

interface BabelNode {
  type: string;
  loc?: { start: { line: number }; end?: { line: number } };
  [key: string]: unknown;
}

type Parse = (source: string, options: Record<string, unknown>) => BabelNode;

let parse: Parse | undefined;

/**
 * Babel is the fallback for syntax the fast scanner will not guess at.
 * Loaded on first use so a normal hook never pays for it.
 */
export function parseWithBabel(source: string, filename: string): ParsedFile | null {
  const ast = tryParse(source, filename);
  if (!ast) return null;
  const defined: NameAt[] = [];
  const exported: NameAt[] = [];
  collectBindings(ast, defined, exported);
  return {
    imports: importsOf(ast),
    defined,
    exported,
    openings: openingsOf(ast),
    stateTree: stateForest(ast),
    recipeTree: recipeForest(ast),
  };
}

function tryParse(source: string, filename: string): BabelNode | null {
  try {
    parse ??= (require("@babel/parser") as { parse: Parse }).parse;
    return parse(source, {
      sourceType: "module",
      sourceFilename: filename,
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    return null;
  }
}

function collectBindings(ast: BabelNode, defined: NameAt[], exported: NameAt[]): void {
  const definedLines = new Map<string, number>();
  const exportedNames = new Set<string>();
  const body = programBody(ast);
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") continue;
    const declaration = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
      ? asNode(statement.declaration)
      : statement;
    const isExported = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
    remember(declaration, isExported, definedLines, exportedNames);
    if (statement.type === "ExportNamedDeclaration" && !statement.source) {
      for (const spec of asNodes(statement.specifiers)) {
        if (spec.type !== "ExportSpecifier") continue;
        const local = specifierName(spec.local);
        const publicName = specifierName(spec.exported);
        if (!local || !publicName || !definedLines.has(local)) continue;
        exportedNames.add(publicName);
        const line = definedLines.get(local);
        if (publicName !== local && line !== undefined) definedLines.set(publicName, line);
      }
    }
  }
  for (const [name, line] of definedLines) defined.push({ name, line });
  for (const name of exportedNames) {
    const line = definedLines.get(name);
    if (line !== undefined) exported.push({ name, line });
  }
}

function remember(
  declaration: BabelNode | null,
  isExported: boolean,
  defined: Map<string, number>,
  exported: Set<string>,
): void {
  if (!declaration) return;
  if (declaration.type === "FunctionDeclaration") {
    const name = identifierName(declaration.id);
    if (!name || !/^[A-Z]/.test(name)) return;
    const line = declaration.loc?.start.line ?? 1;
    defined.set(name, line);
    if (isExported) exported.add(name);
    return;
  }
  if (declaration.type !== "VariableDeclaration") return;
  for (const declarator of asNodes(declaration.declarations)) {
    if (declarator.type !== "VariableDeclarator") continue;
    const name = identifierName(declarator.id);
    if (!name || !/^[A-Z]/.test(name)) continue;
    const line = declarator.loc?.start.line ?? declaration.loc?.start.line ?? 1;
    defined.set(name, line);
    if (isExported) exported.add(name);
  }
}

function importsOf(ast: BabelNode): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const statement of programBody(ast)) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const specifier = stringValue(statement.source);
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

function openingsOf(ast: BabelNode): Opening[] {
  const found: Opening[] = [];
  walk(ast, (node) => {
    if (node.type !== "JSXOpeningElement" && node.type !== "JSXSelfClosingElement") return;
    const tag = jsxTag(node.name);
    if (!tag) return;
    found.push({
      line: node.loc?.start.line ?? 1,
      kind: tag.kind,
      name: tag.kind === "member" ? tag.object : tag.name,
      role: tag.kind === "intrinsic" ? roleOf(node) : null,
    });
  });
  return found;
}

function stateForest(ast: BabelNode): StateNode[] {
  const roots: StateNode[] = [];
  collectState(ast, roots);
  return roots;
}

function collectState(node: BabelNode, found: StateNode[]): void {
  const element = stateElement(node);
  if (element) {
    found.push(element);
    return;
  }
  for (const child of babelChildren(node)) collectState(child, found);
}

function stateElement(node: BabelNode): StateNode | null {
  if (node.type === "JSXFragment") {
    return {
      name: "",
      kind: "fragment",
      line: node.loc?.start.line ?? 1,
      attrs: [],
      classTokens: [],
      children: stateChildren(node),
    };
  }
  if (node.type !== "JSXElement") return null;
  const opening = asNode(node.openingElement);
  if (!opening) return null;
  const tag = jsxTag(opening.name);
  const attrs = attributesOf(opening);
  const classAttr = attrs.find((attr) => attr.name === "className");
  const kind = tag?.kind === "intrinsic" ? "intrinsic" : tag && tag.kind !== "member" ? "component" : "fragment";
  return {
    name: tag && tag.kind !== "member" ? tag.name : "",
    kind,
    line: opening.loc?.start.line ?? node.loc?.start.line ?? 1,
    attrs: attrs.map(({ name, literal }) => (literal === undefined ? { name } : { name, literal })),
    classTokens: classAttr ? classTokensFrom(classAttr.raw) : [],
    children: stateChildren(node),
  };
}

function stateChildren(node: BabelNode): StateNode[] {
  const found: StateNode[] = [];
  for (const child of asNodes(node.children)) collectState(child, found);
  return found;
}

function recipeForest(ast: BabelNode): RecipeNode[] {
  const roots: RecipeNode[] = [];
  collectRecipe(ast, roots);
  return roots;
}

function collectRecipe(node: BabelNode, found: RecipeNode[]): void {
  const element = recipeElement(node);
  if (element) {
    found.push(element);
    return;
  }
  for (const child of babelChildren(node)) collectRecipe(child, found);
}

function recipeElement(node: BabelNode): RecipeNode | null {
  if (node.type === "JSXFragment") {
    return {
      name: "",
      kind: "fragment",
      line: node.loc?.start.line ?? 1,
      endLine: node.loc?.end?.line ?? node.loc?.start.line ?? 1,
      buttonRole: false,
      children: recipeChildren(node),
    };
  }
  if (node.type !== "JSXElement") return null;
  const opening = asNode(node.openingElement);
  if (!opening) return null;
  const tag = jsxTag(opening.name);
  const buttonRole = tag?.kind === "intrinsic" && tag.name === "a" && roleOf(opening) === "button";
  const kind = tag?.kind === "intrinsic" ? "intrinsic" : tag ? "component" : "fragment";
  const name = tag?.kind === "member" ? tag.object : tag?.name ?? "";
  return {
    name,
    kind,
    line: opening.loc?.start.line ?? node.loc?.start.line ?? 1,
    endLine: node.loc?.end?.line ?? opening.loc?.start.line ?? 1,
    buttonRole,
    children: recipeChildren(node),
  };
}

function recipeChildren(node: BabelNode): RecipeNode[] {
  const found: RecipeNode[] = [];
  for (const child of babelChildren(node)) collectRecipe(child, found);
  return found;
}

function attributesOf(opening: BabelNode): Array<{ name: string; literal?: string; raw: BabelNode | null }> {
  const attrs: Array<{ name: string; literal?: string; raw: BabelNode | null }> = [];
  for (const attribute of asNodes(opening.attributes)) {
    if (attribute.type !== "JSXAttribute") continue;
    const name = identifierName(attribute.name);
    if (!name) continue;
    const literal = literalAttr(attribute.value);
    attrs.push(literal === undefined ? { name, raw: asNode(attribute.value) } : { name, literal, raw: asNode(attribute.value) });
  }
  return attrs;
}

function literalAttr(value: unknown): string | undefined {
  if (value === null || value === undefined) return "true";
  const node = asNode(value);
  if (!node) return undefined;
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value;
  if (node.type === "JSXExpressionContainer") {
    const expression = asNode(node.expression);
    if (!expression) return undefined;
    if (expression.type === "StringLiteral" && typeof expression.value === "string") return expression.value;
    if (expression.type === "BooleanLiteral" && typeof expression.value === "boolean") return expression.value ? "true" : "false";
    if (expression.type === "NumericLiteral" && typeof expression.value === "number") return String(expression.value);
  }
  return undefined;
}

function classTokensFrom(node: BabelNode | null): string[] {
  if (!node) return [];
  if (node.type === "StringLiteral" && typeof node.value === "string") return splitClasses(node.value);
  if (node.type === "JSXExpressionContainer") {
    const expression = asNode(node.expression);
    return expression ? classTokensFrom(expression) : [];
  }
  if (node.type === "TemplateLiteral") return templateTokens(node);
  if (node.type === "CallExpression") return asNodes(node.arguments).flatMap((argument) => classTokensFrom(argument));
  if (node.type === "LogicalExpression" || node.type === "ConditionalExpression" || node.type === "BinaryExpression") {
    return babelChildren(node).flatMap((child) => classTokensFrom(child));
  }
  if (node.type === "ArrayExpression") return asNodes(node.elements).flatMap((element) => classTokensFrom(element));
  if (node.type === "ParenthesizedExpression") {
    const expression = asNode(node.expression);
    return expression ? classTokensFrom(expression) : [];
  }
  return [];
}

function templateTokens(node: BabelNode): string[] {
  return asNodes(node.quasis).flatMap((quasi) => {
    const value = asNode(quasi.value);
    const cooked = value && typeof value.cooked === "string" ? value.cooked : value && typeof value.raw === "string" ? value.raw : "";
    return splitClasses(cooked);
  });
}

function splitClasses(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function jsxTag(
  name: unknown,
): { kind: "intrinsic"; name: string } | { kind: "component"; name: string } | { kind: "member"; object: string } | null {
  const node = asNode(name);
  if (!node) return null;
  if (node.type === "JSXIdentifier") {
    const value = identifierName(node);
    if (!value) return null;
    if (value[0] === value[0]?.toLowerCase()) return { kind: "intrinsic", name: value };
    return { kind: "component", name: value };
  }
  if (node.type === "JSXMemberExpression") {
    const object = asNode(node.object);
    const objectName = object ? identifierName(object) : null;
    if (!objectName) return null;
    return { kind: "member", object: objectName };
  }
  return null;
}

function roleOf(opening: BabelNode): string | null {
  for (const attribute of asNodes(opening.attributes)) {
    if (attribute.type !== "JSXAttribute") continue;
    if (identifierName(attribute.name) !== "role") continue;
    return literalAttr(attribute.value) ?? null;
  }
  return null;
}

function programBody(ast: BabelNode): BabelNode[] {
  const program = asNode(ast.program);
  if (!program) return [];
  return asNodes(program.body);
}

function walk(node: BabelNode, visit: (node: BabelNode) => void): void {
  visit(node);
  for (const child of babelChildren(node)) walk(child, visit);
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

function stringValue(value: unknown): string | null {
  const node = asNode(value);
  if (!node || typeof node.value !== "string") return null;
  return node.value;
}

function identifierName(value: unknown): string | null {
  const node = asNode(value);
  if (!node || typeof node.name !== "string") return null;
  return node.name;
}

function specifierName(value: unknown): string | null {
  const node = asNode(value);
  if (!node) return null;
  if (typeof node.name === "string") return node.name;
  if (typeof node.value === "string") return node.value;
  return null;
}
