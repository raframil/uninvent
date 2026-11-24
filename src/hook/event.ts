export interface HookEvent {
  host: "claude" | "cursor" | "copilot" | "windsurf" | "cline";
  phase: "pre" | "post";
  eventName: string;
  toolName?: string;
  filePath?: string;
  /** Every file the edit touched. One path for a normal write. */
  filePaths: string[];
  content?: string;
  /** True when the payload is a patch snippet rather than the whole file. */
  snippet: boolean;
  cwd?: string;
}

const FILE_TOOLS = new Set([
  "ApplyPatch",
  "Edit",
  "EditNotebook",
  "MultiEdit",
  "NotebookEdit",
  "StrReplace",
  "Write",
  "apply_patch",
  "create",
  "edit",
  "notebook_edit",
  "str_replace_editor",
  "write",
]);

const PATH_KEYS = ["file_path", "filePath", "path", "target_file", "notebook_path", "absolutePath", "uri", "file"];

const CLINE_FILE_TOOLS = new Set([
  "apply_patch",
  "create_file",
  "edit_file",
  "editor",
  "insert_content",
  "new_file",
  "replace_in_file",
  "write_file",
  "write_to_file",
]);

export function parseHookEvent(raw: string): HookEvent | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  return parseCline(data) ?? parseWindsurf(data) ?? parseCopilot(data) ?? parseToolEvent(data);
}

