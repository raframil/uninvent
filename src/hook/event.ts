export interface HookEvent {
  host: "claude" | "cursor";
  phase: "pre" | "post";
  eventName: string;
  toolName?: string;
  filePath?: string;
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
  const eventName = readString(data.hook_event_name) ?? readString(data.hookEventName) ?? "";
  const toolInput = asRecord(data.tool_input) ?? asRecord(data.toolInput) ?? {};
  const toolName = readString(data.tool_name) ?? readString(data.toolName);
  if (toolName && !FILE_TOOLS.has(toolName)) return null;

  const filePath =
    readString(toolInput.file_path) ??
    readString(toolInput.filePath) ??
    readString(toolInput.path) ??
    readString(toolInput.target_file) ??
    readString(toolInput.notebook_path) ??
    readString(data.file_path) ??
    readString(data.filePath);

  const content = readString(toolInput.content);
  const patch = readString(toolInput.new_string) ?? readString(toolInput.new_str);
  const phase: HookEvent["phase"] = eventName.toLowerCase() === "pretooluse" ? "pre" : "post";
  const snippet = phase === "pre" && !content && Boolean(patch);
  if (!filePath && !content && !patch) return null;

  return {
    host: detectHost(data, eventName),
    phase,
    eventName: eventName || (detectHost(data, eventName) === "claude" ? "PostToolUse" : "postToolUse"),
    toolName,
    filePath,
    content: content ?? (snippet ? patch : undefined),
    snippet,
    cwd: readString(data.cwd),
  };
}

export function hookStdout(event: HookEvent, lines: string[]): string {
  if (lines.length === 0) return "";
  const text = lines.join("\n");
  if (event.eventName === "afterFileEdit") return `${text}\n`;
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
