import { componentByName, importStatement, suggestionLabel } from "../catalog.js";
import { describeFinding } from "../check/format.js";
import { RAW_ELEMENTS, type Catalog, type CatalogComponent, type Finding, type Recipe } from "../types.js";
import {
  catalogLocals,
  intrinsicTag,
  parseExample,
  parseUi,
  visitJsx,
  type JsxNode,
} from "./jsx.js";

/**
 * Flag a declared recipe only when its example has a small, concrete shape
 * (at least two signals, one of them a catalog component that stands in for
 * a raw element) and the file rebuilds that shape without those components.
 * Anything looser is documentation for `exists` and the skill, not a finding.
 */
const MAX_ELEMENTS = 40;
const MAX_LINES = 80;
const COUNT_SLACK = 1;
const LANDMARKS = new Set(["label", "h1", "h2", "h3", "h4", "header", "form", "table", "p", "ul", "ol"]);

interface Signal {
  tag: string;
  count: number;
}

interface Signature {
  anchor: string | null;
  signals: Signal[];
  slotTags: Set<string>;
  covered: Set<string>;
  suggest: string[];
}

export interface RecipeHit {
  finding: Finding;
  start: number;
  end: number;
  tags: Set<string>;
  signals: number;
  index: number;
}

export function findRecipeHits(options: {
  source: string;
  file: string;
  catalog: Catalog;
  lines?: Set<number>;
  withLine?: boolean;
}): RecipeHit[] {
  const recipes = options.catalog.recipes ?? [];
  if (recipes.length === 0) return [];
  const parsed = parseUi(options.source, options.file);
  if (!parsed || parsed.tree.length === 0) return [];
  const locals = catalogLocals(parsed, options.file, options.catalog);
  const hits: RecipeHit[] = [];
  recipes.forEach((recipe, index) => {
    if (recipe.source !== "declared") return;
    const signature = signatureFor(recipe, options.catalog);
    if (!signature) return;
    const candidates = candidatesFor(parsed.tree, signature);
    for (const node of candidates) {
      if (subtreeSize(node) > MAX_ELEMENTS) continue;
      if (node.endLine - node.line > MAX_LINES) continue;
      if (referencesCatalog(node, locals, signature.covered)) continue;
      const counts = tally(node, intrinsicTag);
      if (!withinBounds(counts, signature.signals, signature.anchor)) continue;
      if (!overlapsLines(node.line, node.endLine, options.lines)) continue;
      const suggestion = signature.suggest.map((name) => suggestionLabel(name, options.catalog)).join(" + ");
      if (!suggestion) continue;
      const finding: Finding = {
        kind: "recipe",
        file: options.file,
        line: node.line,
        recipe: recipe.title,
        suggestion,
        import: importsFor(signature.suggest, options.catalog),
        message: "",
      };
      finding.message = describeFinding(finding, options.withLine !== false);
      hits.push({
        finding,
        start: node.line,
        end: node.endLine,
        tags: signature.slotTags,
        signals: signature.signals.length,
        index,
      });
    }
  });
  return prefer(hits);
}

/** Drop raw-element hits that the recipe line already explains. Keep the rest. */
export function applyRecipeHits(findings: Finding[], hits: RecipeHit[]): Finding[] {
  if (hits.length === 0) return findings;
  const kept = findings.filter((finding) => !recipeExplains(finding, hits));
  kept.push(...hits.map((hit) => hit.finding));
  return kept;
}

function recipeExplains(finding: Finding, hits: RecipeHit[]): boolean {
  if (finding.kind !== "raw-element" || !finding.element) return false;
  const tag = finding.element === "a" ? "button" : finding.element;
  return hits.some((hit) => hit.tags.has(tag) && finding.line >= hit.start && finding.line <= hit.end);
}

function prefer(hits: RecipeHit[]): RecipeHit[] {
  const ordered = [...hits].sort((a, b) => b.signals - a.signals || a.index - b.index || a.start - b.start);
  const kept: RecipeHit[] = [];
  for (const hit of ordered) {
    const overlaps = kept.some(
      (other) => other.finding.file === hit.finding.file && other.start <= hit.end && hit.start <= other.end,
    );
    if (overlaps) continue;
    kept.push(hit);
  }
  return kept;
}

