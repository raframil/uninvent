import { importStatement, siblingsOf } from "./catalog.js";
import { UserError } from "./errors.js";
import { formatPrimitives } from "./primitives.js";
import type { Catalog, CatalogComponent } from "./types.js";

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
  const ranked = catalog.components
    .map((component) => ({ component, score: scoreComponent(component, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.component.file.localeCompare(b.component.file) || a.component.name.localeCompare(b.component.name));
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
  if (component.stories.length > 0) lines.push(`  stories: ${component.stories.join(", ")}`);
  const also = siblingsOf(component, catalog)
    .filter((entry) => entry.name !== component.name)
    .map((entry) => entry.name);
  if (also.length > 0) lines.push(`  also: ${also.join(", ")}`);
  return lines.join("\n");
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
