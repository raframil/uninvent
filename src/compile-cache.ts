import * as moduleApi from "node:module";

/**
 * Persist V8's compile cache for modules loaded after this call.
 * The first hook in a process pays to compile them. Later hooks read the cache.
 * Node ignores this when `NODE_DISABLE_COMPILE_CACHE` is set, and older Node 20
 * builds simply do not have the function. Either way the hook still runs.
 */
export function enableCompileCache(): void {
  const enable = (moduleApi as { enableCompileCache?: (cacheDir?: string) => unknown }).enableCompileCache;
  if (typeof enable !== "function") return;
  try {
    enable();
  } catch {
    // The cache is a speedup, not a dependency.
  }
}

export function flushCompileCache(): void {
  const flush = (moduleApi as { flushCompileCache?: () => void }).flushCompileCache;
  if (typeof flush !== "function") return;
  try {
    flush();
  } catch {
    // Leaving the cache unflushed only makes the next run cold.
  }
}
