import type { Catalog, CatalogComponent } from "../types.js";
import { normalizeQuery } from "../exists.js";
import { isStateLikeProp, stateLabel } from "./states.js";

export interface CoverageRow {
  id: string;
  label: string;
  stories: string[];
  covered: boolean;
  /** The story is named for this state, and no literal arg or prop confirmed it. */
  nameOnly?: boolean;
}

export interface CoverageComponent {
  name: string;
  file: string;
  hasStories: boolean;
  rows: CoverageRow[];
}

/**
 * Which variants and states have a story, and which do not.
 * Informational: this never decides that a check failed.
 */
export function renderCoverage(
  catalog: Catalog,
  rawQuery: string,
  format: "text" | "json" | "markdown",
): { text: string; exitCode: number } {
  const parsed = catalog.components.every((component) => Array.isArray(component.states));
  let components = catalog.components.map((component) => coverageComponent(component, parsed));
  const query = rawQuery.trim();
  if (query) {
    const wanted = keyOf(normalizeQuery(query));
    const exact = components.filter((component) => keyOf(component.name) === wanted);
    components = exact.length > 0
      ? exact
      : components.filter((component) => wanted.length >= 3 && keyOf(component.name).includes(wanted));
    if (components.length === 0) return { text: `no match for "${query}"\n`, exitCode: 1 };
  }
  const documented = components.reduce((sum, component) => sum + component.rows.filter((row) => row.covered).length, 0);
  const missing = components.reduce((sum, component) => sum + component.rows.filter((row) => !row.covered).length, 0);
  if (format === "json") {
    return {
      text: `${JSON.stringify({ parsed, informational: true, documented, missing, components }, null, 2)}\n`,
      exitCode: 0,
    };
  }
  if (format === "markdown") {
    return { text: renderMarkdown(components, parsed, documented, missing), exitCode: 0 };
  }
  return { text: renderText(components, parsed, documented, missing), exitCode: 0 };
}

function coverageComponent(component: CatalogComponent, parsed: boolean): CoverageComponent {
  return {
    name: component.name,
    file: component.file,
    hasStories: component.stories.length > 0,
    rows: rowsFor(component, parsed),
  };
}

function rowsFor(component: CatalogComponent, parsed: boolean): CoverageRow[] {
  const rows: CoverageRow[] = [];
  for (const group of component.variants) {
    for (const option of group.options) {
      const state = component.states?.find(
        (entry) => entry.kind === "variant" && entry.prop === group.name && entry.value === option,
      );
      rows.push({
        id: `${group.name}:${option}`,
        label: `${group.name}=${option}`,
        stories: state?.stories ?? [],
        covered: Boolean(state && state.stories.length > 0),
      });
    }
  }
  if (!parsed) return rows;
  for (const state of component.states ?? []) {
    if (state.kind === "variant") continue;
    rows.push({
      id: state.id,
      label: stateLabel(state),
      stories: state.stories,
      covered: state.stories.length > 0,
      ...(state.kind === "story" ? { nameOnly: true } : {}),
    });
  }
  for (const prop of component.props) {
    if (!isStateLikeProp(prop.name)) continue;
    if (rows.some((row) => row.id === prop.name || row.label === prop.name)) continue;
    rows.push({ id: prop.name, label: prop.name, stories: [], covered: false });
  }
  return rows;
}

function renderText(
  components: CoverageComponent[],
  parsed: boolean,
  documented: number,
  missing: number,
): string {
  const lines: string[] = [];
  if (!parsed) lines.push("No parsed states in this catalog. Run uninvent scan.", "");
  for (const component of components) lines.push(renderTextComponent(component), "");
  lines.push(footer(documented, missing));
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function renderTextComponent(component: CoverageComponent): string {
  const lines = [`${component.name}  ${component.file}`];
  if (component.rows.length === 0) {
    lines.push(component.hasStories ? "  no documented states" : "  no stories");
    return lines.join("\n");
  }
  for (const row of component.rows) {
    const stories = row.stories.length > 0 ? row.stories.join(", ") : "—";
    lines.push(`  ${row.label}  ${stories}${row.nameOnly ? " (name only)" : ""}`);
  }
  return lines.join("\n");
}

function renderMarkdown(
  components: CoverageComponent[],
  parsed: boolean,
  documented: number,
  missing: number,
): string {
  const lines = ["## uninvent coverage", "", "Informational. Missing stories are not a failure.", ""];
  if (!parsed) lines.push("No parsed states in this catalog. Run `uninvent scan`.", "");
  for (const component of components) {
    lines.push(`### ${component.name}`, "", `\`${component.file}\``, "");
    if (component.rows.length === 0) {
      lines.push(component.hasStories ? "No documented states." : "No stories.", "");
      continue;
    }
    lines.push("| state | stories |", "| --- | --- |");
    for (const row of component.rows) {
      const stories = row.stories.length > 0 ? row.stories.join(", ") : "—";
      lines.push(`| ${row.label} | ${stories}${row.nameOnly ? " (name only)" : ""} |`);
    }
    lines.push("");
  }
  lines.push(footer(documented, missing), "");
  return `${lines.join("\n")}\n`;
}

function footer(documented: number, missing: number): string {
  return `${documented} documented. ${missing} without a story. Coverage is informational and does not fail the check.`;
}

function keyOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
