import ts from "typescript";
import { matchPrimitive, type PrimitiveUse } from "../primitives.js";
import type { PropInfo, VariantGroup } from "../types.js";

export interface ExtractedComponent {
  name: string;
  line: number;
  props: PropInfo[];
  extends: string[];
  variants: VariantGroup[];
  primitives: PrimitiveUse[];
  elements: string[];
}

interface TypeInfo {
  props: PropInfo[];
  extendNames: string[];
  variantRefs: string[];
}

const INTERESTING_ELEMENTS = new Set([
  "a",
  "button",
  "dialog",
  "input",
  "label",
  "select",
  "table",
  "textarea",
]);

/**
 * Syntactic extract of one UI file. No typecheck and no node_modules walk:
 * scan should work in a fixture that has never installed React.
 */
export function extractFile(fileName: string, source: string): ExtractedComponent[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const variants = new Map<string, VariantGroup[]>();
  const types = new Map<string, TypeInfo>();
  const primitives = new Map<string, PrimitiveUse>();
  const declarations = new Map<string, { node: ts.Node; line: number; propsType?: ts.TypeNode; body?: ts.Node }>();
  const exported = new Set<string>();
  const exportAliases = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    collectImports(statement, primitives);
    collectTypes(statement, sourceFile, types);
    collectVariants(statement, variants);
    collectDeclaration(statement, sourceFile, declarations, exported);
    collectExportNames(statement, exported, exportAliases);
  }

  const components: ExtractedComponent[] = [];
  for (const name of exported) {
    const decl = declarations.get(exportAliases.get(name) ?? name);
    if (!decl) continue;
    if (variants.has(name) && !decl.propsType && !decl.body) continue;
    const resolved = decl.propsType ? resolveType(decl.propsType, types, new Set()) : emptyType();
    const groups = variantGroupsFor(resolved.variantRefs, variants, decl.body, [...variants.keys()]);
    components.push({
      name,
      line: decl.line,
      props: resolved.props,
      extends: unique(resolved.extendNames),
      variants: groups,
      primitives: [...primitives.values()].sort(
        (a, b) => a.library.localeCompare(b.library) || a.package.localeCompare(b.package),
      ),
      elements: decl.body ? elementsIn(decl.body) : [],
    });
  }

  components.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return components;
}

function emptyType(): TypeInfo {
  return { props: [], extendNames: [], variantRefs: [] };
}

function collectImports(statement: ts.Statement, found: Map<string, PrimitiveUse>): void {
  if (!ts.isImportDeclaration(statement)) return;
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return;
  const hit = matchPrimitive(statement.moduleSpecifier.text);
  if (!hit) return;
  found.set(`${hit.library}\0${hit.package}`, hit);
}

function collectTypes(statement: ts.Statement, sourceFile: ts.SourceFile, types: Map<string, TypeInfo>): void {
  if (ts.isInterfaceDeclaration(statement)) {
    types.set(statement.name.text, typeFromInterface(statement, sourceFile));
    return;
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    types.set(statement.name.text, resolveType(statement.type, types, new Set([statement.name.text])));
  }
}

function collectVariants(statement: ts.Statement, variants: Map<string, VariantGroup[]>): void {
  if (!ts.isVariableStatement(statement)) return;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
    const call = unwrapCall(declaration.initializer);
    if (!call) continue;
    const kind = callName(call);
    if (kind !== "cva" && kind !== "tv") continue;
    variants.set(declaration.name.text, parseVariantCall(call, kind));
  }
}

