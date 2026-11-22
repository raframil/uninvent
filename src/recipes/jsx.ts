import { componentForImport } from "../catalog.js";
import { parseUiSource } from "../parse/file.js";
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

/** Parse a TSX module into a JSX forest and its named imports. Null when the file cannot be parsed. */
export function parseUi(source: string, filename: string): ParsedUi | null {
  const parsed = parseUiSource(source, filename, false);
  if (!parsed) return null;
  return { tree: parsed.recipeTree, imports: parsed.imports };
}

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
    const component = componentForImport(catalog.components, catalog.paths, file, spec.specifier, spec.imported);
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
