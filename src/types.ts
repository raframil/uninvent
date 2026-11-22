import type { PathMapping } from "./paths.js";
import type { PrimitiveUse } from "./primitives.js";

export interface PropInfo {
  name: string;
  optional: boolean;
  type?: string;
}

export interface VariantGroup {
  name: string;
  options: string[];
  defaultValue?: string;
}

export interface CatalogComponent {
  name: string;
  /** Project-relative posix path. */
  file: string;
  line: number;
  importPath: string;
  props: PropInfo[];
  extends: string[];
  variants: VariantGroup[];
  /**
   * Headless primitives imported by the file.
   * `library` is an adapter id (`radix`, `base-ui`, `react-aria`, `ark`).
   */
  primitives: PrimitiveUse[];
  /** Intrinsic elements this component renders, when the source says so. */
  elements: string[];
  stories: string[];
}

/**
 * A composition this project already uses: existing components assembled
 * into a common UI pattern. Declared recipes come from `uninvent.recipes.md`.
 * Detected recipes are repeated compositions scan noticed and will not flag.
 */
export interface Recipe {
  id: string;
  title: string;
  /** Phrases for `uninvent exists`, including the title. */
  intents: string[];
  /** Catalog component names the composition is built from. */
  uses: string[];
  summary: string;
  /** Example JSX from the recipe file. Omitted when the recipe has none. */
  example?: string;
  source: "declared" | "detected";
  /** Project-relative path of the recipe file. */
  file?: string;
  /** App files a detected composition was seen in. */
  seenIn?: string[];
}

export interface Catalog {
  version: 1;
  generatedAt: string;
  paths: PathMapping[];
  components: CatalogComponent[];
  tokens: string[];
  /**
   * Absent on v0.1 catalogs. Readers treat that as no recipes.
   */
  recipes?: Recipe[];
}

export interface Config {
  ui: string[];
  ignore: string[];
  catalog: string;
  commitCatalog: boolean;
}

export interface Finding {
  kind: "raw-element" | "name-collision" | "recipe";
  file: string;
  line: number;
  message: string;
  /** Short label, `ui/Button`, or `ui/Dialog + ui/Button` for a recipe. */
  suggestion: string;
  import: string;
  element?: string;
  name?: string;
  /** Recipe title, when `kind` is `recipe`. */
  recipe?: string;
}

export interface Reuse {
  name: string;
  file: string;
  line: number;
}

export const DEFAULT_IGNORE = [
  "**/*.stories.tsx",
  "**/*.stories.jsx",
  "**/*.test.tsx",
  "**/*.test.jsx",
  "**/*.spec.tsx",
  "**/*.spec.jsx",
];

export const DEFAULT_CATALOG = ".uninvent/catalog.json";

/**
 * Native elements v0.1 treats as a miss when the catalog has the named component.
 * Anything else (`div`, `span`, a plain link) is layout, not an invented control.
 */
export const RAW_ELEMENTS: Record<string, string> = {
  button: "Button",
  input: "Input",
  textarea: "Textarea",
  select: "Select",
  dialog: "Dialog",
};
