import { parse } from "@babel/parser";
import { importStatement, suggestionLabel } from "../catalog.js";
import { resolveSpecifier, stripExt } from "../paths.js";
import type { Catalog, CatalogComponent, Finding, VariantGroup } from "../types.js";
import { describeFinding } from "./format.js";

/**
 * Flag a documented state only when the new code clearly rebuilds it.
 *
 * - A spinner inside or directly beside a catalog component that stories
 *   document as `loading` (or `pending` / `busy`), when that prop is not passed.
 * - A `className` that contains every class of one non-default variant option
 *   stories document, when that variant prop is not passed and the classes
 *   are not shared with another option.
 * - `opacity-50` together with `pointer-events-none`, or `aria-disabled`,
 *   on a component whose stories document `disabled`, when `disabled` is not passed.
 *
 * A catalog written before v0.3 has no `states` field. This stays silent.
 * A spinner that is itself a catalog component is reuse, not a finding.
 */

const LOADING_PROPS = new Set(["loading", "pending", "busy", "isLoading", "isPending", "isBusy"]);

const GENERIC_CLASS_TOKENS = new Set([
  "bg-background",
  "bg-muted",
  "block",
  "border",
  "border-border",
  "cursor-pointer",
  "flex",
  "font-medium",
  "font-normal",
  "font-semibold",
  "gap-2",
  "grid",
  "h-10",
  "h-8",
  "h-9",
  "hidden",
  "inline-block",
  "inline-flex",
  "items-center",
  "items-start",
  "justify-between",
  "justify-center",
  "opacity-50",
  "p-2",
  "p-4",
  "pointer-events-none",
  "px-2",
  "px-3",
  "px-4",
  "py-1",
  "py-2",
  "rounded",
  "rounded-full",
  "rounded-lg",
  "rounded-md",
  "shadow",
  "shadow-sm",
  "text-base",
  "text-foreground",
  "text-lg",
  "text-muted-foreground",
  "text-sm",
  "text-xs",
  "transition-colors",
  "w-10",
  "w-full",
  "whitespace-nowrap",
]);

interface BabelNode {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
}

interface Attr {
  name: string;
  literal?: string;
}

interface UiNode {
  name: string;
  kind: "intrinsic" | "component" | "fragment";
  line: number;
  attrs: Attr[];
  classTokens: string[];
  children: UiNode[];
}

