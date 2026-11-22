import { parseWithBabel } from "./babel.js";
import { parseFast } from "./fast.js";
import type { ParsedFile } from "./types.js";

/**
 * Parse one UI file.
 * The fast scanner covers ordinary TSX and returns null when it would have to guess.
 * Babel then parses that file, so the findings stay the same.
 */
export function parseUiSource(source: string, filename: string, snippet = false): ParsedFile | null {
  return parseOne(source, filename) ?? (snippet ? parseOne(wrapSnippet(source), filename) : null);
}

function parseOne(source: string, filename: string): ParsedFile | null {
  try {
    const fast = parseFast(source);
    if (fast) return fast;
  } catch {
    // A scanner bug must not change the check. Babel still knows this file.
  }
  return parseWithBabel(source, filename);
}

function wrapSnippet(source: string): string {
  return `export function __Snippet() {\nreturn (\n${source}\n);\n}\n`;
}
