/** OpenAI-compatible chat request, with OpenRouter's optional attribution headers. */

export function isOpenRouter(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return baseUrl.toLowerCase().includes("openrouter.ai");
  }
}

export function parseModelList(value: string | undefined, fallback: string): string[] {
  const source = value?.trim() ? value : fallback;
  const models = source.split(",").map((item) => item.trim()).filter(Boolean);
  if (models.length === 0) {
    throw new Error("Set UNINVENT_BENCH_MODEL to one model id, or a comma-separated list.");
  }
  return models;
}

export function prepareChatRequest(baseUrl: string, apiKey: string, body: unknown): {
  url: string;
  headers: Record<string, string>;
  body: unknown;
} {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  let next = body;
  if (isOpenRouter(baseUrl)) {
    headers["HTTP-Referer"] = process.env.UNINVENT_BENCH_HTTP_REFERER?.trim() || "https://github.com/raframil/uninvent";
    headers["X-Title"] = process.env.UNINVENT_BENCH_TITLE?.trim() || "uninvent";
    if (next && typeof next === "object" && !Array.isArray(next)) {
      next = { ...(next as Record<string, unknown>), usage: { include: true } };
    }
  }
  return {
    url: `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    headers,
    body: next,
  };
}