export function findStateFindings(options: {
  source: string;
  file: string;
  catalog: Catalog;
  lines?: Set<number>;
  snippet?: boolean;
  withLine?: boolean;
}): Finding[] {
  if (!options.catalog.components.some((component) => component.states)) return [];
  const parsed = parseTree(options.source, options.file, Boolean(options.snippet));
  if (!parsed) return [];
  const imported = importedComponents(parsed.ast, options.file, options.catalog);
  if (imported.size === 0) return [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (finding: Finding | null): void => {
    if (!finding) return;
    const key = `${finding.line}:${finding.state}:${finding.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  walkPairs(parsed.tree, (node) => {
    const component = node.kind === "component" ? imported.get(node.name) : undefined;
    if (!component?.states) return;
    add(loadingInside(node, component, options, imported));
    add(variantFinding(node, component, options));
    add(disabledFinding(node, component, options));
  });
  walkPairs(parsed.tree, (node) => {
    for (const child of node.children) {
      if (!isSpinner(child, imported)) continue;
      const host = nearestLoadingHost(node, child, imported);
      if (!host) continue;
      const line = pickLine(host.node.line, child.line, options.lines);
      if (line === null) continue;
      add(stateFinding({
        file: options.file,
        line,
        component: host.component,
        catalog: options.catalog,
        state: host.prop,
        suggestion: `${suggestionLabel(host.component.name)} ${host.prop}`,
        withLine: options.withLine !== false,
      }));
    }
  });
  return findings;
}

function loadingInside(
  node: UiNode,
  component: CatalogComponent,
  options: { file: string; catalog: Catalog; lines?: Set<number>; withLine?: boolean },
  imported: Map<string, CatalogComponent>,
): Finding | null {
  const prop = loadingProp(component);
  if (!prop || hasAttr(node, prop)) return null;
  const evidence = descendantSpinner(node, imported);
  if (!evidence) return null;
  const line = pickLine(node.line, evidence.line, options.lines);
  if (line === null) return null;
  return stateFinding({
    file: options.file,
    line,
    component,
    catalog: options.catalog,
    state: prop,
    suggestion: `${suggestionLabel(component.name)} ${prop}`,
    withLine: options.withLine !== false,
  });
}

function loadingProp(component: CatalogComponent | undefined): string | null {
  const state = component?.states?.find((entry) => entry.kind === "prop" && entry.prop && LOADING_PROPS.has(entry.prop));
  return state?.prop ?? null;
}

function nearestLoadingHost(
  parent: UiNode,
  spinner: UiNode,
  imported: Map<string, CatalogComponent>,
): { node: UiNode; component: CatalogComponent; prop: string } | null {
  const index = parent.children.indexOf(spinner);
  if (index === -1) return null;
  let best: { node: UiNode; component: CatalogComponent; prop: string; distance: number } | null = null;
  let tie = false;
  for (let childIndex = 0; childIndex < parent.children.length; childIndex += 1) {
    const child = parent.children[childIndex];
    if (!child || child === spinner || child.kind !== "component") continue;
    const component = imported.get(child.name);
    const prop = loadingProp(component);
    if (!component || !prop || hasAttr(child, prop)) continue;
    const distance = Math.abs(childIndex - index);
    if (!best || distance < best.distance) {
      best = { node: child, component, prop, distance };
      tie = false;
    } else if (distance === best.distance) {
      tie = true;
    }
  }
  if (!best || tie) return null;
  return best;
}

function variantFinding(
  node: UiNode,
  component: CatalogComponent,
  options: { file: string; catalog: Catalog; lines?: Set<number>; withLine?: boolean },
): Finding | null {
  if (!component.states || node.classTokens.length === 0) return null;
  const matches: { group: VariantGroup; option: string }[] = [];
  for (const group of component.variants) {
    if (hasAttr(node, group.name)) continue;
    const classes = classesFor(group);
    if (!classes) continue;
    for (const option of group.options) {
      if (option === group.defaultValue) continue;
      const documented = component.states.some(
        (state) => state.kind === "variant" && state.prop === group.name && state.value === option,
      );
      if (!documented) continue;
      const tokens = classes.get(option) ?? [];
      if (tokens.length === 0 || !tokens.every((token) => node.classTokens.includes(token))) continue;
      if (!tokens.some((token) => isDistinctive(token, option, classes))) continue;
      matches.push({ group, option });
    }
  }
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match) return null;
  const line = pickLine(node.line, node.line, options.lines);
  if (line === null) return null;
  const prop = `${match.group.name}="${match.option}"`;
  return stateFinding({
    file: options.file,
    line,
    component,
    catalog: options.catalog,
    state: `${match.group.name}=${match.option}`,
    suggestion: `${suggestionLabel(component.name)} ${prop}`,
    withLine: options.withLine !== false,
  });
}

function disabledFinding(
  node: UiNode,
  component: CatalogComponent,
  options: { file: string; catalog: Catalog; lines?: Set<number>; withLine?: boolean },
): Finding | null {
  const state = component.states?.find((entry) => entry.kind === "prop" && entry.prop === "disabled");
  if (!state) return null;
  if (hasAttr(node, "disabled")) return null;
  const muted = node.classTokens.includes("opacity-50") && node.classTokens.includes("pointer-events-none");
  const aria = node.attrs.find((attr) => attr.name === "aria-disabled")?.literal;
  if (!muted && aria !== "true") return null;
  const line = pickLine(node.line, node.line, options.lines);
  if (line === null) return null;
  return stateFinding({
    file: options.file,
    line,
    component,
    catalog: options.catalog,
    state: "disabled",
    suggestion: `${suggestionLabel(component.name)} disabled`,
    withLine: options.withLine !== false,
  });
}

function stateFinding(options: {
  file: string;
  line: number;
  component: CatalogComponent;
  catalog: Catalog;
  state: string;
  suggestion: string;
  withLine: boolean;
}): Finding {
  const finding: Finding = {
    kind: "state",
    file: options.file,
    line: options.line,
    name: options.component.name,
    state: options.state,
    suggestion: options.suggestion,
    import: importStatement(options.component, options.catalog),
    message: "",
  };
  finding.message = describeFinding(finding, options.withLine);
  return finding;
}

function classesFor(group: VariantGroup): Map<string, string[]> | null {
  if (!group.classes) return null;
  const map = new Map<string, string[]>();
  for (const option of group.options) {
    const value = group.classes[option];
    if (value === undefined) return null;
    map.set(option, splitClasses(value));
  }
  return map;
}

function isDistinctive(token: string, option: string, classes: Map<string, string[]>): boolean {
  if (GENERIC_CLASS_TOKENS.has(token)) return false;
  for (const [other, tokens] of classes) {
    if (other !== option && tokens.includes(token)) return false;
  }
  return true;
}

function descendantSpinner(node: UiNode, imported: Map<string, CatalogComponent>): UiNode | null {
  for (const child of node.children) {
    if (isSpinner(child, imported)) return child;
    const nested = descendantSpinner(child, imported);
    if (nested) return nested;
  }
  return null;
}

function isSpinner(node: UiNode, imported: Map<string, CatalogComponent>): boolean {
  if (node.kind === "component" && imported.has(node.name)) return false;
  if (node.classTokens.includes("animate-spin")) return true;
  if (node.kind !== "component") return false;
  if (/(Page|Layout|Screen|Route|View|Table|List)/.test(node.name)) return false;
  return /Spinner|Loader/.test(node.name);
}

function walkPairs(nodes: UiNode[], visit: (node: UiNode, parent: UiNode | null) => void, parent: UiNode | null = null): void {
  for (const node of nodes) {
    visit(node, parent);
    walkPairs(node.children, visit, node);
  }
}

function hasAttr(node: UiNode, name: string): boolean {
  return node.attrs.some((attr) => attr.name === name);
}

function pickLine(elementLine: number, evidenceLine: number, lines: Set<number> | undefined): number | null {
  if (!lines) return evidenceLine;
  if (lines.has(evidenceLine)) return evidenceLine;
  if (lines.has(elementLine)) return elementLine;
  return null;
}

function parseTree(
  source: string,
  filename: string,
  snippet: boolean,
): { ast: BabelNode; tree: UiNode[] } | null {
  const direct = tryParse(source, filename);
  if (direct) return { ast: direct, tree: forest(direct) };
  if (!snippet) return null;
  const wrapped = tryParse(`export function __Snippet() {\nreturn (\n${source}\n);\n}\n`, filename);
  if (!wrapped) return null;
  return { ast: wrapped, tree: forest(wrapped) };
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

function importedComponents(ast: BabelNode, file: string, catalog: Catalog): Map<string, CatalogComponent> {
  const imported = new Map<string, CatalogComponent>();
  const program = asNode(ast.program);
  if (!program) return imported;
  for (const statement of asNodes(program.body)) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const specifier = stringValue(statement.source);
    if (!specifier) continue;
    const resolved = resolveSpecifier(file, specifier, catalog.paths);
    if (!resolved) continue;
    for (const spec of asNodes(statement.specifiers)) {
      if (spec.type !== "ImportSpecifier" || spec.importKind === "type") continue;
      const importedName = specifierName(spec.imported);
      const local = specifierName(spec.local);
      if (!importedName || !local) continue;
      const component = catalog.components.find(
        (entry) => stripExt(entry.file) === resolved && entry.name === importedName,
      );
      if (component) imported.set(local, component);
    }
  }
  return imported;
}

function forest(ast: BabelNode): UiNode[] {
  const roots: UiNode[] = [];
  collect(ast, roots);
  return roots;
}

function collect(node: BabelNode, found: UiNode[]): void {
  const element = buildElement(node);
  if (element) {
    found.push(element);
    return;
  }
  for (const child of babelChildren(node)) collect(child, found);
}

function buildElement(node: BabelNode): UiNode | null {
  if (node.type === "JSXFragment") {
    return {
      name: "",
      kind: "fragment",
      line: node.loc?.start.line ?? 1,
      attrs: [],
      classTokens: [],
      children: nested(node),
    };
  }
  if (node.type !== "JSXElement") return null;
  const opening = asNode(node.openingElement);
  if (!opening) return null;
  const tag = jsxName(opening.name);
  const attrs = attributesOf(opening);
  const classAttr = attrs.find((attr) => attr.name === "className");
  return {
    name: tag?.name ?? "",
    kind: tag?.kind === "intrinsic" ? "intrinsic" : tag ? "component" : "fragment",
    line: opening.loc?.start.line ?? node.loc?.start.line ?? 1,
    attrs,
    classTokens: classAttr ? tokensFromUnknown(classAttr.raw) : [],
    children: nested(node),
  };
}

function nested(node: BabelNode): UiNode[] {
  const found: UiNode[] = [];
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const element = asNode(child);
    if (element) collect(element, found);
  }
  return found;
}

function attributesOf(opening: BabelNode): (Attr & { raw: unknown })[] {
  const attrs: (Attr & { raw: unknown })[] = [];
  for (const attribute of asNodes(opening.attributes)) {
    if (attribute.type !== "JSXAttribute") continue;
    const name = identifierName(attribute.name);
    if (!name) continue;
    attrs.push({ name, literal: literalAttr(attribute.value), raw: attribute.value });
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

function tokensFromUnknown(value: unknown): string[] {
  const node = asNode(value);
  if (!node) return [];
  return classTokensFrom(node);
}

function classTokensFrom(node: BabelNode): string[] {
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
  const quasis = asNodes(node.quasis);
  return quasis.flatMap((quasi) => {
    const value = asNode(quasi.value);
    const cooked = value && typeof value.cooked === "string" ? value.cooked : value && typeof value.raw === "string" ? value.raw : "";
    return splitClasses(cooked);
  });
}

function splitClasses(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function jsxName(name: unknown): { kind: "intrinsic" | "component"; name: string } | null {
  const node = asNode(name);
  if (!node || node.type !== "JSXIdentifier") return null;
  const value = typeof node.name === "string" ? node.name : "";
  if (!value) return null;
  if (value[0] === value[0]?.toLowerCase()) return { kind: "intrinsic", name: value };
  return { kind: "component", name: value };
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
