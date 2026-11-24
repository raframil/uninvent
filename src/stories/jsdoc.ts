import ts from "typescript";
import { parseStateSpec } from "./manifest.js";
import type { StoryArg } from "../types.js";

export interface JsdocState {
  component: string;
  name: string;
  args: StoryArg[];
}

/**
 * `@state` tags and a small front-matter block in a component file.
 *
 * Above an export, `@state loading` and `@state variant=destructive Destructive`
 * document that component. A leading comment may name the component:
 *
 * ```
 * ---
 * Button:
 *   - loading
 *   - variant=destructive
 * ---
 * ```
 */
export function jsdocStates(file: string, source: string, componentNames: string[]): JsdocState[] {
  const known = new Set(componentNames);
  if (known.size === 0) return [];
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
  } catch {
    return [];
  }
  const states: JsdocState[] = [];
  const seenComments = new Set<string>();
  const take = (comment: string, implied: string | undefined): void => {
    if (!comment) return;
    const key = `${implied ?? ""}\0${comment}`;
    if (seenComments.has(key)) return;
    seenComments.add(key);
    states.push(...statesInComment(comment, implied, known));
  };

  const banner = commentCovering(source, 0);
  let bannerUsed = false;
  for (const statement of sourceFile.statements) {
    const names = exportedNames(statement, known);
    if (names.length !== 1) continue;
    const implied = names[0];
    if (!implied) continue;
    const comment = leadingComment(source, statement.getFullStart());
    if (comment && comment === banner) bannerUsed = true;
    take(comment, implied);
  }
  if (banner && !bannerUsed) {
    const implied = known.size === 1 ? [...known][0] : undefined;
    take(banner, implied);
  }
  return dedupe(states);
}

function statesInComment(comment: string, implied: string | undefined, known: Set<string>): JsdocState[] {
  const states: JsdocState[] = [];
  states.push(...frontMatter(comment, known));
  const pattern = /@state\s+([^\r\n*]+)/g;
  for (const match of comment.matchAll(pattern)) {
    const body = match[1]?.trim();
    if (!body) continue;
    const parsed = parseTaggedState(body, implied, known);
    if (parsed) states.push(parsed);
  }
  return states;
}

function frontMatter(comment: string, known: Set<string>): JsdocState[] {
  const match = comment.match(/---\s*([\s\S]*?)\s*---/);
  const block = match?.[1];
  if (!block) return [];
  const states: JsdocState[] = [];
  let current = "";
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*\*\s?/, "").trim();
    if (!line || line.startsWith("@")) continue;
    if (line.endsWith(":") && !line.startsWith("-")) {
      current = line.slice(0, -1).trim();
      continue;
    }
    if (!current || !known.has(current)) continue;
    const item = line.replace(/^-\s*/, "").trim();
    const spec = parseStateSpec(item);
    if (!spec) continue;
    states.push(toState(current, spec));
  }
  return states;
}

function parseTaggedState(body: string, implied: string | undefined, known: Set<string>): JsdocState | null {
  const tokens = body.split(/\s+/).filter((token) => token.length > 0);
  let component = implied;
  let specText = body.trim();
  if (tokens[0] && known.has(tokens[0]) && tokens.length > 1) {
    component = tokens[0];
    specText = tokens.slice(1).join(" ");
  }
  if (!component || !known.has(component)) return null;
  const spec = parseStateSpec(specText);
  if (!spec) return null;
  return toState(component, spec);
}

function toState(component: string, spec: { prop: string; value: string; story: string }): JsdocState {
  return { component, name: spec.story, args: [{ name: spec.prop, value: spec.value }] };
}

function exportedNames(statement: ts.Statement, known: Set<string>): string[] {
  const names: string[] = [];
  const add = (name: string | undefined): void => {
    if (name && known.has(name)) names.push(name);
  };
  if (!hasExport(statement)) return names;
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) add(statement.name.text);
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) add(declaration.name.text);
    }
  }
  return names;
}

function leadingComment(source: string, pos: number): string {
  const ranges = ts.getLeadingCommentRanges(source, pos) ?? [];
  return ranges.map((range) => source.slice(range.pos, range.end)).join("\n");
}

function commentCovering(source: string, pos: number): string {
  const ranges = ts.getLeadingCommentRanges(source, pos) ?? [];
  const first = ranges[0];
  if (!first || first.pos > pos + 2) return "";
  return source.slice(first.pos, first.end);
}

function hasExport(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function dedupe(states: JsdocState[]): JsdocState[] {
  const seen = new Set<string>();
  const unique: JsdocState[] = [];
  for (const state of states) {
    const key = `${state.component}\0${state.name}\0${state.args.map((arg) => `${arg.name}=${arg.value}`).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(state);
  }
  return unique;
}
