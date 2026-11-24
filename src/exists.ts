import { componentByName, importStatement, siblingsOf } from "./catalog.js";
import { UserError } from "./errors.js";
import { formatPrimitives } from "./primitives.js";
import { matchStateQuery, stateLabel, type StateQueryHit } from "./stories/states.js";
import type { Catalog, CatalogComponent, Recipe } from "./types.js";

export function normalizeQuery(input: string): string {
  let query = input.trim().replace(/^["']|["']$/g, "");
  if (/<a\b/i.test(query) && /button/i.test(query)) return "button";
  query = query.replace(/^<|>$/g, "");
  query = query.replace(/^@\/components\/ui\//, "");
  query = query.replace(/^ui\//i, "");
  query = query.replace(/\.(tsx|jsx|ts|js)$/, "");
  return query.trim();
}

export function renderExists(catalog: Catalog, rawQuery: string): { found: boolean; text: string } {
  const query = normalizeQuery(rawQuery);
  if (!query) throw new UserError("Usage: uninvent exists <Component>");
  const recipes = (catalog.recipes ?? [])
    .map((recipe) => ({ recipe, score: scoreRecipe(recipe, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title));
  const ranked = catalog.components
    .map((component) => ({ component, score: scoreComponent(component, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.component.file.localeCompare(b.component.file) || a.component.name.localeCompare(b.component.name));
  const stateHits = matchStateQuery(catalog, query);
  const bestState = stateHits[0]?.score ?? 0;
  const bestRecipe = recipes[0]?.score ?? 0;
  const bestComponent = ranked[0]?.score ?? 0;
  const singleToken = !query.includes(" ");
  const exactComponent = bestComponent === 100 && singleToken;
  if (!exactComponent && bestState >= 70 && bestState >= bestRecipe && bestState >= bestComponent) {
    return { found: true, text: renderStateHits(stateHits, catalog) };
  }
  const recipeWins =
    (bestRecipe >= 90 && bestRecipe >= bestComponent && !(bestComponent === 100 && singleToken)) ||
    (bestRecipe >= 60 && bestComponent === 0);
  if (recipeWins) return { found: true, text: renderRecipeMatches(recipes, catalog) };
  if (ranked.length === 0) {
    return { found: false, text: `no match for "${rawQuery.trim()}"\n` };
  }
  const best = ranked[0]?.score ?? 0;
  const matches = best === 100
    ? ranked.filter((entry) => entry.score === 100)
    : ranked.filter((entry) => entry.score >= 50).slice(0, 5);
  if (matches.length > 3 && best < 100) {
    const lines = [`${matches.length} matches`];
    for (const match of matches) lines.push(`  ${match.component.name}  ${match.component.file}`);
    lines.push("Run uninvent exists <name> for one of them.");
    return { found: true, text: `${lines.join("\n")}\n` };
  }
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const match of matches) {
    const key = `${match.component.file}:${match.component.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push(renderComponent(match.component, catalog));
  }
  return { found: true, text: `${blocks.join("\n\n")}\n` };
}

function renderRecipeMatches(
  ranked: { recipe: Recipe; score: number }[],
  catalog: Catalog,
): string {
  const best = ranked[0]?.score ?? 0;
  const matches = ranked.filter((entry) => entry.score === best).slice(0, 3);
  const only = matches[0];
  if (matches.length === 1 && only) return `${renderRecipe(only.recipe, catalog)}\n`;
  const lines = [`${matches.length} recipes`];
  for (const match of matches) lines.push(`  ${match.recipe.title}  ${match.recipe.uses.join(", ")}`);
  lines.push("Run uninvent exists \"<recipe>\" for one of them.");
  return `${lines.join("\n")}\n`;
}

function renderRecipe(recipe: Recipe, catalog: Catalog): string {
  const lines = [`${recipe.title}  recipe ${recipe.id}`];
  if (recipe.summary) lines.push(`  ${recipe.summary}`);
  lines.push(`  uses: ${recipe.uses.join(", ")}`);
  const seenPaths = new Set<string>();
  for (const name of recipe.uses) {
    const component = componentByName(catalog, name);
    if (!component || seenPaths.has(component.importPath)) continue;
    seenPaths.add(component.importPath);
    lines.push(`  ${importStatement(component, catalog)}`);
  }
  if (recipe.seenIn && recipe.seenIn.length > 0) lines.push(`  seen in: ${recipe.seenIn.join(", ")}`);
  if (recipe.example) {
    const example = recipe.example.split("\n");
    const shown = example.slice(0, 24);
    lines.push("  example:");
    for (const line of shown) lines.push(`    ${line}`);
    if (example.length > shown.length) lines.push("    …");
  }
  return lines.join("\n");
}

function scoreRecipe(recipe: Recipe, query: string): number {
  const wanted = keyOf(query);
  if (!wanted) return 0;
  const fields = [recipe.title, recipe.id, ...recipe.intents];
  if (fields.some((field) => keyOf(field) === wanted)) return 100;
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  if (words.length >= 2) {
    const haystack = fields.map((field) => keyOf(field)).join(" ");
    if (words.every((word) => haystack.includes(word))) return 90;
  }
  if (wanted.length >= 4 && fields.some((field) => keyOf(field).includes(wanted))) return 60;
  return 0;
}

function renderComponent(component: CatalogComponent, catalog: Catalog): string {
  const lines = [
    `${component.name}  ${component.file}:${component.line}`,
    `  ${importStatement(component, catalog)}`,
  ];
  if (component.props.length > 0) {
    lines.push(`  props: ${component.props.map((prop) => (prop.optional ? `${prop.name}?` : prop.name)).join(", ")}`);
  }
  if (component.extends.length > 0) lines.push(`  extends: ${component.extends.join(", ")}`);
  if (component.variants.length > 0) {
    lines.push("  variants:");
    for (const variant of component.variants) {
      const fallback = variant.defaultValue ? ` (default ${variant.defaultValue})` : "";
      lines.push(`    ${variant.name}: ${variant.options.join(" | ")}${fallback}`);
    }
  }
  if (component.elements.length > 0) {
    lines.push(`  renders: ${component.elements.map((element) => `<${element}>`).join(", ")}`);
  }
  if (component.primitives.length > 0) lines.push(`  primitives: ${formatPrimitives(component.primitives)}`);
  const parts = component.primitives.flatMap((entry) => entry.parts ?? []);
  if (parts.length > 0) lines.push(`  parts: ${parts.join(", ")}`);
  const states = formatStateLine(component);
  if (states) lines.push(states);
  if (component.stories.length > 0) lines.push(`  stories: ${component.stories.join(", ")}`);
  const also = siblingsOf(component, catalog)
    .filter((entry) => entry.name !== component.name)
    .map((entry) => entry.name);
  if (also.length > 0) lines.push(`  also: ${also.join(", ")}`);
  return lines.join("\n");
}

function renderStateHits(hits: StateQueryHit[], catalog: Catalog): string {
  const best = hits[0]?.score ?? 0;
  const matches = hits.filter((hit) => hit.score === best).slice(0, 5);
  const only = matches[0];
  if (matches.length === 1 && only) return `${renderStateHit(only, catalog)}\n`;
  const label = only ? stateLabel(only.states[0] ?? { id: "state", label: "state", kind: "story", stories: [] }) : "state";
  const lines = [`${matches.length} components document ${label}`];
  for (const hit of matches) {
    const stories = [...new Set(hit.states.flatMap((state) => state.stories))];
    lines.push(`  ${hit.component.name}  ${stories.join(", ")}`);
  }
  lines.push("Run uninvent exists \"<state> <name>\" for one of them.");
  return `${lines.join("\n")}\n`;
}

function renderStateHit(hit: StateQueryHit, catalog: Catalog): string {
  const lines = [`${hit.component.name}  ${hit.component.file}:${hit.component.line}`];
  for (const state of hit.states) {
    const stories = state.stories.length > 0 ? `  story ${state.stories.join(", ")}` : "";
    lines.push(`  state: ${stateLabel(state)}${stories}`);
  }
  lines.push(`  ${importStatement(hit.component, catalog)}`);
  return lines.join("\n");
}

function formatStateLine(component: CatalogComponent): string | null {
  const states = component.states ?? [];
  if (states.length === 0) return null;
  const shown = states.slice(0, 8).map((state) => {
    const stories = state.stories.join(", ");
    return stories ? `${stateLabel(state)} (${stories})` : stateLabel(state);
  });
  const extra = states.length > shown.length ? `, +${states.length - shown.length}` : "";
  return `  states: ${shown.join(", ")}${extra}`;
}

function scoreComponent(component: CatalogComponent, query: string): number {
  const wanted = keyOf(query);
  if (!wanted) return 0;
  const name = keyOf(component.name);
  const base = keyOf(component.file.split("/").pop()?.replace(/\.(tsx|jsx|ts|js)$/, "") ?? "");
  // Name equality wins. A file like dialog.tsx also exports DialogContent, and those
  // must not outrank the component the query actually named.
  if (name === wanted) return 100;
  if (wanted.length >= 3 && name.startsWith(wanted)) return 80;
  if (base === wanted) return 70;
  if (wanted.length >= 3 && (name.includes(wanted) || base.includes(wanted))) return 50;
  return 0;
}

function keyOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