function collectDeclaration(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  declarations: Map<string, { node: ts.Node; line: number; propsType?: ts.TypeNode; body?: ts.Node }>,
  exported: Set<string>,
): void {
  const exportModifier = hasExport(statement);
  if (ts.isFunctionDeclaration(statement) && statement.name && isComponentName(statement.name.text)) {
    declarations.set(statement.name.text, {
      node: statement,
      line: lineOf(sourceFile, statement),
      propsType: statement.parameters[0]?.type,
      body: statement.body,
    });
    if (exportModifier) exported.add(statement.name.text);
    return;
  }
  if (!ts.isVariableStatement(statement)) return;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !isComponentName(declaration.name.text)) continue;
    if (!declaration.initializer) continue;
    const call = unwrapCall(declaration.initializer);
    const kind = call ? callName(call) : null;
    if (kind === "cva" || kind === "tv") continue;
    const forward = call && kind === "forwardRef" ? call : undefined;
    const inner = forward ? functionArg(forward) : undefined;
    const propsType = forward?.typeArguments?.[1] ?? inner?.parameters[0]?.type;
    const body = inner?.body ?? (isFunctionLike(declaration.initializer) ? declaration.initializer.body : undefined);
    declarations.set(declaration.name.text, {
      node: declaration,
      line: lineOf(sourceFile, declaration),
      propsType,
      body,
    });
    if (exportModifier) exported.add(declaration.name.text);
  }
}

function collectExportNames(
  statement: ts.Statement,
  exported: Set<string>,
  aliases: Map<string, string>,
): void {
  if (!ts.isExportDeclaration(statement) || !statement.exportClause) return;
  if (statement.moduleSpecifier) return;
  if (!ts.isNamedExports(statement.exportClause)) return;
  for (const element of statement.exportClause.elements) {
    const local = element.propertyName?.text ?? element.name.text;
    exported.add(element.name.text);
    if (element.propertyName && element.name.text !== local) aliases.set(element.name.text, local);
  }
}

function typeFromInterface(node: ts.InterfaceDeclaration, sourceFile: ts.SourceFile): TypeInfo {
  const info = emptyType();
  for (const heritage of node.heritageClauses ?? []) {
    for (const type of heritage.types) {
      absorbTypeNode(heritageToType(type, sourceFile), info);
    }
  }
  for (const member of node.members) {
    const prop = propFromSignature(member);
    if (prop) info.props.push(prop);
  }
  return info;
}