function signatureFor(recipe: Recipe, catalog: Catalog): Signature | null {
  if (!recipe.example) return null;
  const tree = parseExample(recipe.example);
  if (!tree || tree.length === 0) return null;
  const slots = new Map<string, string>();
  for (const name of recipe.uses) {
    const component = componentByName(catalog, name);
    if (!component) continue;
    const tag = primaryIntrinsic(component);
    if (tag) slots.set(name, tag);
  }
  const root = singleRoot(tree);
  const counts = tally(root, (node) => exampleTag(node, slots));
  const signals: Signal[] = [];
  const slotTags = new Set<string>();
  for (const [tag, count] of counts) {
    const isSlot = [...slots.values()].includes(tag);
    if (!isSlot && !LANDMARKS.has(tag)) continue;
    if (count <= 0) continue;
    signals.push({ tag, count });
    if (isSlot) slotTags.add(tag);
  }
  if (signals.length < 2 || slotTags.size === 0) return null;
  const anchorNode = findAnchor(root, signals, slots);
  const suggest = recipe.uses.filter((name) => {
    const tag = slots.get(name);
    return tag !== undefined && slotTags.has(tag);
  });
  if (suggest.length === 0) return null;
  return {
    anchor: anchorNode ? exampleTag(anchorNode, slots) : null,
    signals,
    slotTags,
    covered: new Set(recipe.uses),
    suggest,
  };
}

function findAnchor(node: JsxNode, signals: Signal[], slots: Map<string, string>): JsxNode | null {
  if (!meetsMinimums(tally(node, (entry) => exampleTag(entry, slots)), signals)) return null;
  for (const child of node.children) {
    const nested = findAnchor(child, signals, slots);
    if (nested) return nested;
  }
  const tag = exampleTag(node, slots);
  if (tag && signals.some((signal) => signal.tag === tag)) return node;
  return null;
}

function candidatesFor(forest: JsxNode[], signature: Signature): JsxNode[] {
  if (signature.anchor) {
    const found: JsxNode[] = [];
    visitJsx(forest, (node) => {
      if (intrinsicTag(node) === signature.anchor) found.push(node);
    });
    return found;
  }
  return smallest(forest, signature.signals);
}

function smallest(nodes: JsxNode[], signals: Signal[]): JsxNode[] {
  const matches: JsxNode[] = [];
  for (const node of nodes) {
    if (!meetsMinimums(tally(node, intrinsicTag), signals)) continue;
    const nested = smallest(node.children, signals);
    if (nested.length > 0) matches.push(...nested);
    else matches.push(node);
  }
  return matches;
}

function meetsMinimums(counts: Map<string, number>, signals: Signal[]): boolean {
  return signals.every((signal) => (counts.get(signal.tag) ?? 0) >= signal.count);
}

function withinBounds(counts: Map<string, number>, signals: Signal[], anchor: string | null): boolean {
  for (const signal of signals) {
    const seen = counts.get(signal.tag) ?? 0;
    if (signal.tag === anchor) {
      if (seen !== signal.count) return false;
    } else if (seen < signal.count || seen > signal.count + COUNT_SLACK) {
      return false;
    }
  }
  return true;
}

function referencesCatalog(node: JsxNode, locals: Map<string, string>, covered: Set<string>): boolean {
  if (node.kind === "component") {
    const name = locals.get(node.name);
    if (name && covered.has(name)) return true;
  }
  return node.children.some((child) => referencesCatalog(child, locals, covered));
}

function tally(node: JsxNode, tagOf: (node: JsxNode) => string | null, counts = new Map<string, number>()): Map<string, number> {
  const tag = tagOf(node);
  if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  for (const child of node.children) tally(child, tagOf, counts);
  return counts;
}

function exampleTag(node: JsxNode, slots: Map<string, string>): string | null {
  if (node.kind === "component") return slots.get(node.name) ?? null;
  return intrinsicTag(node);
}

function singleRoot(tree: JsxNode[]): JsxNode {
  const only = tree[0];
  if (tree.length === 1 && only) return only;
  return {
    name: "",
    kind: "fragment",
    line: 1,
    endLine: 1,
    buttonRole: false,
    children: tree,
  };
}

function subtreeSize(node: JsxNode): number {
  let count = 1;
  for (const child of node.children) count += subtreeSize(child);
  return count;
}

function overlapsLines(start: number, end: number, lines: Set<number> | undefined): boolean {
  if (!lines) return true;
  for (let line = start; line <= end; line += 1) {
    if (lines.has(line)) return true;
  }
  return false;
}

function primaryIntrinsic(component: CatalogComponent): string | null {
  for (const [element, name] of Object.entries(RAW_ELEMENTS)) {
    if (name === component.name) return element;
  }
  for (const element of component.elements) {
    if (element in RAW_ELEMENTS) return element;
  }
  return null;
}

function importsFor(names: string[], catalog: Catalog): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const name of names) {
    const component = componentByName(catalog, name);
    if (!component || seen.has(component.importPath)) continue;
    seen.add(component.importPath);
    lines.push(importStatement(component, catalog));
  }
  return lines.join("\n");
}
