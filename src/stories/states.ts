import type { Catalog, CatalogComponent, ComponentState, StoryArg, StoryDoc } from "../types.js";

/**
 * Props that are content or DOM plumbing, not a visual state.
 * A story that only sets these does not document a state.
 */
const SKIP_ARGS = new Set([
  "asChild",
  "children",
  "className",
  "defaultValue",
  "htmlFor",
  "id",
  "key",
  "name",
  "placeholder",
  "ref",
  "style",
  "tabIndex",
  "type",
  "value",
]);

/** Story-name words that document a state even when the arg was not a literal. */
const STORY_NAME_STATES: Record<string, string> = {
  blank: "empty",
  busy: "busy",
  disabled: "disabled",
  empty: "empty",
  error: "error",
  inactive: "disabled",
  invalid: "invalid",
  isloading: "loading",
  loading: "loading",
  pending: "pending",
  readonly: "readOnly",
};

/** Query words that should hit a documented state with a different name. */
const QUERY_SYNONYMS: Record<string, string[]> = {
  blank: ["empty"],
  busy: ["busy", "loading", "pending"],
  disabled: ["disabled"],
  empty: ["empty"],
  error: ["error", "invalid"],
  inactive: ["disabled"],
  invalid: ["invalid", "error"],
  loading: ["loading", "pending", "busy"],
  pending: ["pending", "loading", "busy"],
  readonly: ["readonly"],
  spinner: ["loading", "pending", "busy"],
};

const NAME_STOP = new Set(["and", "story", "the", "with"]);

export function relevantArgs(args: StoryArg[]): StoryArg[] {
  return args.filter((arg) => !skipArg(arg.name)).slice(0, 16);
}

export function deriveStates(component: CatalogComponent, docs: StoryDoc[]): ComponentState[] {
  const map = new Map<string, ComponentState>();
  const propNames = new Set(component.props.map((prop) => prop.name));

  const add = (state: ComponentState): void => {
    const existing = map.get(state.id);
    if (!existing) {
      map.set(state.id, { ...state, stories: [...state.stories] });
      return;
    }
    for (const story of state.stories) {
      if (!existing.stories.includes(story)) existing.stories.push(story);
    }
    if (existing.kind === "story" && state.kind !== "story") {
      existing.kind = state.kind;
      existing.label = state.label;
      if (state.prop) existing.prop = state.prop;
      if (state.value) existing.value = state.value;
    }
  };

  for (const doc of docs) {
    for (const arg of doc.args) {
      if (skipArg(arg.name) || arg.value === "false") continue;
      const group = component.variants.find((variant) => variant.name === arg.name);
      if (group) {
        if (!group.options.includes(arg.value)) continue;
        add({
          id: `${group.name}:${arg.value}`,
          label: arg.value,
          kind: "variant",
          stories: [doc.name],
          prop: group.name,
          value: arg.value,
        });
        continue;
      }
      if (arg.value === "true") {
        add({
          id: arg.name,
          label: arg.name,
          kind: "prop",
          stories: [doc.name],
          prop: arg.name,
          value: "true",
        });
        continue;
      }
      if (propNames.has(arg.name) || storyProp(arg.name)) {
        add({
          id: `${arg.name}:${arg.value}`,
          label: `${arg.name}=${arg.value}`,
          kind: "prop",
          stories: [doc.name],
          prop: arg.name,
          value: arg.value,
        });
      }
    }

    for (const token of nameTokens(doc.name)) {
      let matched = false;
      for (const group of component.variants) {
        const option = group.options.find((entry) => keyOf(entry) === keyOf(token));
        if (!option) continue;
        matched = true;
        add({
          id: `${group.name}:${option}`,
          label: option,
          kind: "variant",
          stories: [doc.name],
          prop: group.name,
          value: option,
        });
      }
      const prop = component.props.find((entry) => keyOf(entry.name) === keyOf(token));
      if (prop) {
        matched = true;
        add({
          id: prop.name,
          label: prop.name,
          kind: "prop",
          stories: [doc.name],
          prop: prop.name,
          value: "true",
        });
      }
      if (matched) continue;
      const known = STORY_NAME_STATES[keyOf(token)];
      if (!known || map.has(known)) continue;
      const ownsProp = propNames.has(known);
      add({
        id: known,
        label: known,
        kind: ownsProp ? "prop" : "story",
        stories: [doc.name],
        ...(ownsProp ? { prop: known, value: "true" } : {}),
      });
    }
  }

  return [...map.values()].sort((a, b) => compareStates(a, b, component));
}

