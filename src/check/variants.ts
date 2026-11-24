import { isPackageSpecifier, importStatement, suggestionLabel } from "../catalog.js";
import type { Catalog, CatalogComponent, Finding, VariantGroup } from "../types.js";
import { describeFinding } from "./format.js";

/**
 * Name a variant on a raw control only when one non-default option is the match.
 * A red class can select `destructive`. Small padding can select `sm`. An outline
 * border can select `outline`. Anything shared or generic stays off the line.
 * A reused component with a value the catalog does not list is a separate line.
 * A different className on a listed value is not.
 */

export interface VariantChoice {
  name: string;
  value: string;
}

const GENERIC_CLASS_TOKENS = new Set([
  "absolute",
  "appearance-none",
  "bg-background",
  "bg-transparent",
  "block",
  "border",
  "cursor-pointer",
  "flex",
  "font-medium",
  "font-normal",
  "font-semibold",
  "gap-1",
  "gap-2",
  "grid",
  "inline-block",
  "inline-flex",
  "items-center",
  "items-start",
  "justify-between",
  "justify-center",
  "outline-none",
  "relative",
  "rounded",
  "rounded-full",
  "rounded-lg",
  "rounded-md",
  "select-none",
  "shadow",
  "shadow-md",
  "shadow-sm",
  "text-base",
  "text-sm",
  "transition",
  "transition-all",
  "transition-colors",
  "w-full",
  "whitespace-nowrap",
]);

/** Words in a class token that point at an option name. `bg-red-600` is `red`. */
const PALETTES: Array<{ words: string[]; options: string[] }> = [
  { words: ["destructive", "danger", "red"], options: ["destructive", "danger"] },
  { words: ["warning", "amber", "yellow", "orange"], options: ["warning"] },
  { words: ["success", "green"], options: ["success"] },
  { words: ["info", "sky", "blue"], options: ["info"] },
  { words: ["secondary"], options: ["secondary"] },
  { words: ["ghost"], options: ["ghost"] },
  { words: ["primary"], options: ["primary"] },
];

const XS_TOKENS = new Set(["h-6", "h-7", "px-1", "px-1.5", "text-xs", "py-0.5"]);
const SM_TOKENS = new Set(["h-8", "h-9", "p-1", "p-1.5", "p-2", "px-2", "px-2.5", "px-3", "py-1", "py-1.5"]);
const LG_TOKENS = new Set(["h-11", "h-12", "h-14", "px-6", "px-8", "px-10", "py-3", "py-4", "text-lg", "text-xl"]);

const SIZE_NAMES = new Set([
  "2xl",
  "default",
  "extra-small",
  "icon",
  "large",
  "lg",
  "md",
  "medium",
  "sm",
  "small",
  "xl",
  "xs",
  "xsmall",
]);

/** Bad literal → option names it can stand in for. Used only for a value that is not listed. */
const VALUE_ALIASES: Record<string, string[]> = {
  danger: ["destructive", "danger"],
  destructive: ["destructive", "danger"],
  "extra-small": ["xs"],
  ghost: ["ghost"],
  icon: ["icon"],
  info: ["info"],
  large: ["lg", "large"],
  lg: ["lg", "large"],
  medium: ["md", "medium"],
  outline: ["outline", "outlined"],
  outlined: ["outline", "outlined"],
  primary: ["primary", "default"],
  red: ["destructive", "danger"],
  secondary: ["secondary"],
  sm: ["sm", "small"],
  small: ["sm", "small"],
  success: ["success"],
  warning: ["warning"],
  xs: ["xs"],
  xsmall: ["xs"],
};

const GROUP_RANK = ["variant", "tone", "intent", "color", "appearance", "size"];

export function suggestVariants(component: CatalogComponent, classTokens: string[]): VariantChoice[] {
  if (classTokens.length === 0 || component.variants.length === 0) return [];
  const tokens = new Set(classTokens);
  const groups = [...component.variants].sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
  );
  const choices: VariantChoice[] = [];
  for (const group of groups) {
    const value = matchGroup(group, tokens);
    if (!value) continue;
    choices.push({ name: group.name, value });
    if (choices.length >= 3) break;
  }
  return choices;
}

/**
 * The JSX an agent should paste when at least one variant is known.
 * A package keeps its specifier. A local component is the tag alone.
 * No choice keeps the existing `ui/Button` label.
 */
