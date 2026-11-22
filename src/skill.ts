import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importStatement, siblingsOf } from "./catalog.js";
import { formatPrimitives } from "./primitives.js";
import { conciseStates } from "./stories/states.js";
import type { Catalog, CatalogComponent, Recipe } from "./types.js";

export const SKILL_FILES = [
  ".claude/skills/uninvent/SKILL.md",
  ".cursor/skills/uninvent/SKILL.md",
  ".agents/skills/uninvent/SKILL.md",
];

export const GENERATED_MARK = "<!-- uninvent:generated -->";
const AGENTS_START = "<!-- uninvent:start -->";
const AGENTS_END = "<!-- uninvent:end -->";

export function renderSkill(catalog: Catalog): string {
  const names = catalog.components.map((component) => component.name);
  const recipes = declaredRecipes(catalog);
  const listed = names.slice(0, 12).join(", ");
  let description = listed.length > 0
    ? `Look up this project's design system before adding UI. Use when creating or editing screens, buttons, dialogs, inputs, tables, or any React component. Catalog includes ${listed}.`
    : "Look up this project's design system before adding UI. Use when creating or editing screens or React components.";
  if (recipes.length > 0) description += ` Recipes: ${recipes.slice(0, 4).map((recipe) => recipe.title).join(", ")}.`;
  const blocks = groupByFile(catalog).map((group) => renderGroup(group, catalog));
  const lines = [
    "---",
    "name: uninvent",
    `description: ${yamlQuote(description)}`,
    "---",
    "",
    GENERATED_MARK,
    "",
    "# uninvent",
    "",
    "This project already has a design system. Reuse it. Do not invent a parallel button, dialog, input, or screen primitive.",
    "",
    "Before creating UI, ask the catalog:",
    "",
    "```bash",
    "uninvent exists <Component>",
    ...(stateExample(catalog) ? [`uninvent exists "${stateExample(catalog)}"`] : []),
    "```",
    "",
    "After a screen is written, raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<dialog>`, or `<a role=\"button\">` is a miss when the catalog has that component. So is a new export whose name matches the catalog. The wrapper may be Radix, Base UI, or another library on the primitive adapter map; the miss is the raw element, not the library. The hook prints one short line per miss and nothing when the edit is clean. There is no autofix: change the code to the import it names.",
    "",
  ];
  if (recipes.length > 0) {
    lines.push(
      "A recipe is how this project assembles those components. Rebuilding it from raw elements is a miss. The hook names the recipe and the components it uses.",
      "",
    );
  }
  if (hasDocumentedStates(catalog)) {
    lines.push(
      "A documented state is a miss when new code rebuilds it. Pass `loading`, `disabled`, or the variant the catalog names instead of adding a spinner or copying that variant's classes.",
      "",
    );
  }
  const packageNames = (catalog.packages ?? []).map((pkg) => pkg.name);
  if (packageNames.length > 0) {
    lines.push(
      `Import packaged components from ${packageNames.map((name) => `\`${name}\``).join(", ")}. Do not copy them into the app.`,
      "",
    );
  }
  lines.push(
    "## Catalog",
    "",
    blocks.length > 0 ? blocks.join("\n\n") : "No components scanned yet. Run `uninvent scan`.",
    "",
  );
  const recipeBlock = renderRecipes(recipes);
  if (recipeBlock) lines.push(recipeBlock, "");
  return lines.join("\n");
}

export function renderAgentsBlock(catalog: Catalog): string {
  const names = catalog.components.map((component) => component.name);
  const list = names.length > 0 ? names.join(", ") : "(empty — run uninvent scan)";
  const recipes = declaredRecipes(catalog);
  const lines = [
    AGENTS_START,
    "## Design system",
    "",
    "Reuse the local design system. Before adding UI, run `uninvent exists <Component>`. Do not leave a raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<dialog>`, or `<a role=\"button\">` in place when the catalog has a component for it.",
    "",
    `Catalog: ${list}.`,
  ];
  const packageNames = (catalog.packages ?? []).map((pkg) => pkg.name);
  if (packageNames.length > 0) lines.push("", `Packages: ${packageNames.join(", ")}.`);
  if (recipes.length > 0) {
    const recipeList = recipes.map((recipe) => `${recipe.title} (${recipe.uses.join(", ")})`).join("; ");
    lines.push("", `Recipes: ${recipeList}.`);
  }
  const states = statesSummary(catalog);
  if (states) lines.push("", states);
  lines.push(AGENTS_END);
  return lines.join("\n");
}