export function hookStdout(event: HookEvent, lines: string[]): string {
  if (event.host === "cline" && lines.length === 0) return "{}\n";
  if (lines.length === 0) return "";
  const text = lines.join("\n");
  if (event.host === "windsurf" || event.eventName === "afterFileEdit") return `${text}\n`;
  if (event.host === "copilot") {
    if (event.phase === "pre") {
      return `${JSON.stringify({ permissionDecision: "allow", permissionDecisionReason: text })}\n`;
    }
    return `${JSON.stringify({ additionalContext: text })}\n`;
  }
  if (event.host === "cline") {
    return `${JSON.stringify({ cancel: false, contextModification: text, context: text })}\n`;
  }
  if (event.host === "cursor" && event.phase === "pre") {
    return `${JSON.stringify({ permission: "allow", agent_message: text })}\n`;
  }
  if (event.host === "cursor") {
    return `${JSON.stringify({ additional_context: text })}\n`;
  }
  const hookEventName = event.phase === "pre" ? "PreToolUse" : "PostToolUse";
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: text,
    },
  })}\n`;
}

function parseCline(data: Record<string, unknown>): HookEvent | null {
  const nestedPost = asRecord(data.postToolUse);
  const nestedPre = asRecord(data.preToolUse);
  const toolResult = asRecord(data.tool_result);
  const toolCall = asRecord(data.tool_call);
  const hookName = readString(data.hookName);
  const cline =
    hookName !== undefined ||
    nestedPost !== null ||
    nestedPre !== null ||
    (toolResult !== null && typeof data.clineVersion === "string") ||
    (toolCall !== null && typeof data.clineVersion === "string");
  if (!cline) return null;
  const phase: HookEvent["phase"] = nestedPre || hookName === "PreToolUse" || hookName === "tool_call" ? "pre" : "post";
  const toolName =
    readString(nestedPost?.toolName) ??
    readString(nestedPre?.toolName) ??
    readString(toolResult?.name) ??
    readString(toolCall?.name);
  const parameters =
    asRecord(nestedPost?.parameters) ??
    asRecord(nestedPre?.parameters) ??
    asRecord(toolResult?.input) ??
    asRecord(toolCall?.input) ??
    {};
  const filePaths = toolName && !CLINE_FILE_TOOLS.has(toolName) ? [] : readPaths(parameters);
  return {
    host: "cline",
    phase,
    eventName: hookName ?? (phase === "pre" ? "PreToolUse" : "PostToolUse"),
    toolName,
    filePath: filePaths[0],
    filePaths,
    snippet: false,
    cwd: readString(data.cwd) ?? firstString(data.workspaceRoots),
  };
}

function parseWindsurf(data: Record<string, unknown>): HookEvent | null {
  const action = readString(data.agent_action_name);
  if (action !== "post_write_code" && action !== "pre_write_code") return null;
  const info = asRecord(data.tool_info) ?? {};
  const filePaths = readPaths(info);
  return {
    host: "windsurf",
    phase: action === "pre_write_code" ? "pre" : "post",
    eventName: action,
    filePath: filePaths[0],
    filePaths,
    snippet: false,
    cwd: readString(data.cwd),
  };
}

function parseCopilot(data: Record<string, unknown>): HookEvent | null {
  const named = readString(data.toolName) ?? readString(data.tool_name);
  const copilotTool = named === "create" || named === "str_replace_editor";
  if (!("toolName" in data) && !("toolArgs" in data) && !copilotTool) return null;
  const toolName = named;
  if (toolName && !FILE_TOOLS.has(toolName)) return null;
  const toolArgs = asRecord(data.toolArgs) ?? asRecord(data.tool_input) ?? {};
  const filePaths = readPaths(toolArgs);
  const eventName = readString(data.hook_event_name) ?? "";
  const phase: HookEvent["phase"] = eventName.toLowerCase() === "pretooluse" ? "pre" : "post";
  if (filePaths.length === 0 && !readString(toolArgs.content)) return null;
  return {
    host: "copilot",
    phase,
    eventName: eventName || "postToolUse",
    toolName,
    filePath: filePaths[0],
    filePaths,
    content: readString(toolArgs.content),
    snippet: false,
    cwd: readString(data.cwd),
  };
}

function parseToolEvent(data: Record<string, unknown>): HookEvent | null {
  const eventName = readString(data.hook_event_name) ?? readString(data.hookEventName) ?? "";
  const toolInput = asRecord(data.tool_input) ?? asRecord(data.toolInput) ?? {};
  const toolName = readString(data.tool_name) ?? readString(data.toolName);
  if (toolName && !FILE_TOOLS.has(toolName)) return null;

  const fromInput = readPaths(toolInput);
  const top = readString(data.file_path) ?? readString(data.filePath);
  const paths = top && !fromInput.includes(top) ? [...fromInput, top] : fromInput;
  const content = readString(toolInput.content);
  const patch = readString(toolInput.new_string) ?? readString(toolInput.new_str);
  const phase: HookEvent["phase"] = eventName.toLowerCase() === "pretooluse" ? "pre" : "post";
  const snippet = phase === "pre" && !content && Boolean(patch);
  if (paths.length === 0 && !content && !patch) return null;
  const host = detectHost(data, eventName);

  return {
    host,
    phase,
    eventName: eventName || (host === "claude" ? "PostToolUse" : "postToolUse"),
    toolName,
    filePath: paths[0],
    filePaths: paths,
    content: content ?? (snippet ? patch : undefined),
    snippet,
    cwd: readString(data.cwd),
  };
}

function readPaths(record: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const key of PATH_KEYS) {
    const value = readString(record[key]);
    if (value) paths.push(value);
  }
  const files = record.files;
  if (Array.isArray(files)) {
    for (const entry of files) {
      if (typeof entry === "string" && entry.length > 0) paths.push(entry);
      else if (isRecord(entry)) paths.push(...readPaths(entry));
    }
  }
  const command = readString(record.command);
  if (command) paths.push(...pathsFromPatch(command));
  return [...new Set(paths)];
}

/** File paths named by a Codex or Copilot apply_patch payload. */
export function pathsFromPatch(command: string): string[] {
  if (!command.includes("*** ") && !command.includes("diff --git ")) return [];
  const paths: string[] = [];
  for (const match of command.matchAll(/^\*\*\* (?:Update|Add) File: (.+)$/gm)) {
    const file = match[1]?.trim();
    if (file) paths.push(file);
  }
  for (const match of command.matchAll(/^diff --git a\/.+ b\/(.+)$/gm)) {
    const file = match[1]?.trim();
    if (file) paths.push(file);
  }
  return paths;
}

function detectHost(data: Record<string, unknown>, eventName: string): "claude" | "cursor" {
  if (eventName === "PostToolUse" || eventName === "PreToolUse") return "claude";
  if (
    eventName === "postToolUse" ||
    eventName === "preToolUse" ||
    eventName === "afterFileEdit"
  ) {
    return "cursor";
  }
  if (typeof data.session_id === "string" && typeof data.conversation_id !== "string") return "claude";
  return "cursor";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return readString(value[0]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
