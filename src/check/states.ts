import { importStatement, suggestionLabel } from "../catalog.js";
import { parseUiSource } from "../parse/file.js";
import type { ImportRef } from "../parse/types.js";
import { resolveSpecifier, stripExt } from "../paths.js";
import type { Catalog, CatalogComponent, Finding, VariantGroup } from "../types.js";
import { describeFinding } from "./format.js";

/**
 * Flag a documented state only when the new code clearly rebuilds it.
 *
 * - A spinner inside or directly beside a catalog component that stories
 *   document as `loading` (or `pending` / `busy`), when that prop is not passed.
 * - A `className` that contains every class of one non-default variant option
 *   stories document, when that variant prop is not passed and the classes
 *   are not shared with another option.
 * - `opacity-50` together with `pointer-events-none`, or `aria-disabled`,
 *   on a component whose stories document `disabled`, when `disabled` is not passed.
 *
 * A catalog written before v0.3 has no `states` field. This stays silent.
 * A spinner that is itself a catalog component is reuse, not a finding.
 */

const LOADING_PROPS = new Set(["loading", "pending", "busy", "isLoading", "isPending", "isBusy"]);

const GENERIC_CLASS_TOKENS = new Set([
  "bg-background",
  "bg-muted",
  "block",
  "border",
  "border-border",
  "cursor-pointer",
  "flex",
  "font-medium",
  "font-normal",
  "font-semibold",
  "gap-2",
  "grid",
  "h-10",
  "h-8",
  "h-9",
  "hidden",
  "inline-block",
  "inline-flex",
  "items-center",
  "items-start",
  "justify-between",
  "justify-center",
  "opacity-50",
  "p-2",
  "p-4",
  "pointer-events-none",
  "px-2",
  "px-3",
  "px-4",
  "py-1",
  "py-2",
  "rounded",
  "rounded-full",
  "rounded-lg",
  "rounded-md",
  "shadow",
  "shadow-sm",
  "text-base",
  "text-foreground",
  "text-lg",
  "text-muted-foreground",
  "text-sm",
  "text-xs",
  "transition-colors",
  "w-10",
  "w-full",
  "whitespace-nowrap",
]);

interface Attr {
  name: string;
  literal?: string;
}

interface UiNode {
  name: string;
  kind: "intrinsic" | "component" | "fragment";
  line: number;
  attrs: Attr[];
  classTokens: string[];
  children: UiNode[];
}

