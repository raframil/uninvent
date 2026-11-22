import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CatalogComponent, Recipe } from "../types.js";
import { parseExample, visitJsx } from "./jsx.js";

/** Hand-edited source of truth. Committed. Scan copies it into the catalog. */
export const RECIPES_FILE = "uninvent.recipes.md";

export interface ParseResult {
  recipes: Recipe[];
  warnings: string[];
}

const KNOWN_FIELDS = new Set(["id", "title", "intents", "uses", "summary"]);

export function loadDeclaredRecipes(root: string): ParseResult {
  const absolute = path.join(root, RECIPES_FILE);
  if (!existsSync(absolute)) return { recipes: [], warnings: [] };
  return parseRecipes(readFileSync(absolute, "utf8"), RECIPES_FILE);
}

/**
 * `uninvent.recipes.md` is a list of `##` sections.
 * Fields are `key: value` lines. One fenced tsx block is the example.
 * Prose outside a section is ignored, so a short intro can sit at the top.
 */
export function parseRecipes(markdown: string, file = RECIPES_FILE): ParseResult {
  const warnings: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;
  let inFence = false;
  const exampleLines: string[] = [];

  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (inFence) {
      if (line.trim() === "```") {
        if (current && current.example === null) current.example = exampleLines.join("\n").trim();
        inFence = false;
        exampleLines.length = 0;
      } else {
        exampleLines.push(line);
      }
      continue;
    }
    if (/^```[\w-]*\s*$/.test(line.trim())) {
      inFence = true;
      exampleLines.length = 0;
      continue;
    }
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      current = { heading: heading[1], fields: {}, example: null, line: index + 1 };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const field = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!field?.[1]) continue;
    const key = field[1].toLowerCase();
    if (!KNOWN_FIELDS.has(key)) {
      warnings.push(`${file}:${index + 1}: ignored unknown field "${key}"`);
      continue;
    }
    current.fields[key] = (field[2] ?? "").trim();
  }
  if (inFence) warnings.push(`${file}: unclosed code fence`);

  const recipes: Recipe[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const title = section.fields.title || section.heading;
    const id = slug(section.fields.id || title);
    if (!id) {
      warnings.push(`${file}:${section.line}: skipped a recipe with no title`);
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`${file}:${section.line}: duplicate recipe "${id}"`);
      continue;
    }
    seen.add(id);
    const uses = splitList(section.fields.uses);
    const recipe: Recipe = {
      id,
      title,
      intents: uniqueStrings([title, ...splitList(section.fields.intents)]),
      uses,
      summary: section.fields.summary || defaultSummary(uses),
      source: "declared",
      file,
    };
    if (section.example) recipe.example = section.example;
    recipes.push(recipe);
  }
  return { recipes, warnings };
}

/**
 * Fill `uses` from the example when the maintainer left it blank, and warn
 * when a name is not in the catalog. Unknown names stay, so `exists` still
 * shows what was written. An empty recipe is dropped.
 */
export function finalizeRecipes(
  recipes: Recipe[],
  components: CatalogComponent[],
): ParseResult {
  const warnings: string[] = [];
  const known = new Set(components.map((component) => component.name));
  const kept: Recipe[] = [];
  for (const recipe of recipes) {
    let uses = recipe.uses;
    if (uses.length === 0 && recipe.example) uses = namesInExample(recipe.example, known);
    for (const name of uses) {
      if (!known.has(name)) {
        warnings.push(`${recipe.file ?? RECIPES_FILE}: ${recipe.id} lists ${name}, which is not in the catalog`);
      }
    }
    if (uses.length === 0) {
      warnings.push(`${recipe.file ?? RECIPES_FILE}: ${recipe.id} names no components`);
      continue;
    }
    kept.push({
      ...recipe,
      uses,
      summary: recipe.summary || defaultSummary(uses),
    });
  }
  return { recipes: kept, warnings };
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface Section {
  heading: string;
  fields: Record<string, string>;
  example: string | null;
  line: number;
}

function namesInExample(example: string, known: Set<string>): string[] {
  const tree = parseExample(example);
  if (!tree) return [];
  const found: string[] = [];
  visitJsx(tree, (node) => {
    if (node.kind === "component" && known.has(node.name) && !found.includes(node.name)) found.push(node.name);
  });
  return found;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function defaultSummary(uses: string[]): string {
  if (uses.length === 0) return "";
  return `Uses ${humanList(uses)}.`;
}

function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
