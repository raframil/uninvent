export const CATEGORY_ORDER = [
  "raw-control",
  "recipe",
  "documented-state",
  "name-collision",
  "clean",
] as const;

export type CatchKind = "raw" | "rebuilt" | "reinvented" | "export" | "silent";
export type Origin = "with-rule" | "held-out";

export interface CaseDef {
  id: string;
  file: string;
  category: string;
  origin: Origin;
  catch: CatchKind;
  note: string;
}

export interface CaseResult {
  id: string;
  file: string;
  category: string;
  origin: Origin;
  catch: CatchKind;
  note: string;
  /** True when the version did what this case asks. For clean cases, true means it stayed silent. */
  passed: boolean;
  /** True when a non-clean case produced the finding kind it asks for. Always false for clean cases. */
  caught: boolean;
  lines: string[];
}

export interface CategoryScore {
  caught: number;
  total: number;
  falsePositives: number;
  withRule: { caught: number; total: number; falsePositives: number };
  heldOut: { caught: number; total: number; falsePositives: number };
}

export interface DetectionScore {
  fingerprint: string;
  categories: Record<string, CategoryScore>;
  cases: CaseResult[];
}

export function findingLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function matchesCatch(kind: CatchKind, lines: string[]): boolean {
  if (kind === "silent") return lines.length === 0;
  if (kind === "raw") return lines.some((line) => line.startsWith("raw "));
  if (kind === "rebuilt") return lines.some((line) => line.startsWith("rebuilt "));
  if (kind === "reinvented") return lines.some((line) => line.startsWith("reinvented "));
  if (kind === "export") return lines.some((line) => line.startsWith("export "));
  return false;
}

export function scoreCase(spec: CaseDef, stdout: string): CaseResult {
  const lines = findingLines(stdout);
  const passed = matchesCatch(spec.catch, lines);
  const caught = spec.catch === "silent" ? false : passed;
  return {
    id: spec.id,
    file: spec.file,
    category: spec.category,
    origin: spec.origin,
    catch: spec.catch,
    note: spec.note,
    passed,
    caught,
    lines,
  };
}

export function scoreDetection(cases: CaseResult[]): DetectionScore {
  const categories: Record<string, CategoryScore> = {};
  const names = categoryNames(cases.map((entry) => entry.category));
  for (const name of names) {
    const group = cases.filter((entry) => entry.category === name);
    categories[name] = scoreGroup(group);
  }
  return {
    fingerprint: fingerprintOf(categories, names),
    categories,
    cases,
  };
}

export function categoryNames(found: string[]): string[] {
  const extras = [...new Set(found)].filter((name) => !CATEGORY_ORDER.includes(name as (typeof CATEGORY_ORDER)[number]));
  extras.sort();
  const known = CATEGORY_ORDER.filter((name) => found.includes(name));
  return [...known, ...extras];
}

function scoreGroup(group: CaseResult[]): CategoryScore {
  return {
    caught: group.filter((entry) => entry.caught).length,
    total: group.length,
    falsePositives: group.filter((entry) => entry.catch === "silent" && !entry.passed).length,
    withRule: originSlice(group, "with-rule"),
    heldOut: originSlice(group, "held-out"),
  };
}

function originSlice(group: CaseResult[], origin: Origin): { caught: number; total: number; falsePositives: number } {
  const slice = group.filter((entry) => entry.origin === origin);
  return {
    caught: slice.filter((entry) => entry.caught).length,
    total: slice.length,
    falsePositives: slice.filter((entry) => entry.catch === "silent" && !entry.passed).length,
  };
}

export function fingerprintOf(categories: Record<string, CategoryScore>, names: string[]): string {
  return names
    .map((name) => {
      const score = categories[name];
      if (!score) return `${name}:0/0`;
      if (name === "clean") return `clean-fp:${score.falsePositives}/${score.total}`;
      return `${name}:${score.caught}/${score.total}`;
    })
    .join(",");
}