export function usageSuggestion(
  component: CatalogComponent,
  catalog: Pick<Catalog, "components" | "paths">,
  choices: VariantChoice[],
): string {
  if (choices.length === 0) return suggestionLabel(component.name, catalog, component);
  const props = choices.map((choice) => `${choice.name}="${choice.value}"`).join(" ");
  const jsx = `<${component.name} ${props}>`;
  const prefix = packagePrefix(component, catalog);
  return prefix ? `${prefix} ${jsx}` : jsx;
}

export function findInvalidVariants(options: {
  file: string;
  line: number;
  component: CatalogComponent;
  catalog: Catalog;
  attrs: Array<{ name: string; literal?: string }>;
  withLine: boolean;
}): Finding[] {
  if (options.component.variants.length === 0) return [];
  const findings: Finding[] = [];
  for (const attr of options.attrs) {
    if (attr.literal === undefined) continue;
    const group = options.component.variants.find((entry) => entry.name === attr.name);
    if (!group || group.options.length === 0) continue;
    if (group.options.includes(attr.literal)) continue;
    const closest = closestOption(group, attr.literal);
    const choices = closest ? [{ name: group.name, value: closest }] : [];
    const finding: Finding = {
      kind: "invalid-variant",
      file: options.file,
      line: options.line,
      name: options.component.name,
      state: `${attr.name}="${attr.literal}"`,
      suggestion: usageSuggestion(options.component, options.catalog, choices),
      import: importStatement(options.component, options.catalog),
      message: "",
    };
    finding.message = describeFinding(finding, options.withLine);
    findings.push(finding);
  }
  return findings;
}

function closestOption(group: VariantGroup, value: string): string | null {
  const folded = group.options.filter((option) => option.toLowerCase() === value.toLowerCase());
  if (folded.length === 1 && folded[0] && folded[0] !== value) return folded[0];
  const aliases = VALUE_ALIASES[value.toLowerCase()];
  if (!aliases) return null;
  const hits = group.options.filter((option) => aliases.includes(option.toLowerCase()));
  return hits.length === 1 ? hits[0] ?? null : null;
}

function matchGroup(group: VariantGroup, tokens: Set<string>): string | null {
  if (isSizeGroup(group)) return matchSize(group, tokens);
  const colors = colorHits(group, tokens);
  if (colors === "ambiguous") return null;
  const hits = new Set<string>(colors);
  for (const option of outlineHits(group, tokens)) hits.add(option);
  for (const option of classHits(group, tokens)) hits.add(option);
  return only(hits, group.defaultValue);
}

function matchSize(group: VariantGroup, tokens: Set<string>): string | null {
  const defaults = new Set(splitClasses(group.classes?.[group.defaultValue ?? ""] ?? ""));
  const evidence = new Set([...tokens].filter((token) => !defaults.has(token)));
  const band = sizeBand(evidence);
  if (band === "conflict") return null;
  const hits = new Set<string>();
  if (band !== "none") {
    const option = resolveBand(group, band);
    if (!option) return null;
    hits.add(option);
  }
  for (const option of classHits(group, tokens)) hits.add(option);
  return only(hits, group.defaultValue);
}

function colorHits(group: VariantGroup, tokens: Set<string>): string[] | "ambiguous" {
  const words = wordsIn(tokens);
  const hits: string[] = [];
  for (const palette of PALETTES) {
    if (!palette.words.some((word) => words.has(word))) continue;
    const options = palette.options.filter((name) => group.options.includes(name) && name !== group.defaultValue);
    if (options.length > 1) return "ambiguous";
    if (options.length === 1 && options[0]) hits.push(options[0]);
  }
  return hits;
}

function outlineHits(group: VariantGroup, tokens: Set<string>): string[] {
  const names = group.options.filter(
    (option) => (option === "outline" || option === "outlined") && option !== group.defaultValue,
  );
  if (names.length !== 1 || !names[0]) return [];
  return outlineSignal(tokens) ? [names[0]] : [];
}

function outlineSignal(tokens: Set<string>): boolean {
  for (const token of tokens) {
    if (token === "outline" || /^outline-[0-9]/.test(token) || token === "border-input") return true;
  }
  const bordered = [...tokens].some((token) => token === "border" || token.startsWith("border-"));
  const open = tokens.has("bg-transparent") || tokens.has("bg-background");
  if (!bordered || !open) return false;
  for (const token of tokens) {
    if (token.startsWith("bg-") && token !== "bg-transparent" && token !== "bg-background" && token !== "bg-inherit" && token !== "bg-current") {
      return false;
    }
  }
  return true;
}

/**
 * Every distinctive class of one option is present, and at least one is.
 * A token shared with another option, or a layout token, does not count.
 * A group with a non-literal option has no class evidence.
 */