export function findStateFindings(options: {
  source: string;
  file: string;
  catalog: Catalog;
  lines?: Set<number>;
  snippet?: boolean;
  withLine?: boolean;
}): Finding[] {
  if (!options.catalog.components.some((component) => component.states)) return [];
  const parsed = parseUiSource(options.source, options.file, Boolean(options.snippet));
  if (!parsed) return [];
  const imported = importedComponents(parsed.imports, options.file, options.catalog);
  if (imported.size === 0) return [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (finding: Finding | null): void => {
    if (!finding) return;
    const key = `${finding.line}:${finding.state}:${finding.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  walkPairs(parsed.stateTree, (node) => {
    const component = node.kind === "component" ? imported.get(node.name) : undefined;
    if (!component?.states) return;
    add(loadingInside(node, component, options, imported));
    add(variantFinding(node, component, options));
    add(disabledFinding(node, component, options));
  });
  walkPairs(parsed.stateTree, (node) => {
    for (const child of node.children) {
      if (!isSpinner(child, imported)) continue;
      const host = nearestLoadingHost(node, child, imported);
      if (!host) continue;
      const line = pickLine(host.node.line, child.line, options.lines);
      if (line === null) continue;
      add(stateFinding({
        file: options.file,
        line,
        component: host.component,
        catalog: options.catalog,
        state: host.prop,
        suggestion: `${suggestionLabel(host.component.name)} ${host.prop}`,
        withLine: options.withLine !== false,
      }));
    }
  });
  return findings;
}

function loadingInside(
  node: UiNode,
  component: CatalogComponent,
  options: { file: string; catalog: Catalog; lines?: Set<number>; withLine?: boolean },
  imported: Map<string, CatalogComponent>,
): Finding | null {
  const prop = loadingProp(component);
  if (!prop || hasAttr(node, prop)) return null;
  const evidence = descendantSpinner(node, imported);
  if (!evidence) return null;
  const line = pickLine(node.line, evidence.line, options.lines);
  if (line === null) return null;
  return stateFinding({
    file: options.file,
    line,
    component,
    catalog: options.catalog,
    state: prop,
    suggestion: `${suggestionLabel(component.name)} ${prop}`,
    withLine: options.withLine !== false,
  });
}

function loadingProp(component: CatalogComponent | undefined): string | null {
  const state = component?.states?.find((entry) => entry.kind === "prop" && entry.prop && LOADING_PROPS.has(entry.prop));
  return state?.prop ?? null;
}

function nearestLoadingHost(
  parent: UiNode,
  spinner: UiNode,
  imported: Map<string, CatalogComponent>,
): { node: UiNode; component: CatalogComponent; prop: string } | null {
  const index = parent.children.indexOf(spinner);
  if (index === -1) return null;
  let best: { node: UiNode; component: CatalogComponent; prop: string; distance: number } | null = null;
  let tie = false;
  for (let childIndex = 0; childIndex < parent.children.length; childIndex += 1) {
    const child = parent.children[childIndex];
    if (!child || child === spinner || child.kind !== "component") continue;
    const component = imported.get(child.name);
    const prop = loadingProp(component);
    if (!component || !prop || hasAttr(child, prop)) continue;
    const distance = Math.abs(childIndex - index);
    if (!best || distance < best.distance) {
      best = { node: child, component, prop, distance };
      tie = false;
    } else if (distance === best.distance) {
      tie = true;
    }
  }
  if (!best || tie) return null;
  return best;
}

function variantFinding(
  node: UiNode,
  component: CatalogComponent,
  options: { file: string; catalog: Catalog; lines?: Set<number>; withLine?: boolean },
): Finding | null {
  if (!component.states || node.classTokens.length === 0) return null;
  const matches: { group: VariantGroup; option: string }[] = [];
  for (const group of component.variants) {
    if (hasAttr(node, group.name)) continue;
    const classes = classesFor(group);
    if (!classes) continue;
    for (const option of group.options) {
      if (option === group.defaultValue) continue;
      const documented = component.states.some(
        (state) => state.kind === "variant" && state.prop === group.name && state.value === option,
      );
      if (!documented) continue;
      const tokens = classes.get(option) ?? [];
      if (tokens.length === 0 || !tokens.every((token) => node.classTokens.includes(token))) continue;
      if (!tokens.some((token) => isDistinctive(token, option, classes))) continue;
      matches.push({ group, option });
    }
  }
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match) return null;
  const line = pickLine(node.line, node.line, options.lines);
  if (line === null) return null;
  const prop = `${match.group.name}="${match.option}"`;
  return stateFinding({
    file: options.file,
    line,
    component,
    catalog: options.catalog,
    state: `${match.group.name}=${match.option}`,
    suggestion: `${suggestionLabel(component.name)} ${prop}`,
    withLine: options.withLine !== false,
  });
}

function disabledFinding(
  node: UiNode,
  component: CatalogComponent,
  options: { file: string; catalog: Catalog; lines?: Set<number>; withLine?: boolean },
): Finding | null {
  const state = component.states?.find((entry) => entry.kind === "prop" && entry.prop === "disabled");
  if (!state) return null;
  if (hasAttr(node, "disabled")) return null;
  const muted = node.classTokens.includes("opacity-50") && node.classTokens.includes("pointer-events-none");
  const aria = node.attrs.find((attr) => attr.name === "aria-disabled")?.literal;
  if (!muted && aria !== "true") return null;
  const line = pickLine(node.line, node.line, options.lines);
  if (line === null) return null;
  return stateFinding({
    file: options.file,
    line,
    component,
    catalog: options.catalog,
    state: "disabled",
    suggestion: `${suggestionLabel(component.name)} disabled`,
    withLine: options.withLine !== false,
  });
}

function stateFinding(options: {
  file: string;
  line: number;
  component: CatalogComponent;
  catalog: Catalog;
  state: string;
  suggestion: string;
  withLine: boolean;
}): Finding {
  const finding: Finding = {
    kind: "state",
    file: options.file,
    line: options.line,
    name: options.component.name,
    state: options.state,
    suggestion: options.suggestion,
    import: importStatement(options.component, options.catalog),
    message: "",
  };
  finding.message = describeFinding(finding, options.withLine);
  return finding;
}

function classesFor(group: VariantGroup): Map<string, string[]> | null {
  if (!group.classes) return null;
  const map = new Map<string, string[]>();
  for (const option of group.options) {
    const value = group.classes[option];
    if (value === undefined) return null;
    map.set(option, splitClasses(value));
  }
  return map;
}

function isDistinctive(token: string, option: string, classes: Map<string, string[]>): boolean {
  if (GENERIC_CLASS_TOKENS.has(token)) return false;
  for (const [other, tokens] of classes) {
    if (other !== option && tokens.includes(token)) return false;
  }
  return true;
}

function descendantSpinner(node: UiNode, imported: Map<string, CatalogComponent>): UiNode | null {
  for (const child of node.children) {
    if (isSpinner(child, imported)) return child;
    const nested = descendantSpinner(child, imported);
    if (nested) return nested;
  }
  return null;
}

function isSpinner(node: UiNode, imported: Map<string, CatalogComponent>): boolean {
  if (node.kind === "component" && imported.has(node.name)) return false;
  if (node.classTokens.includes("animate-spin")) return true;
  if (node.kind !== "component") return false;
  if (/(Page|Layout|Screen|Route|View|Table|List)/.test(node.name)) return false;
  return /Spinner|Loader/.test(node.name);
}

function walkPairs(nodes: UiNode[], visit: (node: UiNode, parent: UiNode | null) => void, parent: UiNode | null = null): void {
  for (const node of nodes) {
    visit(node, parent);
    walkPairs(node.children, visit, node);
  }
}

function hasAttr(node: UiNode, name: string): boolean {
  return node.attrs.some((attr) => attr.name === name);
}

function pickLine(elementLine: number, evidenceLine: number, lines: Set<number> | undefined): number | null {
  if (!lines) return evidenceLine;
  if (lines.has(evidenceLine)) return evidenceLine;
  if (lines.has(elementLine)) return elementLine;
  return null;
}

function importedComponents(specs: ImportRef[], file: string, catalog: Catalog): Map<string, CatalogComponent> {
  const imported = new Map<string, CatalogComponent>();
  for (const spec of specs) {
    const resolved = resolveSpecifier(file, spec.specifier, catalog.paths);
    if (!resolved) continue;
    const component = catalog.components.find(
      (entry) => stripExt(entry.file) === resolved && entry.name === spec.imported,
    );
    if (component) imported.set(spec.local, component);
  }
  return imported;
}

function splitClasses(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}