export function writeSkills(root: string, catalog: Catalog, force = false): string[] {
  const skill = renderSkill(catalog);
  const written: string[] = [];
  for (const relative of SKILL_FILES) {
    const file = path.join(root, relative);
    if (existsSync(file) && !force) {
      const current = readFileSync(file, "utf8");
      if (!current.includes(GENERATED_MARK)) continue;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, skill);
    written.push(relative);
  }
  const agents = upsertAgents(root, renderAgentsBlock(catalog));
  if (agents) written.push(agents);
  return written;
}

export function skillsInstalled(root: string): boolean {
  return SKILL_FILES.some((relative) => existsSync(path.join(root, relative)));
}

function upsertAgents(root: string, block: string): string | null {
  const file = path.join(root, "AGENTS.md");
  if (!existsSync(file)) {
    writeFileSync(file, `${block}\n`);
    return "AGENTS.md";
  }
  const current = readFileSync(file, "utf8");
  const start = current.indexOf(AGENTS_START);
  const end = current.indexOf(AGENTS_END);
  let next: string;
  if (start !== -1 && end !== -1 && end > start) {
    next = `${current.slice(0, start)}${block}${current.slice(end + AGENTS_END.length)}`;
  } else {
    const separator = current.endsWith("\n") ? "\n" : "\n\n";
    next = `${current}${separator}${block}\n`;
  }
  if (next !== current) {
    writeFileSync(file, next);
    return "AGENTS.md";
  }
  return null;
}

function hasDocumentedStates(catalog: Catalog): boolean {
  return catalog.components.some((component) => (component.states ?? []).some((state) => state.kind !== "story"));
}

function stateExample(catalog: Catalog): string | null {
  const preferred = ["loading", "disabled", "invalid", "empty", "error"];
  for (const name of preferred) {
    const component = catalog.components.find((entry) =>
      (entry.states ?? []).some((state) => state.kind === "prop" && state.prop === name),
    );
    if (component) return `${name} ${component.name.toLowerCase()}`;
  }
  for (const component of catalog.components) {
    const label = conciseStates(component, 1)[0];
    if (!label) continue;
    const word = label.includes("=") ? label.split("=")[1] ?? label : label;
    return `${word} ${component.name.toLowerCase()}`;
  }
  return null;
}

function statesSummary(catalog: Catalog): string | null {
  const parts: string[] = [];
  for (const component of catalog.components) {
    const labels = conciseStates(component);
    if (labels.length === 0) continue;
    parts.push(`${component.name} (${labels.join(", ")})`);
    if (parts.length >= 8) break;
  }
  if (parts.length === 0) return null;
  return `States: ${parts.join("; ")}.`;
}

function declaredRecipes(catalog: Catalog): Recipe[] {
  return (catalog.recipes ?? []).filter((recipe) => recipe.source === "declared");
}

function renderRecipes(recipes: Recipe[]): string {
  if (recipes.length === 0) return "";
  const lines = [
    "## Recipes",
    "",
    "Prefer a recipe over assembling the same UI from raw elements.",
    "",
  ];
  for (const recipe of recipes) {
    const summary = recipe.summary ? `${recipe.summary} ` : "";
    lines.push(`- **${recipe.title}** — ${summary}Uses ${recipe.uses.join(", ")}.`);
  }
  lines.push("", "Run `uninvent exists \"<recipe>\"` for the imports and the example.");
  return lines.join("\n");
}

function groupByFile(catalog: Catalog): CatalogComponent[][] {
  const groups: CatalogComponent[][] = [];
  for (const component of catalog.components) {
    const last = groups[groups.length - 1];
    if (last?.[0]?.file === component.file) last.push(component);
    else groups.push([component]);
  }
  return groups;
}

function renderGroup(group: CatalogComponent[], catalog: Catalog): string {
  const primary = group[0];
  if (!primary) return "";
  const lines = [`### ${primary.file}`, "", `\`${importStatement(primary, catalog)}\``];
  if (primary.primitives.length > 0) lines.push(`primitives: ${formatPrimitives(primary.primitives)}`);
  for (const component of siblingsOf(primary, catalog)) {
    const details: string[] = [];
    if (component.props.length > 0) {
      details.push(`props: ${component.props.map((prop) => prop.name).join(", ")}`);
    }
    if (component.variants.length > 0) {
      const variants = component.variants
        .map((variant) => `${variant.name} (${variant.options.join(" | ")})`)
        .join(", ");
      details.push(`variants: ${variants}`);
    }
    if (component.elements.length > 0) details.push(`renders <${component.elements.join(">, <")}>`);
    const states = conciseStates(component);
    if (states.length > 0) details.push(`states: ${states.join(", ")}`);
    lines.push(`- ${component.name}${details.length > 0 ? ` — ${details.join("; ")}` : ""}`);
  }
  return lines.join("\n");
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
