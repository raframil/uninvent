import ts from "typescript";
import type { StoryArg } from "../types.js";

export interface ParsedTag {
  name: string;
  args: StoryArg[];
}

export interface ParsedStory {
  name: string;
  args: StoryArg[];
  tags: ParsedTag[];
}

export interface ParsedImport {
  local: string;
  imported: string;
  from: string;
}

export interface ParsedStoryModule {
  componentName?: string;
  metaArgs: StoryArg[];
  imports: ParsedImport[];
  stories: ParsedStory[];
}

export function emptyStoryModule(): ParsedStoryModule {
  return { metaArgs: [], imports: [], stories: [] };
}

/**
 * Static CSF or MDX extract. Never throws: a story file the parser does not
 * understand contributes no states, and the rest of the catalog still scans.
 */
export function parseStorySource(file: string, source: string): ParsedStoryModule {
  try {
    if (file.endsWith(".mdx")) return parseMdx(source);
    return parseCsf(file, source);
  } catch {
    return emptyStoryModule();
  }
}

function parseCsf(file: string, source: string): ParsedStoryModule {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const locals = new Map<string, ts.Node>();
  const imports: ParsedImport[] = [];
  let metaName: string | undefined;
  let metaObject: ts.ObjectLiteralExpression | undefined;
  const stories: ParsedStory[] = [];
  const seen = new Set<string>();

  for (const statement of sourceFile.statements) {
    collectImports(statement, imports);
    rememberLocals(statement, locals);
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    const value = unwrap(statement.expression);
    if (ts.isIdentifier(value)) {
      metaName = value.text;
      const target = locals.get(value.text);
      const object = target && ts.isExpression(target) ? asObject(unwrap(target)) : undefined;
      if (object) metaObject = object;
    } else if (ts.isObjectLiteralExpression(value)) {
      metaObject = value;
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && hasExport(statement)) {
      const name = statement.name.text;
      if (!keepStoryName(name) || name === metaName) continue;
      const story = { name, args: [], tags: tagsIn(statement) };
      stories.push(story);
      seen.add(name);
      continue;
    }
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const name = declaration.name.text;
      if (!keepStoryName(name) || name === metaName || seen.has(name)) continue;
      const story = storyFromExpression(name, declaration.initializer, locals);
      if (!story) continue;
      stories.push(story);
      seen.add(name);
    }
  }

  for (const statement of sourceFile.statements) {
    const assignment = assignmentOf(statement);
    if (!assignment) continue;
    const { target, property, value } = assignment;
    if (property !== "args") continue;
    const story = stories.find((entry) => entry.name === target);
    if (!story) continue;
    story.args = mergeArgs(story.args, argsOf(value));
  }

  if (!metaObject) {
    const metaLocal = locals.get("meta") ?? (metaName ? locals.get(metaName) : undefined);
    const object = metaLocal && ts.isExpression(metaLocal) ? asObject(unwrap(metaLocal)) : undefined;
    if (object) metaObject = object;
  }

  return {
    ...(metaObject ? componentFromMeta(metaObject) : {}),
    metaArgs: metaObject ? argsOf(objectProp(metaObject, "args")) : [],
    imports,
    stories,
  };
}

function parseMdx(source: string): ParsedStoryModule {
  const parsed = emptyStoryModule();
  parsed.imports = mdxImports(source);
  const meta = findTags(source, "Meta")[0];
  if (meta) {
    const attrs = jsxAttributeSource("Meta", meta.attrs);
    if (attrs) {
      const component = attrs.componentName;
      if (component) parsed.componentName = component;
      parsed.metaArgs = attrs.args;
    }
  }
  for (const story of findTags(source, "Story")) {
    const attrs = jsxAttributeSource("Story", story.attrs);
    const name = attrs?.name ?? attrs?.ofName;
    if (!name || !keepStoryName(name)) continue;
    const tags = story.children.trim().length > 0 ? tagsInSource(story.children) : [];
    parsed.stories.push({
      name,
      args: attrs?.args ?? [],
      tags,
    });
  }
  if (parsed.stories.length === 0 && /export\s+(const|function|default)\b/.test(source)) {
    return parseCsf("stories.tsx", source);
  }
  return parsed;
}