export function stateLabel(state: ComponentState): string {
  if (state.kind === "variant" && state.prop && state.value) return `${state.prop}=${state.value}`;
  return state.prop ?? state.label;
}

/** States worth putting in the skill: not the default variant, capped. */
export function conciseStates(component: CatalogComponent, limit = 4): string[] {
  const labels: string[] = [];
  for (const state of orderedStates(component)) {
    if (state.kind === "story") continue;
    if (state.kind === "variant" && state.prop && state.value) {
      const group = component.variants.find((variant) => variant.name === state.prop);
      if (group?.defaultValue === state.value) continue;
    }
    if (state.kind === "prop" && state.prop && !isStateLikeProp(state.prop)) continue;
    labels.push(stateLabel(state));
    if (labels.length >= limit) break;
  }
  return labels;
}

export interface StateQueryHit {
  component: CatalogComponent;
  states: ComponentState[];
  score: number;
}

/**
 * `loading button` hits Button's loading state.
 * A single component name does not: that stays on the component view.
 */
export function matchStateQuery(catalog: Catalog, query: string): StateQueryHit[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [];
  const hits: StateQueryHit[] = [];
  for (const component of catalog.components) {
    const exact = (component.states ?? []).filter((state) => tokens.some((token) => stateMatches(state, token, true)));
    const fuzzy = (component.states ?? []).filter((state) => tokens.some((token) => stateMatches(state, token, false)));
    const props = fuzzy.filter((state) => state.kind === "prop");
    const states = exact.length > 0 ? exact : props.length > 0 ? props : fuzzy;
    if (states.length === 0) continue;
    const name = keyOf(component.name);
    const named = tokens.some((token) => keyOf(token) === name);
    let score = 0;
    if (named) score = 100;
    else if (tokens.length === 1) score = 80;
    else if (tokens.every((token) => keyOf(token) === name || states.some((state) => stateMatches(state, token, false)))) {
      score = 70;
    }
    if (score < 70) continue;
    hits.push({ component, states, score });
  }
  hits.sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name));
  return hits;
}

export function isStateLikeProp(name: string): boolean {
  return storyProp(name) !== null || keyOf(name) in STORY_NAME_STATES;
}

function storyProp(name: string): string | null {
  return STORY_NAME_STATES[keyOf(name)] ?? null;
}

function stateMatches(state: ComponentState, token: string, exact: boolean): boolean {
  const key = keyOf(token);
  if (!key || NAME_STOP.has(key)) return false;
  const fields = [state.id, state.label, state.prop, state.value].filter((field): field is string => Boolean(field));
  if (fields.some((field) => keyOf(field) === key)) return true;
  if (exact) return false;
  const synonyms = QUERY_SYNONYMS[key] ?? [];
  return synonyms.some((synonym) => fields.some((field) => keyOf(field) === keyOf(synonym)));
}

function orderedStates(component: CatalogComponent): ComponentState[] {
  return [...(component.states ?? [])].sort((a, b) => compareStates(a, b, component));
}

function compareStates(a: ComponentState, b: ComponentState, component: CatalogComponent): number {
  const rank = (state: ComponentState) => (state.kind === "prop" ? 0 : state.kind === "variant" ? 1 : 2);
  const byKind = rank(a) - rank(b);
  if (byKind !== 0) return byKind;
  if (a.kind === "variant" && b.kind === "variant") {
    const groupOrder = (state: ComponentState) => {
      const index = component.variants.findIndex((variant) => variant.name === state.prop);
      return index === -1 ? 99 : index;
    };
    const byGroup = groupOrder(a) - groupOrder(b);
    if (byGroup !== 0) return byGroup;
    const options = component.variants.find((variant) => variant.name === a.prop)?.options ?? [];
    const optionOrder = (state: ComponentState) => {
      const index = options.indexOf(state.value ?? "");
      return index === -1 ? 99 : index;
    };
    const byOption = optionOrder(a) - optionOrder(b);
    if (byOption !== 0) return byOption;
  }
  return a.id.localeCompare(b.id);
}

function skipArg(name: string): boolean {
  if (SKIP_ARGS.has(name)) return true;
  return /^on[A-Z]/.test(name);
}

function nameTokens(name: string): string[] {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !NAME_STOP.has(word));
  const tokens = new Set<string>();
  const joined = words.join("");
  if (joined.length >= 3) tokens.add(joined);
  for (const word of words) {
    if (word.length >= 3) tokens.add(word);
  }
  return [...tokens];
}

function keyOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
