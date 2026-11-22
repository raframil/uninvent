import type { Finding, Reuse } from "../types.js";

export function describeFinding(finding: Finding, withLine = true): string {
  const at = withLine ? `${finding.file}:${finding.line}` : finding.file;
  if (finding.kind === "name-collision") {
    return `export ${finding.name} in ${at}, use ${finding.suggestion}`;
  }
  if (finding.kind === "recipe") {
    return `rebuilt ${finding.recipe ?? "recipe"} in ${at}, use ${finding.suggestion}`;
  }
  const element = finding.element === "a" ? "<a role=\"button\">" : `<${finding.element ?? "element"}>`;
  return `raw ${element} in ${at}, use ${finding.suggestion}`;
}

export function formatText(findings: Finding[]): string {
  if (findings.length === 0) return "";
  return `${findings.map((finding) => finding.message).join("\n")}\n`;
}

export function formatJson(findings: Finding[], reuses: Reuse[]): string {
  const reused = [...new Set(reuses.map((reuse) => reuse.name))].sort();
  return `${JSON.stringify(
    {
      reuse: reuses.length,
      invent: findings.length,
      findings,
      reused,
    },
    null,
    2,
  )}\n`;
}

export function formatMarkdown(findings: Finding[], reuses: Reuse[]): string {
  const reused = [...new Set(reuses.map((reuse) => reuse.name))].sort();
  const lines = [
    "## uninvent",
    "",
    `**reuse ${reuses.length} / invent ${findings.length}**`,
    "",
  ];
  if (findings.length === 0) {
    lines.push("Nothing reinvented.");
  } else {
    for (const finding of findings) {
      lines.push(`- ${markdownFinding(finding)}`);
    }
  }
  if (reused.length > 0) {
    const shown = reused.slice(0, 20);
    const extra = reused.length > shown.length ? `, and ${reused.length - shown.length} more` : "";
    lines.push("", `Reused: ${shown.join(", ")}${extra}`);
  }
  lines.push("");
  return lines.join("\n");
}

function markdownFinding(finding: Finding): string {
  if (finding.kind === "name-collision") {
    return `export \`${finding.name}\` in \`${finding.file}:${finding.line}\`, use \`${finding.suggestion}\``;
  }
  if (finding.kind === "recipe") {
    const parts = finding.suggestion.split(" + ").map((part) => `\`${part}\``).join(" + ");
    return `rebuilt \`${finding.recipe ?? "recipe"}\` in \`${finding.file}:${finding.line}\`, use ${parts}`;
  }
  const element = finding.element === "a" ? "<a role=\"button\">" : `<${finding.element}>`;
  return `raw \`${element}\` in \`${finding.file}:${finding.line}\`, use \`${finding.suggestion}\``;
}

export function formatReport(
  findings: Finding[],
  reuses: Reuse[],
  format: "text" | "json" | "markdown",
): string {
  if (format === "json") return formatJson(findings, reuses);
  if (format === "markdown") return formatMarkdown(findings, reuses);
  return formatText(findings);
}
