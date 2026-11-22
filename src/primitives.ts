/**
 * Headless libraries a design-system file might wrap.
 * Add a library by appending one entry: `check` does not branch on these ids.
 * A raw `<button>` is a miss when the catalog has `Button`, whichever library that wrapper uses.
 */
export interface PrimitiveAdapter {
  /** Stable id stored on the catalog, e.g. `radix`, `base-ui`. */
  library: string;
  /** Import specifiers that belong to this library, including subpaths. */
  test: (specifier: string) => boolean;
}

export interface PrimitiveUse {
  library: string;
  /** The import specifier as written, e.g. `@base-ui/react/button`. */
  package: string;
}

export const PRIMITIVE_ADAPTERS: PrimitiveAdapter[] = [
  {
    library: "radix",
    test: (specifier) => specifier === "@radix-ui" || specifier.startsWith("@radix-ui/"),
  },
  {
    library: "base-ui",
    test: (specifier) =>
      specifier === "@base-ui/react" ||
      specifier.startsWith("@base-ui/react/") ||
      specifier === "@base-ui-components/react" ||
      specifier.startsWith("@base-ui-components/react/"),
  },
  {
    library: "react-aria",
    test: (specifier) =>
      specifier === "react-aria" ||
      specifier.startsWith("react-aria/") ||
      specifier === "react-aria-components" ||
      specifier.startsWith("react-aria-components/") ||
      specifier.startsWith("@react-aria/"),
  },
  {
    library: "ark",
    test: (specifier) => specifier === "@ark-ui/react" || specifier.startsWith("@ark-ui/react/"),
  },
];

export function matchPrimitive(specifier: string): PrimitiveUse | null {
  for (const adapter of PRIMITIVE_ADAPTERS) {
    if (adapter.test(specifier)) return { library: adapter.library, package: specifier };
  }
  return null;
}

export function formatPrimitives(primitives: PrimitiveUse[]): string {
  return primitives.map((entry) => `${entry.library} (${entry.package})`).join(", ");
}
