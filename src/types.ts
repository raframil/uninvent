import type { PathMapping } from "./paths.js";
import type { PrimitiveConfig, PrimitiveUse } from "./primitives.js";

export interface PropInfo {
  name: string;
  optional: boolean;
  type?: string;
}

export interface VariantGroup {
  name: string;
  options: string[];
  defaultValue?: string;
  /**
   * Class string for an option written as a string literal (`cva` / `tv`).
   * Absent on catalogs written before v0.3, and on options that were not literals.
   */
  classes?: Record<string, string>;
}

/** A literal arg or JSX prop a story sets. */
export interface StoryArg {
  name: string;
  /** `destructive`, `true`, `false`, or a number rendered as text. */
  value: string;
}

/** One parsed story attached to a single catalog component. */
export interface StoryDoc {
  file: string;
  /** CSF export name, or the MDX `<Story name>`. */
  name: string;
  args: StoryArg[];
}

/**
 * A state stories document for a component, cross-referenced with its props
 * and `cva()` / `tv()` variants. Absent on catalogs written before v0.3.
 */
export interface ComponentState {
  /**
   * Stable id. A variant option is `variant:destructive`.
   * A boolean prop is the prop name (`loading`).
   */
  id: string;
  /** Short label. Variant options use the option name; props use the prop name. */
  label: string;
  /** `story` is a name with no literal arg and no matching prop. `check` ignores it. */
  kind: "variant" | "prop" | "story";
  /** Story export names that document this state. */
  stories: string[];
  /** Variant group or prop the state sets, when that API is known. */
  prop?: string;
  /** Literal value (`destructive`, `true`). */
  value?: string;
}

export interface CatalogComponent {
  name: string;
  /** Project-relative posix path. */
  file: string;
  line: number;
  /** Specifier agents should paste. A package component uses the package name or a subpath. */
  importPath: string;
  /**
   * Other specifiers that also export this component (`@acme/ui` and `@acme/ui/button`).
   * Absent when `importPath` is the only one, and on catalogs written before package sources.
   */
  specifiers?: string[];
  props: PropInfo[];
  extends: string[];
  variants: VariantGroup[];
  /**
   * Headless primitives this component wraps.
   * `library` is an id from the primitive map (`base-ui`, `radix`, `react-aria`, `ark`, …)
   * or one declared in `uninvent.json`. `parts` lists the parts the component renders.
   */
  primitives: PrimitiveUse[];
  /** Intrinsic elements this component renders, when the source says so. */
  elements: string[];
  stories: string[];
  /**
   * Parsed stories. Absent on catalogs written before v0.3.
   * An empty array means scan ran and found no stories for this component.
   */
  storyDocs?: StoryDoc[];
  /**
   * Documented states. Absent on catalogs written before v0.3.
   * `check` stays silent about states when the field is missing.
   */
  states?: ComponentState[];
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
  /**
   * Design-system packages folded into this catalog.
   * Absent on catalogs written before package sources. Readers treat that as none.
   */
  packages?: CatalogPackage[];
  /**
   * States sources `scan` read. An empty array means scan looked and found none.
   * Absent on catalogs written before states sources. `coverage` then keeps the
   * older per-component report.
   */
  statesSources?: StatesSourceInfo[];
  /**
   * One line when scan saw a source it does not parse (Histoire Vue SFCs).
   * Absent when there is nothing to add.
   */
  statesNote?: string;
}

/** One states source that contributed files. `id` is `storybook`, `ladle`, `histoire`, `manifest`, `jsdoc`, or `glob`. */
export interface StatesSourceInfo {
  id: string;
  files: string[];
}

/** `uninvent.json` `states`. Every field is optional; omitted means auto-detect. */
export interface StatesSourceToggle {
  globs?: string[];
}

export interface StatesConfig {
  /** Extra files. `*.stories.*`, `*.story.*`, and `*.mdx` use the CSF parser. JSON uses the manifest parser. Other files are scanned for `@state` tags. */
  globs?: string[];
  /** Manifest path. `false` skips `uninvent.states.json`. */
  manifest?: string | false;
  storybook?: boolean | StatesSourceToggle;
  ladle?: boolean | StatesSourceToggle;
  histoire?: boolean | StatesSourceToggle;
  /** `@state` tags and front matter in component files. Default on. */
  jsdoc?: boolean | StatesSourceToggle;
}

/** One design-system package `scan` read. `dir` is project-relative and may start with `..`. */
export interface CatalogPackage {
  name: string;
  dir: string;
}

export interface Config {
  /** Local design-system directories. Empty means scan still searches the usual folders. */
  ui: string[];
  /**
   * Package names (`@acme/ui`) or paths to a package directory (`packages/ui`).
   * Absent in a config file means none.
   */
  packages: string[];
  ignore: string[];
  catalog: string;
  commitCatalog: boolean;
  /**
   * Extra primitive libraries, or extra packages and parts for a built-in id.
   * Absent in a config file means the built-in map only.
   */
  primitives: PrimitiveConfig[];
  /** States sources. Absent means Storybook, Ladle, Histoire, the manifest, and `@state` tags are auto-detected. */
  states?: StatesConfig;
}

export interface Finding {
  kind: "raw-element" | "name-collision" | "recipe" | "state";
  file: string;
  line: number;
  message: string;
  /** Short label, `ui/Button`, `@acme/ui Button`, or `ui/Button loading`. */
  suggestion: string;
  import: string;
  element?: string;
  name?: string;
  /** Recipe title, when `kind` is `recipe`. */
  recipe?: string;
  /** `loading` or `variant=destructive`, when `kind` is `state`. */
  state?: string;
}

export interface Reuse {
  name: string;
  file: string;
  line: number;
}

export const DEFAULT_IGNORE = [
  "**/*.stories.tsx",
  "**/*.stories.ts",
  "**/*.stories.jsx",
  "**/*.stories.js",
  "**/*.stories.mdx",
  "**/*.mdx",
  "**/*.story.tsx",
  "**/*.story.ts",
  "**/*.story.jsx",
  "**/*.story.js",
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
