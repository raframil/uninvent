/**
 * Headless libraries a design-system file might wrap.
 * The built-in list is data. `uninvent.json` `primitives` adds a library or
 * extends one: extra package specifiers and part names. `check` does not branch
 * on these ids. A raw `<button>` is a miss when the catalog has `Button`.
 */
export interface PrimitiveLibrary {
  /** Stable id stored on the catalog, e.g. `radix`, `base-ui`. */
  library: string;
  /**
   * Import specifiers. Each entry matches that specifier and its subpaths,
   * so `@base-ui/react` also matches `@base-ui/react/button`. A `/*` suffix
   * is the same rule.
   */
  packages: string[];
  /**
   * Part name (`Button`, `Dialog.Popup`) to the intrinsic elements it stands
   * in for. An empty list means the part is recognized and is not a raw control.
   */
  parts: Record<string, string[]>;
}

export interface PrimitiveUse {
  library: string;
  /** The import specifier as written, e.g. `@base-ui/react/button`. */
  package: string;
  /** Parts this component renders, e.g. `Button`, `Dialog.Popup`. */
  parts?: string[];
}

/** A library declared in `uninvent.json`. */
export interface PrimitiveConfig {
  library: string;
  packages: string[];
  parts?: Record<string, string[]>;
}

function control(entries: Record<string, string>): Record<string, string[]> {
  const parts: Record<string, string[]> = {};
  for (const [name, element] of Object.entries(entries)) parts[name] = [element];
  return parts;
}

function members(family: string, names: string[], element: string): Record<string, string[]> {
  const parts: Record<string, string[]> = {};
  for (const name of names) parts[`${family}.${name}`] = [element];
  return parts;
}

/**
 * Built-in libraries. shadcn/ui new projects use Base UI (`@base-ui/react`);
 * Radix remains supported, including the `radix-ui` bundle. Neither is assumed
 * when a file is scanned: the import specifier picks the library.
 */
export const BUILTIN_LIBRARIES: readonly PrimitiveLibrary[] = [
  {
    library: "radix",
    packages: ["@radix-ui", "radix-ui"],
    parts: {
      Slot: [],
      ...members("Dialog", ["Root", "Content"], "dialog"),
      ...members("Select", ["Root"], "select"),
    },
  },
  {
    library: "base-ui",
    packages: ["@base-ui/react", "@base-ui-components/react"],
    parts: {
      ...control({ Button: "button", Input: "input" }),
      ...members("Dialog", ["Root", "Popup", "Content"], "dialog"),
      ...members("Select", ["Root"], "select"),
    },
  },
  {
    library: "react-aria",
    packages: ["react-aria", "react-aria-components", "@react-aria"],
    parts: control({
      Button: "button",
      Input: "input",
      TextArea: "textarea",
      TextField: "input",
      Dialog: "dialog",
      Select: "select",
    }),
  },
  {
    library: "ark",
    packages: ["@ark-ui/react"],
    parts: {
      ...members("Dialog", ["Root", "Content"], "dialog"),
      ...members("Select", ["Root"], "select"),
    },
  },
  {
    library: "headless-ui",
    packages: ["@headlessui/react"],
    parts: control({ Button: "button", Dialog: "dialog", DialogPanel: "dialog" }),
  },
  {
    library: "mantine",
    packages: ["@mantine/core"],
    parts: control({
      Button: "button",
      Input: "input",
      TextInput: "input",
      Textarea: "textarea",
      Select: "select",
      NativeSelect: "select",
      Modal: "dialog",
      Dialog: "dialog",
    }),
  },
  {
    library: "chakra",
    packages: ["@chakra-ui/react"],
    parts: control({
      Button: "button",
      Input: "input",
      Textarea: "textarea",
      Select: "select",
      Modal: "dialog",
      Dialog: "dialog",
    }),
  },
];

export function resolveLibraries(configured: PrimitiveConfig[] = []): PrimitiveLibrary[] {
  const libraries = BUILTIN_LIBRARIES.map((library) => ({
    library: library.library,
    packages: [...library.packages],
    parts: { ...library.parts },
  }));
  for (const entry of configured) {
    const existing = libraries.find((library) => library.library === entry.library);
    if (!existing) {
      libraries.push({
        library: entry.library,
        packages: [...entry.packages],
        parts: { ...(entry.parts ?? {}) },
      });
      continue;
    }
    for (const name of entry.packages) {
      if (!existing.packages.includes(name)) existing.packages.push(name);
    }
    Object.assign(existing.parts, entry.parts ?? {});
  }
  return libraries;
}

export function matchPrimitive(specifier: string, libraries: readonly PrimitiveLibrary[] = BUILTIN_LIBRARIES): PrimitiveUse | null {
  for (const library of libraries) {
    if (!library.packages.some((name) => packageMatches(specifier, name))) continue;
    return { library: library.library, package: specifier };
  }
  return null;
}

export function packageMatches(specifier: string, pattern: string): boolean {
  const root = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
  return specifier === root || specifier.startsWith(`${root}/`);
}

/**
 * Keys to try, most specific first. `DialogPrimitive.Popup` imported as
 * `Dialog` from `@base-ui/react/dialog` is `Dialog.Popup`, then `Popup`.
 */
export function partKeys(family: string, member: string | null): string[] {
  if (member) return [`${family}.${member}`, member];
  return family ? [family] : [];
}

export function lookupPart(
  libraries: readonly PrimitiveLibrary[],
  libraryId: string,
  keys: string[],
): { part: string; elements: string[] } | null {
  const library = libraries.find((entry) => entry.library === libraryId);
  if (!library || keys.length === 0) return null;
  const mapped = keys.find((key) => Object.prototype.hasOwnProperty.call(library.parts, key));
  const part = mapped ?? keys[0];
  if (!part) return null;
  return { part, elements: mapped ? [...(library.parts[mapped] ?? [])] : [] };
}

/** `dialog` from `@base-ui/react/dialog` or `@radix-ui/react-dialog`. */
export function familyFromSpecifier(specifier: string): string {
  const leaf = specifier.split("/").pop() ?? "";
  const bare = leaf.replace(/^react-/, "");
  if (!bare || bare === "react" || bare.includes("components")) return "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bare)) return "";
  return bare
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function formatPrimitives(primitives: PrimitiveUse[]): string {
  return primitives.map((entry) => `${entry.library} (${entry.package})`).join(", ");
}
