import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { installAgents, resolveAgents, uninstallAgents } from "../src/agent-install.js";
import { writeCatalog } from "../src/catalog.js";
import { runHook } from "../src/hook/run.js";
import { renderAgentsBlock } from "../src/skill.js";
import { buttonComponent, repoRoot, sampleCatalog, tempDir } from "./helpers.js";

const fixture = path.join(repoRoot, "tests/fixtures/agents");
const HOOK = "npx --no-install uninvent hook";

function project(): string {
  const root = tempDir();
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "uninvent.json"), readFileSync(path.join(fixture, "uninvent.json")));
  writeCatalog(root, ".uninvent/catalog.json", sampleCatalog([buttonComponent()]));
  return root;
}

function read(root: string, relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (relative === "uninvent.json" || relative === ".uninvent" || relative.startsWith(".uninvent/")) continue;
      if (entry.isDirectory()) walk(absolute);
      else out[relative] = readFileSync(absolute, "utf8");
    }
  };
  walk(root);
  return out;
}

test("default install stays Claude Code and Cursor", () => {
  const root = project();
  const lines = installAgents(root, resolveAgents([], root), false);
  assert.deepEqual(lines, [
    "Claude Code: PostToolUse hook in .claude/settings.json",
    "Cursor: postToolUse hook in .cursor/hooks.json",
  ]);
  assert.equal(existsSync(path.join(root, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(root, ".codex")), false);
  assert.equal(existsSync(path.join(root, ".github")), false);
  assert.equal(existsSync(path.join(root, ".windsurf")), false);
  assert.equal(existsSync(path.join(root, ".clinerules")), false);
  const claude = JSON.parse(read(root, ".claude/settings.json")) as { hooks: { PostToolUse: unknown[]; PreToolUse?: unknown } };
  assert.equal(claude.hooks.PreToolUse, undefined);
  assert.equal(JSON.stringify(claude).includes(HOOK), true);
});

test("a project marker adds that agent on a bare install", () => {
  const root = project();
  mkdirSync(path.join(root, ".codex"));
  assert.deepEqual(resolveAgents([], root), ["claude-code", "cursor", "codex"]);
  installAgents(root, resolveAgents([], root), false);
  assert.equal(existsSync(path.join(root, ".codex/hooks.json")), true);
  assert.equal(existsSync(path.join(root, ".github")), false);
});

test("each agent install is idempotent and updates the marked block", () => {
  const root = project();
  const agents = ["codex", "copilot", "windsurf", "cline", "agents"] as const;
  for (const agent of agents) {
    installAgents(root, [agent], false);
    const first = tree(root);
    installAgents(root, [agent], false);
    assert.deepEqual(tree(root), first, agent);
  }
  const block = renderAgentsBlock(sampleCatalog([buttonComponent()]));
  for (const relative of [
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".windsurf/rules/uninvent.md",
    ".clinerules/uninvent.md",
  ]) {
    const matches = read(root, relative).match(/<!-- uninvent:start -->/g) ?? [];
    assert.equal(matches.length, 1, relative);
    assert.equal(read(root, relative).includes(block), true, relative);
  }
  writeCatalog(root, ".uninvent/catalog.json", sampleCatalog([
    buttonComponent({ name: "Input", elements: ["input"] }),
  ]));
  installAgents(root, ["codex", "copilot", "windsurf", "cline", "agents"], false);
  const updated = renderAgentsBlock(sampleCatalog([buttonComponent({ name: "Input", elements: ["input"] })]));
  for (const relative of [
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".windsurf/rules/uninvent.md",
    ".clinerules/uninvent.md",
  ]) {
    const text = read(root, relative);
    assert.equal((text.match(/<!-- uninvent:start -->/g) ?? []).length, 1, relative);
    assert.equal(text.includes(updated), true, relative);
    assert.equal(text.includes("Catalog: Button."), false, relative);
  }
});

test("agent files match the snapshot and keep foreign config", () => {
  const root = project();
  writeFileSync(path.join(root, "AGENTS.md"), "# Keep this\n");
  mkdirSync(path.join(root, ".github"), { recursive: true });
  writeFileSync(path.join(root, ".github/copilot-instructions.md"), "Existing Copilot note.\n");
  mkdirSync(path.join(root, ".codex"), { recursive: true });
  writeFileSync(path.join(root, ".codex/hooks.json"), `${JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
  }, null, 2)}\n`);
  mkdirSync(path.join(root, ".windsurf"), { recursive: true });
  writeFileSync(path.join(root, ".windsurf/hooks.json"), `${JSON.stringify({
    hooks: { pre_run_command: [{ command: "echo run" }] },
  }, null, 2)}\n`);
  installAgents(root, ["codex", "copilot", "windsurf", "cline", "agents"], false);
  const written = tree(root);
  const expectedDir = path.join(fixture, "expected");
  const expected = JSON.parse(readFileSync(path.join(expectedDir, "files.json"), "utf8")) as Record<string, string>;
  assert.deepEqual(written, expected);

  const codex = JSON.parse(read(root, ".codex/hooks.json")) as { hooks: { Stop: unknown[]; PostToolUse: unknown[] } };
  assert.equal(codex.hooks.Stop.length, 1);
  assert.equal(codex.hooks.PostToolUse.length, 1);
  const windsurf = JSON.parse(read(root, ".windsurf/hooks.json")) as {
    hooks: { pre_run_command: unknown[]; post_write_code: Array<{ command: string; show_output: boolean }> };
  };
  assert.equal(windsurf.hooks.pre_run_command.length, 1);
  assert.equal(windsurf.hooks.post_write_code[0]?.command, HOOK);
  assert.equal(windsurf.hooks.post_write_code[0]?.show_output, true);
  assert.equal(read(root, "AGENTS.md").startsWith("# Keep this\n"), true);
  assert.equal(read(root, ".github/copilot-instructions.md").startsWith("Existing Copilot note.\n"), true);
  const mode = statSync(path.join(root, ".clinerules/hooks/PostToolUse")).mode;
  assert.equal(mode & 0o111, 0o111);
  assert.equal(existsSync(path.join(root, ".cline/hooks")), false);
});

test("uninstall removes uninvent blocks and leaves the rest", () => {
  const root = project();
  writeFileSync(path.join(root, "AGENTS.md"), "# Keep this\n");
  mkdirSync(path.join(root, ".claude"), { recursive: true });
  writeFileSync(path.join(root, ".claude/settings.json"), `${JSON.stringify({
    permissions: { allow: ["Read"] },
  }, null, 2)}\n`);
  installAgents(root, ["claude-code", "cursor", "codex", "copilot", "windsurf", "cline", "agents"], true);
  uninstallAgents(root, ["claude-code", "cursor", "codex", "copilot", "windsurf", "cline", "agents"]);
  assert.equal(read(root, "AGENTS.md"), "# Keep this\n");
  const claude = JSON.parse(read(root, ".claude/settings.json")) as { permissions: { allow: string[] }; hooks?: unknown };
  assert.deepEqual(claude.permissions.allow, ["Read"]);
  assert.equal(claude.hooks, undefined);
  assert.equal(existsSync(path.join(root, ".codex/hooks.json")), false);
  assert.equal(existsSync(path.join(root, ".github/copilot-instructions.md")), false);
  assert.equal(existsSync(path.join(root, ".github/hooks/uninvent.json")), false);
  assert.equal(existsSync(path.join(root, ".windsurf/rules/uninvent.md")), false);
  assert.equal(existsSync(path.join(root, ".windsurf/hooks.json")), false);
  assert.equal(existsSync(path.join(root, ".devin/hooks.v1.json")), false);
  assert.equal(existsSync(path.join(root, ".clinerules/uninvent.md")), false);
  assert.equal(existsSync(path.join(root, ".clinerules/hooks/PostToolUse")), false);
  assert.equal(existsSync(path.join(root, ".clinerules/hooks/PreToolUse")), false);
  assert.equal(existsSync(path.join(root, ".agents/skills/uninvent/SKILL.md")), false);
});

test("a single-file .clinerules keeps the hook beside it", () => {
  const root = project();
  writeFileSync(path.join(root, ".clinerules"), "Team rule.\n");
  installAgents(root, ["cline"], false);
  assert.match(read(root, ".clinerules"), /Team rule/);
  assert.match(read(root, ".clinerules"), /<!-- uninvent:start -->/);
  assert.equal(existsSync(path.join(root, ".cline/hooks/PostToolUse")), true);
  assert.equal(existsSync(path.join(root, ".clinerules/hooks")), false);
  installAgents(root, ["cline"], false);
  assert.equal((read(root, ".clinerules").match(/<!-- uninvent:start -->/g) ?? []).length, 1);
});

test("codex, copilot, windsurf, and cline hooks report one line and stay quiet when clean", () => {
  const root = project();
  mkdirSync(path.join(root, "src/pages"), { recursive: true });
  const login = path.join(root, "src/pages/Login.tsx");
  const clean = path.join(root, "src/pages/Home.tsx");
  writeFileSync(login, "export function Login() {\n  return <button type=\"submit\">Continue</button>;\n}\n");
  writeFileSync(clean, "import { Button } from \"@/components/ui/button\";\nexport function Home() {\n  return <Button>Continue</Button>;\n}\n");
  const line = /raw <button> in src\/pages\/Login\.tsx:\d+, use ui\/Button/;

  const codex = runHook({
    cwd: root,
    stdin: JSON.stringify({
      hook_event_name: "PostToolUse",
      cwd: root,
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Update File: src/pages/Login.tsx\n*** End Patch" },
    }),
  });
  assert.equal(codex.exitCode, 0);
  const codexPayload = JSON.parse(codex.stdout) as { hookSpecificOutput: { additionalContext: string }; decision?: string };
  assert.match(codexPayload.hookSpecificOutput.additionalContext, line);
  assert.equal(codexPayload.decision, undefined);

  const copilot = runHook({
    cwd: root,
    stdin: JSON.stringify({
      cwd: root,
      toolName: "edit",
      toolArgs: { path: login },
      toolResult: { resultType: "success", textResultForLlm: "edited" },
    }),
  });
  const copilotPayload = JSON.parse(copilot.stdout) as { additionalContext: string };
  assert.match(copilotPayload.additionalContext, line);

  const windsurf = runHook({
    cwd: root,
    stdin: JSON.stringify({
      agent_action_name: "post_write_code",
      tool_info: { file_path: login },
    }),
  });
  assert.match(windsurf.stdout, line);
  assert.equal(windsurf.stdout.trim().split("\n").length, 1);

  const cline = runHook({
    cwd: root,
    stdin: JSON.stringify({
      hookName: "PostToolUse",
      postToolUse: { toolName: "editor", parameters: { path: login }, success: true },
    }),
  });
  const clinePayload = JSON.parse(cline.stdout) as { cancel: boolean; contextModification: string; context: string };
  assert.equal(clinePayload.cancel, false);
  assert.match(clinePayload.contextModification, line);
  assert.equal(clinePayload.context, clinePayload.contextModification);

  const cleanCline = runHook({
    cwd: root,
    stdin: JSON.stringify({
      hookName: "tool_result",
      clineVersion: "1.0.0",
      tool_result: { name: "editor", input: { filePath: clean } },
    }),
  });
  assert.equal(cleanCline.stdout, "{}\n");
  const ignored = runHook({
    cwd: root,
    stdin: JSON.stringify({
      hookName: "PostToolUse",
      postToolUse: { toolName: "read_files", parameters: { path: login }, success: true },
    }),
  });
  assert.equal(ignored.stdout, "{}\n");

  const both = runHook({
    cwd: root,
    stdin: JSON.stringify({
      hook_event_name: "PostToolUse",
      cwd: root,
      tool_name: "apply_patch",
      tool_input: {
        command: "*** Begin Patch\n*** Update File: src/pages/Login.tsx\n*** Update File: src/pages/Home.tsx\n*** End Patch",
      },
    }),
  });
  const bothPayload = JSON.parse(both.stdout) as { hookSpecificOutput: { additionalContext: string } };
  assert.match(bothPayload.hookSpecificOutput.additionalContext, line);
  assert.equal(bothPayload.hookSpecificOutput.additionalContext.includes("Home.tsx"), false);
});

test("install --agent and uninstall are wired through the CLI", () => {
  const root = project();
  const cli = [process.execPath, "--import", "tsx", path.join(repoRoot, "src/cli.ts")];
  const run = (args: string[]) => spawnSync(cli[0] ?? "node", [...cli.slice(1), ...args], { encoding: "utf8" });
  const installed = run(["install", "--agent", "agents", "--cwd", root]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /AGENTS.md: instructions only/);
  assert.equal(existsSync(path.join(root, ".codex")), false);
  const removed = run(["uninstall", "--agent", "agents", "--cwd", root]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(path.join(root, "AGENTS.md")), false);
  const unknown = run(["install", "--agent", "nope", "--cwd", root]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown agent/);
});
