/** Small glob: `**`, `*`, and `?`. Enough for the default story and test ignores. */
export function globToRegExp(pattern: string): RegExp {
  let expression = "^";
  let index = 0;
  const source = pattern.replace(/\\/g, "/");
  while (index < source.length) {
    if (source.startsWith("**/", index)) {
      expression += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (source.startsWith("**", index)) {
      expression += ".*";
      index += 2;
      continue;
    }
    const char = source[index];
    if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else expression += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  expression += "$";
  return new RegExp(expression);
}

export function matchesIgnore(relativeFile: string, patterns: string[]): boolean {
  const file = relativeFile.replace(/\\/g, "/").replace(/^\.\//, "");
  return patterns.some((pattern) => globToRegExp(pattern).test(file));
}
