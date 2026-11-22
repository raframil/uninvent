import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { writeCatalog } from "../src/catalog.js";
import { hookStdout, parseHookEvent } from "../src/hook/event.js";
import { runHook } from "../src/hook/run.js";
import { installHooks, mergeClaudeSettings, mergeCursorHooks, resolveHookCommand } from "../src/install.js";
import { buttonComponent, sampleCatalog, tempDir } from "./helpers.js";

function projectWithButton(): { root: string; login: string; clean: string } {
  const root = tempDir();
  mkdirSync(path.join(root, "src/pages"), { recursive: true });
  writeFileSync(
    path.join(root, "uninvent.json"),
    `${JSON.stringify({ ui: ["src/components/ui"], catalog: ".uninvent/catalog.json" }, null, 2)}\n`,
  );
  writeCatalog(root, ".uninvent/catalog.json", sampleCatalog([buttonComponent()]));
  const login = path.join(root, "src/pages/Login.tsx");
  const clean = path.join(root, "src/pages/Home.tsx");
  writeFileSync(login, `export function Login() {\n  return <button type="submit">Continue</button>;\n}\n`);
  writeFileSync(
    clean,
    `import { Button } from "@/components/ui/button";\nexport function Home() {\n  return <Button>Continue</Button>;\n}\n`,
  );
  return { root, login, clean };
}

test("claude hook is silent when the edit reuses the system", () => {
  const { root, clean } = projectWithButton();
  const result = runHook({
    cwd: root,
    stdin: JSON.stringify({
      session_id: "s",
      hook_event_name: "PostToolUse",
      cwd: root,
      tool_name: "Write",
      tool_input: { file_path: clean },
    }),
  });
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, 0);
});

test("claude hook prints one line inside additionalContext and does not block", () => {
  const { root, login } = projectWithButton();
  const event = parseHookEvent(JSON.stringify({
    session_id: "s",
    hook_event_name: "PostToolUse",
    cwd: root,
    tool_name: "Edit",
    tool_input: { file_path: login },
  }));
  assert.equal(event?.host, "claude");
  const result = runHook({
    cwd: root,
    stdin: JSON.stringify({
      session_id: "s",
      hook_event_name: "PostToolUse",
      cwd: root,
      tool_name: "Edit",
      tool_input: { file_path: login },
    }),
  });
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
    decision?: string;
  };
  assert.equal(payload.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(payload.decision, undefined);
  assert.match(payload.hookSpecificOutput.additionalContext, /^raw <button> in src\/pages\/Login.tsx:\d+, use ui\/Button$/);
});

test("cursor hook uses additional_context and ignores shell calls", () => {
  const { root, login } = projectWithButton();
  const hit = runHook({
    cwd: root,
    stdin: JSON.stringify({
      conversation_id: "c",
      hook_event_name: "postToolUse",
      cwd: root,
      tool_name: "Write",
      tool_input: { path: login },
    }),
  });
  const payload = JSON.parse(hit.stdout) as { additional_context: string };
  assert.match(payload.additional_context, /raw <button> in src\/pages\/Login.tsx:\d+, use ui\/Button/);

  const shell = runHook({
    cwd: root,
    stdin: JSON.stringify({
      session_id: "s",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    }),
  });
  assert.equal(shell.stdout, "");
});

test("pre-edit snippet warns without a fake line number and without denying", () => {
  const { root } = projectWithButton();
  const result = runHook({
    cwd: root,
    stdin: JSON.stringify({
      session_id: "s",
      hook_event_name: "PreToolUse",
      cwd: root,
      tool_name: "Edit",
      tool_input: {
        file_path: path.join(root, "src/pages/New.tsx"),
        new_string: "<button>Save</button>",
      },
    }),
  });
  const payload = JSON.parse(result.stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string; permissionDecision?: string };
  };
  assert.equal(payload.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(payload.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(payload.hookSpecificOutput.additionalContext, "raw <button> in src/pages/New.tsx, use ui/Button");
});

test("hook stdout helper prints nothing for an empty list", () => {
  const event = parseHookEvent(JSON.stringify({
    session_id: "s",
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: "src/App.tsx" },
  }));
  assert.ok(event);
  assert.equal(hookStdout(event, []), "");
});

test("resolveHookCommand finds a local bin, then this package's built CLI", () => {
  const linked = tempDir();
  mkdirSync(path.join(linked, "node_modules", ".bin"), { recursive: true });
  writeFileSync(path.join(linked, "node_modules", ".bin", "uninvent"), "#!/bin/sh\n");
  assert.equal(resolveHookCommand(linked), "node_modules/.bin/uninvent hook");

  const repo = tempDir();
  mkdirSync(path.join(repo, "dist"), { recursive: true });
  mkdirSync(path.join(repo, "examples", "demo-app"), { recursive: true });
  writeFileSync(path.join(repo, "dist", "cli.js"), "");
  writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "uninvent" }));
  assert.equal(
    resolveHookCommand(path.join(repo, "examples", "demo-app")),
    "node ../../dist/cli.js hook",
  );
});

test("install merges hooks without dropping existing config", () => {
  const root = tempDir();
  mkdirSync(path.join(root, ".claude"), { recursive: true });
  writeFileSync(
    path.join(root, ".claude/settings.json"),
    `${JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] },
    }, null, 2)}\n`,
  );
  installHooks(root, ["claude-code", "cursor"], false);
  installHooks(root, ["claude-code"], false);
  const claude = JSON.parse(readFileSync(path.join(root, ".claude/settings.json"), "utf8")) as {
    permissions: { allow: string[] };
    hooks: { PostToolUse: Array<{ hooks?: Array<{ command: string }> }> };
  };
  assert.deepEqual(claude.permissions.allow, ["Read"]);
  const commands = claude.hooks.PostToolUse.flatMap((group) => group.hooks?.map((hook) => hook.command) ?? []);
  assert.equal(commands.filter((command) => command?.includes("uninvent hook")).length, 1);
  assert.equal(commands.includes("echo hi"), true);
  assert.equal(JSON.stringify(claude.hooks).includes("PreToolUse"), false);

  installHooks(root, ["claude-code"], true);
  const withPre = JSON.parse(readFileSync(path.join(root, ".claude/settings.json"), "utf8")) as {
    hooks: { PreToolUse?: unknown[] };
  };
  assert.equal(Array.isArray(withPre.hooks.PreToolUse), true);

  const merged = mergeCursorHooks({ version: 1, hooks: { stop: [{ command: "echo done" }] } }, "uninvent hook", false);
  const hooks = merged.hooks as { stop: unknown[]; postToolUse: unknown[] };
  assert.equal(hooks.stop.length, 1);
  assert.equal(hooks.postToolUse.length, 1);
  assert.equal(mergeClaudeSettings({ model: "keep" }, "uninvent hook", false).model, "keep");
});