function storyFromExpression(
  name: string,
  expression: ts.Expression,
  locals: Map<string, ts.Node>,
): ParsedStory | null {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) {
    const target = locals.get(value.text);
    if (!target) return null;
    if (ts.isFunctionDeclaration(target)) return { name, args: [], tags: tagsIn(target) };
    return ts.isExpression(target) ? storyFromExpression(name, target, locals) : null;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const argsNode = objectProp(value, "args");
    const render = objectProp(value, "render");
    if (!argsNode && !render && (objectProp(value, "title") || objectProp(value, "component"))) return null;
    return {
      name,
      args: argsOf(argsNode),
      tags: render ? tagsIn(render) : [],
    };
  }
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return { name, args: [], tags: tagsIn(value) };
  }
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === "bind") {
    const target = unwrap(value.expression.expression);
    if (ts.isIdentifier(target)) {
      const inner = locals.get(target.text);
      if (inner && ts.isFunctionDeclaration(inner)) return { name, args: [], tags: tagsIn(inner) };
      const base = inner && ts.isExpression(inner) ? storyFromExpression(name, inner, locals) : null;
      return { name, args: base?.args ?? [], tags: base?.tags ?? [] };
    }
  }
  return null;
}

function asObject(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  return ts.isObjectLiteralExpression(expression) ? expression : undefined;
}

function componentFromMeta(object: ts.ObjectLiteralExpression): { componentName?: string } {
  const component = objectProp(object, "component");
  if (!component) return {};
  const value = unwrap(component);
  if (ts.isIdentifier(value)) return { componentName: value.text };
  return {};
}

function rememberLocals(statement: ts.Statement, locals: Map<string, ts.Node>): void {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    locals.set(statement.name.text, statement);
    return;
  }
  if (!ts.isVariableStatement(statement)) return;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
    locals.set(declaration.name.text, declaration.initializer);
  }
}

function collectImports(statement: ts.Statement, imports: ParsedImport[]): void {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return;
  const from = statement.moduleSpecifier.text;
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return;
  if (clause.name) imports.push({ local: clause.name.text, imported: "default", from });
  const named = clause.namedBindings;
  if (!named || !ts.isNamedImports(named)) return;
  for (const element of named.elements) {
    if (element.isTypeOnly) continue;
    imports.push({
      local: element.name.text,
      imported: element.propertyName?.text ?? element.name.text,
      from,
    });
  }
}

function argsOf(expression: ts.Expression | undefined): StoryArg[] {
  if (!expression) return [];
  const value = unwrap(expression);
  if (!ts.isObjectLiteralExpression(value)) return [];
  const args: StoryArg[] = [];
  for (const property of value.properties) {
    if (args.length >= 16) break;
    if (ts.isSpreadAssignment(property)) continue;
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name) continue;
    if (ts.isShorthandPropertyAssignment(property)) continue;
    const literal = literalValue(property.initializer);
    if (literal === null) continue;
    args.push({ name, value: literal });
  }
  return args;
}

function tagsIn(node: ts.Node): ParsedTag[] {
  const tags: ParsedTag[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      const name = jsxTagName(current.tagName);
      if (name) tags.push({ name, args: jsxArgs(current) });
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return tags;
}

function tagsInSource(source: string): ParsedTag[] {
  const wrapped = `export function __Story() {\nreturn (\n<>\n${source}\n</>\n);\n}\n`;
  try {
    const file = ts.createSourceFile("story-fragment.tsx", wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const statement = file.statements.find((entry) => ts.isFunctionDeclaration(entry));
    return statement ? tagsIn(statement) : [];
  } catch {
    return [];
  }
}

function jsxArgs(element: ts.JsxOpeningLikeElement): StoryArg[] {
  const args: StoryArg[] = [];
  for (const property of element.attributes.properties) {
    if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) continue;
    const name = property.name.text;
    if (!property.initializer) {
      args.push({ name, value: "true" });
      continue;
    }
    if (ts.isStringLiteral(property.initializer)) {
      args.push({ name, value: property.initializer.text });
      continue;
    }
    if (ts.isJsxExpression(property.initializer) && property.initializer.expression) {
      const literal = literalValue(property.initializer.expression);
      if (literal !== null) args.push({ name, value: literal });
    }
  }
  return args;
}

function jsxTagName(name: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(name)) return name.text;
  return null;
}

interface MdxTag {
  attrs: string;
  children: string;
}

function findTags(source: string, tag: string): MdxTag[] {
  const found: MdxTag[] = [];
  const needle = `<${tag}`;
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf(needle, index);
    if (start === -1) break;
    const next = source[start + needle.length];
    if (next !== undefined && /[A-Za-z0-9]/.test(next)) {
      index = start + needle.length;
      continue;
    }
    const openingEnd = scanTagEnd(source, start);
    if (openingEnd === -1) break;
    const opening = source.slice(start, openingEnd);
    const selfClosing = /\/\s*>$/.test(opening);
    const attrs = opening.slice(needle.length, opening.length - (selfClosing ? 2 : 1)).trim();
    if (selfClosing) {
      found.push({ attrs, children: "" });
      index = openingEnd;
      continue;
    }
    const close = source.indexOf(`</${tag}>`, openingEnd);
    if (close === -1) break;
    found.push({ attrs, children: source.slice(openingEnd, close) });
    index = close + tag.length + 3;
  }
  return found;
}

function scanTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  let braces = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") braces += 1;
    else if (char === "}" && braces > 0) braces -= 1;
    else if (char === ">" && braces === 0) return index + 1;
  }
  return -1;
}

interface MdxAttrs {
  name?: string;
  ofName?: string;
  componentName?: string;
  args: StoryArg[];
}

function jsxAttributeSource(tag: string, attrs: string): MdxAttrs | null {
  const wrapped = `export const __el = (<${tag} ${attrs} />);`;
  try {
    const file = ts.createSourceFile("mdx-attrs.tsx", wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const statement = file.statements[0];
    if (!statement || !ts.isVariableStatement(statement)) return null;
    const declaration = statement.declarationList.declarations[0];
    const initializer = declaration?.initializer ? unwrap(declaration.initializer) : undefined;
    if (!initializer || !ts.isJsxSelfClosingElement(initializer)) return null;
    const parsed: MdxAttrs = { args: [] };
    for (const property of initializer.attributes.properties) {
      if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) continue;
      const name = property.name.text;
      if (name === "args") {
        const expression = property.initializer && ts.isJsxExpression(property.initializer)
          ? property.initializer.expression
          : undefined;
        parsed.args = expression ? argsOf(expression) : [];
        continue;
      }
      if (name === "name") {
        const value = attributeLiteral(property);
        if (value) parsed.name = value;
        continue;
      }
      if (name === "component") {
        const expression = property.initializer && ts.isJsxExpression(property.initializer)
          ? property.initializer.expression
          : undefined;
        const component = expression ? unwrap(expression) : undefined;
        if (component && ts.isIdentifier(component)) parsed.componentName = component.text;
        continue;
      }
      if (name === "of") {
        const expression = property.initializer && ts.isJsxExpression(property.initializer)
          ? property.initializer.expression
          : undefined;
        const ofName = expression ? memberTail(unwrap(expression)) : null;
        if (ofName) parsed.ofName = ofName;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function attributeLiteral(property: ts.JsxAttribute): string | null {
  if (!property.initializer) return null;
  if (ts.isStringLiteral(property.initializer)) return property.initializer.text;
  if (ts.isJsxExpression(property.initializer) && property.initializer.expression) {
    return literalValue(property.initializer.expression);
  }
  return null;
}

function memberTail(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function mdxImports(source: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const pattern = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue;
    const clause = match[2]?.trim();
    const from = match[3];
    if (!clause || !from) continue;
    const named = clause.match(/\{([^}]+)\}/);
    const before = clause.replace(/\{[^}]+\}/, "").replace(/,/g, " ").trim();
    if (before && before !== "type") {
      const local = before.split(/\s+/)[0];
      if (local && local !== "type") imports.push({ local, imported: "default", from });
    }
    if (!named?.[1]) continue;
    for (const part of named[1].split(",")) {
      const piece = part.trim();
      if (!piece || piece.startsWith("type ")) continue;
      const alias = piece.split(/\s+as\s+/);
      const imported = alias[0]?.trim();
      const local = alias[1]?.trim() || imported;
      if (!imported || !local) continue;
      imports.push({ local, imported, from });
    }
  }
  return imports;
}

function assignmentOf(
  statement: ts.Statement,
): { target: string; property: string; value: ts.Expression } | null {
  if (!ts.isExpressionStatement(statement)) return null;
  const expression = statement.expression;
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  if (!ts.isPropertyAccessExpression(expression.left) || !ts.isIdentifier(expression.left.expression)) return null;
  return {
    target: expression.left.expression.text,
    property: expression.left.name.text,
    value: expression.right,
  };
}

function objectProp(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyName(property.name) === name) return property.initializer;
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function literalValue(expression: ts.Expression): string | null {
  const value = unwrap(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (value.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isNumericLiteral(value)) return value.text;
  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(value.operand)
  ) {
    return `-${value.operand.text}`;
  }
  return null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function mergeArgs(base: StoryArg[], over: StoryArg[]): StoryArg[] {
  const names = new Set(over.map((arg) => arg.name));
  return [...base.filter((arg) => !names.has(arg.name)), ...over];
}

function keepStoryName(name: string): boolean {
  if (!/^[A-Za-z]/.test(name)) return false;
  if (name === "meta" || name === "default") return false;
  if (name.startsWith("__")) return false;
  return true;
}

function hasExport(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
