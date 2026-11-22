export interface ImportRef {
  local: string;
  imported: string;
  specifier: string;
}

export interface NameAt {
  name: string;
  line: number;
}

/** One JSX opening tag, in source order. Fragments are not included. */
export interface Opening {
  line: number;
  kind: "intrinsic" | "component" | "member";
  /** Component name, intrinsic tag, or the object of a member expression (`Dialog.Root` → `Dialog`). */
  name: string;
  role: string | null;
}

/**
 * Tree used by the documented-state check.
 * JSX inside attributes is not a child here.
 * A member expression (`Dialog.Root`) is a fragment: the state check does not treat it as a component.
 */
export interface StateNode {
  name: string;
  kind: "intrinsic" | "component" | "fragment";
  line: number;
  attrs: Array<{ name: string; literal?: string }>;
  classTokens: string[];
  children: StateNode[];
}

/**
 * Tree used by recipe matching.
 * JSX inside attributes is a child, and a member expression is a component named for its object.
 */
export interface RecipeNode {
  name: string;
  kind: "intrinsic" | "component" | "fragment";
  line: number;
  endLine: number;
  buttonRole: boolean;
  children: RecipeNode[];
}

export interface ParsedFile {
  imports: ImportRef[];
  /** PascalCase bindings in the top-level scope, including ones that are not exported. */
  defined: NameAt[];
  /** Names that are actually exported, which is what a collision checks. */
  exported: NameAt[];
  openings: Opening[];
  stateTree: StateNode[];
  recipeTree: RecipeNode[];
}