function classHits(group: VariantGroup, tokens: Set<string>): string[] {
  if (!group.classes) return [];
  const byOption = new Map<string, string[]>();
  for (const option of group.options) {
    const value = group.classes[option];
    if (value === undefined) return [];
    byOption.set(option, splitClasses(value));
  }
  const hits: string[] = [];
  for (const option of group.options) {
    if (option === group.defaultValue) continue;
    const own = byOption.get(option) ?? [];
    const distinctive = own.filter((token) => {
      if (GENERIC_CLASS_TOKENS.has(token)) return false;
      for (const [other, list] of byOption) {
        if (other !== option && list.includes(token)) return false;
      }
      return true;
    });
    if (distinctive.length === 0) continue;
    if (distinctive.every((token) => tokens.has(token))) hits.push(option);
  }
  return hits;
}

type SizeBand = "xs" | "sm" | "lg" | "icon" | "none" | "conflict";

function sizeBand(tokens: Set<string>): SizeBand {
  if (isIcon(tokens)) return "icon";
  const hits: Array<"xs" | "sm" | "lg"> = [];
  if (hasAny(tokens, XS_TOKENS)) hits.push("xs");
  if (hasAny(tokens, SM_TOKENS)) hits.push("sm");
  if (hasAny(tokens, LG_TOKENS)) hits.push("lg");
  if (hits.length > 1) return "conflict";
  return hits[0] ?? "none";
}

function resolveBand(group: VariantGroup, band: Exclude<SizeBand, "none" | "conflict">): string | null {
  const names: Record<Exclude<SizeBand, "none" | "conflict">, string[]> = {
    xs: ["xs", "xsmall", "extra-small"],
    sm: ["sm", "small"],
    lg: ["lg", "large"],
    icon: ["icon"],
  };
  const direct = pickOption(group, names[band]);
  if (direct) return direct;
  if (band === "xs") return pickOption(group, ["sm", "small"]);
  if (band === "lg") return pickOption(group, ["xl"]);
  return null;
}

function pickOption(group: VariantGroup, names: string[]): string | null {
  const hits = names.flatMap((name) => {
    const option = group.options.find((entry) => entry.toLowerCase() === name);
    return option && option !== group.defaultValue ? [option] : [];
  });
  return hits.length === 1 ? hits[0] ?? null : null;
}

function isIcon(tokens: Set<string>): boolean {
  if (hasPadding(tokens)) return false;
  for (const token of tokens) {
    if (/^size-(?:[7-9]|1[0-2])$/.test(token)) return true;
  }
  let height: string | null = null;
  let width: string | null = null;
  for (const token of tokens) {
    const h = /^h-(\d+(?:\.\d+)?)$/.exec(token);
    const w = /^w-(\d+(?:\.\d+)?)$/.exec(token);
    if (h?.[1]) height = h[1];
    if (w?.[1]) width = w[1];
  }
  return Boolean(height && height === width);
}

function hasPadding(tokens: Set<string>): boolean {
  for (const token of tokens) {
    if (token.startsWith("px-") || token.startsWith("py-") || /^p-\d/.test(token)) return true;
  }
  return false;
}

function hasAny(tokens: Set<string>, wanted: Set<string>): boolean {
  for (const token of tokens) {
    if (wanted.has(token)) return true;
  }
  return false;
}

function isSizeGroup(group: VariantGroup): boolean {
  if (group.name === "size") return true;
  return group.options.length > 0 && group.options.every((option) => SIZE_NAMES.has(option.toLowerCase()));
}

function wordsIn(tokens: Set<string>): Set<string> {
  const words = new Set<string>();
  for (const token of tokens) {
    const skipOutline = token.includes("outline-none") || token.includes("outline-offset");
    for (const part of token.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!part) continue;
      if (skipOutline && part === "outline") continue;
      words.add(part);
    }
  }
  return words;
}

function only(hits: Set<string>, defaultValue: string | undefined): string | null {
  if (hits.size !== 1) return null;
  const option = [...hits][0];
  if (!option || option === defaultValue) return null;
  return option;
}

function packagePrefix(
  component: CatalogComponent,
  catalog: Pick<Catalog, "components" | "paths">,
): string | null {
  if (!isPackageSpecifier(component.importPath, catalog.paths ?? [])) return null;
  const label = suggestionLabel(component.name, catalog, component);
  const suffix = ` ${component.name}`;
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
}

function rank(name: string): number {
  const index = GROUP_RANK.indexOf(name);
  return index === -1 ? GROUP_RANK.length : index;
}

function splitClasses(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}