function heritageToType(type: ts.ExpressionWithTypeArguments, sourceFile: ts.SourceFile): ts.TypeNode {
  const text = type.getText(sourceFile);
  const file = ts.createSourceFile("heritage.tsx", `type T = ${text};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = file.statements[0];
  if (statement && ts.isTypeAliasDeclaration(statement)) return statement.type;
  return ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
}

function resolveType(node: ts.TypeNode, types: Map<string, TypeInfo>, seen: Set<string>): TypeInfo {
  const info = emptyType();
  absorbTypeNode(node, info, types, seen);
  return info;
}

function absorbTypeNode(
  node: ts.TypeNode,
  info: TypeInfo,
  types?: Map<string, TypeInfo>,
  seen: Set<string> = new Set(),
): void {
  if (ts.isParenthesizedTypeNode(node)) {
    absorbTypeNode(node.type, info, types, seen);
    return;
  }
  if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    for (const part of node.types) absorbTypeNode(part, info, types, seen);
    return;
  }
  if (ts.isTypeLiteralNode(node)) {
    for (const member of node.members) {
      const prop = propFromSignature(member);
      if (prop) info.props.push(prop);
    }
    return;
  }
  const variant = variantRef(node);
  if (variant) {
    info.variantRefs.push(variant);
    return;
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    const local = types?.get(name);
    if (local && !seen.has(name)) {
      seen.add(name);
      info.props.push(...local.props);
      info.extendNames.push(...local.extendNames);
      info.variantRefs.push(...local.variantRefs);
      return;
    }
  }
  const text = shortText(node);
  if (text && text !== "any") info.extendNames.push(text);
}

function variantRef(node: ts.TypeNode): string | null {
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return null;
  if (node.typeName.text !== "VariantProps") return null;
  const argument = node.typeArguments?.[0];
  if (argument && ts.isTypeQueryNode(argument) && ts.isIdentifier(argument.exprName)) {
    return argument.exprName.text;
  }
  return null;
}

function propFromSignature(member: ts.TypeElement): PropInfo | null {
  if (!ts.isPropertySignature(member) || !member.name) return null;
  const name = propertyName(member.name);
  if (!name) return null;
  const type = member.type ? shortText(member.type) : undefined;
  return {
    name,
    optional: Boolean(member.questionToken),
    ...(type ? { type } : {}),
  };
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function variantGroupsFor(
  refs: string[],
  variants: Map<string, VariantGroup[]>,
  body: ts.Node | undefined,
  allNames: string[],
): VariantGroup[] {
  const names = new Set(refs);
  if (names.size === 0 && body) {
    const text = body.getText();
    for (const name of allNames) {
      if (text.includes(name)) names.add(name);
    }
  }
  const groups: VariantGroup[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    for (const group of variants.get(name) ?? []) {
      if (seen.has(group.name)) continue;
      seen.add(group.name);
      groups.push(group);
    }
  }
  return groups;
}

function parseVariantCall(call: ts.CallExpression, kind: "cva" | "tv"): VariantGroup[] {
  const configNode = kind === "tv" ? call.arguments[0] : call.arguments[1];
  if (!configNode || !ts.isObjectLiteralExpression(configNode)) return [];
  const variantsProp = objectProp(configNode, "variants");
  const defaultsProp = objectProp(configNode, "defaultVariants");
  if (!variantsProp || !ts.isObjectLiteralExpression(variantsProp)) return [];
  const defaults = defaultsProp && ts.isObjectLiteralExpression(defaultsProp) ? stringProps(defaultsProp) : {};
  const groups: VariantGroup[] = [];
  for (const property of variantsProp.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name || !ts.isObjectLiteralExpression(property.initializer)) continue;
    const options = property.initializer.properties.flatMap((option) => {
      if (ts.isPropertyAssignment(option) || ts.isMethodDeclaration(option) || ts.isShorthandPropertyAssignment(option)) {
        const optionName = propertyName(option.name);
        return optionName ? [optionName] : [];
      }
      return [];
    });
    const fallback = defaults[name];
    groups.push({
      name,
      options,
      ...(fallback ? { defaultValue: fallback } : {}),
    });
  }
  return groups;
}

function stringProps(object: ts.ObjectLiteralExpression): Record<string, string> {
  const values: Record<string, string> = {};
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name) continue;
    if (ts.isStringLiteral(property.initializer)) values[name] = property.initializer.text;
  }
  return values;
}

function objectProp(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyName(property.name) === name) return property.initializer;
  }
  return undefined;
}

function elementsIn(body: ts.Node): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (ts.isIdentifier(node.tagName) && INTERESTING_ELEMENTS.has(node.tagName.text)) {
        found.add(node.tagName.text);
      }
    }
    if (ts.isStringLiteral(node) && INTERESTING_ELEMENTS.has(node.text)) {
      const parent = node.parent;
      if (parent && (ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent) || ts.isAsExpression(parent))) {
        found.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return [...found];
}

function unwrapCall(expression: ts.Expression): ts.CallExpression | undefined {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return ts.isCallExpression(current) ? current : undefined;
}

function callName(call: ts.CallExpression): string | null {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function functionArg(call: ts.CallExpression): ts.FunctionExpression | ts.ArrowFunction | undefined {
  const argument = call.arguments[0];
  if (!argument) return undefined;
  if (ts.isFunctionExpression(argument) || ts.isArrowFunction(argument)) return argument;
  return undefined;
}

function isFunctionLike(expression: ts.Expression): expression is ts.FunctionExpression | ts.ArrowFunction {
  const unwrapped = unwrapAssertion(expression);
  return ts.isFunctionExpression(unwrapped) || ts.isArrowFunction(unwrapped);
}

function unwrapAssertion(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function hasExport(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function shortText(node: ts.Node): string | undefined {
  const text = node.getText().replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return undefined;
  return text;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
