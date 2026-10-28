/**
 * Coach agent: manual tool-use loop on the Anthropic Messages API with streaming.
 *
 * - Model: Claude Opus 5.5 (override with COACH_MODEL). Adaptive thinking is always on; effort
 *   controls depth. Progress notes between tool calls stream as "updates".
 * - Server-side refusal fallbacks enabled ("default").
 * - History is stored verbatim (content blocks, including thinking) and only ever appended —
 *   required for thinking-block validity and good for prompt-cache hits. Per-turn context goes
 *   into the new user message, never into the (cached) system prompt.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../auth/middleware";
import { COACH_SYSTEM_PROMPT } from "./system-prompt";
import { TOOL_DEFINITIONS, executeTool, toolStatus } from "./tools";
import { buildTurnContext } from "./context";
import { logAiUsage } from "../analytics/ai-usage";
import {
  appendThreadMessage,
  createThread,
  getOrCreateLatestThread,
  getThread,
  getThreadMessages,
  renameThread,
  truncateThreadFrom,
} from "../data";

export const COACH_MODEL = process.env.COACH_MODEL || "claude-opus-5-5";
const COACH_EFFORT = (process.env.COACH_EFFORT as "low" | "medium" | "high" | undefined) || "medium";
const MAX_ITERATIONS = 14;
const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"];

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic();
  return client;
}

const TOOLS: Anthropic.Beta.BetaToolUnion[] = TOOL_DEFINITIONS.map((t) => ({ ...t, eager_input_streaming: true }));

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function handleChatStream(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).userId;
  const { message, threadId, editMessageId } = req.body as { message?: string; threadId?: string; editMessageId?: string };
  const text = message?.trim();
  if (!text) {
    res.status(400).json({ message: "Message is required" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ message: "Coach is not configured (missing ANTHROPIC_API_KEY)" });
    return;
  }
  const thread = threadId ? await getThread(userId, threadId) : await getOrCreateLatestThread(userId);
  if (!thread) {
    res.status(404).json({ message: "Conversation not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  // Stop button / tab closed: stop calling the model. (`req` "close" fires once the body is read, so watch `res`.)
  let clientGone = false;
  let liveStream: { abort: () => void } | null = null;
  res.on("close", () => {
    if (res.writableEnded) return;
    clientGone = true;
    liveStream?.abort();
  });
  const send = (data: Record<string, unknown>) => {
    if (!clientGone && !res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => send({ type: "ping" }), 15000);

  try {
    // Edit: drop the edited message and everything after it, then answer the new text. Truncating the tail
    // keeps the earlier history byte-identical, so cached prefixes and thinking blocks stay valid.
    if (editMessageId) await truncateThreadFrom(thread.id, editMessageId);
    const history = await getThreadMessages(thread.id);
    if (!history.length) await renameThread(thread.id, text.slice(0, 60));
    send({ type: "thread", threadId: thread.id });

    const context = await buildTurnContext(userId, { firstTurn: !history.length });
    const userContent: Anthropic.Beta.BetaContentBlockParam[] = [
      { type: "text", text },
      { type: "text", text: `<app_context>\n${context}\n</app_context>` },
    ];
    const userRow = await appendThreadMessage({ threadId: thread.id, userId, role: "user", content: userContent, displayText: text, visible: true });
    send({ type: "user_message", id: userRow.id });

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content as Anthropic.Beta.BetaContentBlockParam[] })),
      { role: "user", content: userContent },
    ];

    let jsonRetries = 0;
    let calledTools = false;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (clientGone) break;
      const stream = anthropic().beta.messages.stream({
        model: COACH_MODEL,
        max_tokens: 32000,
        betas: BETAS,
        fallbacks: "default",
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: COACH_EFFORT },
        cache_control: { type: "ephemeral" },
        system: COACH_SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      liveStream = stream;
      stream.on("text", (delta) => send({ type: "token", content: delta }));
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          send({ type: "tool_start", name: event.content_block.name, status: toolStatus(event.content_block.name) });
        } else if (event.type === "content_block_delta" && event.delta.type === "thinking_delta" && event.delta.thinking.trim()) {
          send({ type: "progress", content: event.delta.thinking });
        }
      });

      let final: Anthropic.Beta.BetaMessage;
      try {
        final = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (clientGone) break; // aborted by the athlete: nothing from this iteration is stored
        // With eager input streaming, an unparseable tool input rejects finalMessage; re-issue the turn.
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        console.warn("[coach] tool input not parseable, retrying turn");
        send({ type: "iteration_reset" });
        continue;
      }

      void logAiUsage(userId, "coach", final.model, final.usage);

      const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const iterText = textOf(final.content);

      if (final.stop_reason === "max_tokens" && toolUses.length) {
        throw new Error("Tool input truncated (max_tokens)");
      }

      await appendThreadMessage({
        threadId: thread.id,
        userId,
        role: "assistant",
        content: final.content as unknown as Anthropic.Beta.BetaContentBlockParam[],
        displayText: iterText || null,
        visible: !!iterText,
      });
      messages.push({ role: "assistant", content: final.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });
      send({ type: "iteration_done", content: iterText });

      if (final.stop_reason === "refusal") {
        if (!iterText) send({ type: "token", content: "I can't help with that one — let's get back to your training." });
        break;
      }
      if (final.stop_reason === "pause_turn") continue;
      if (!toolUses.length) break;

      calledTools = true;
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const r = await executeTool(tu.name, tu.input, { userId });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
        send({ type: "tool_end", name: tu.name, isError: r.isError });
      }
      await appendThreadMessage({ threadId: thread.id, userId, role: "user", content: results, displayText: null, visible: false });
      messages.push({ role: "user", content: results });
    }
    send({ type: "done", changedData: calledTools });
  } catch (err) {
    if (clientGone) return;
    console.error("[coach] error", err);
    const msg =
      err instanceof Anthropic.RateLimitError
        ? "I'm getting a lot of requests right now — try again in a moment."
        : err instanceof Anthropic.APIError && err.status === 529
          ? "The AI service is overloaded — try again in a moment."
          : "I ran into an issue. Please try again.";
    send({ type: "error", content: msg });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

/** Visible transcript, grouping each assistant turn's text segments into one bubble. */
export async function getChatHistory(userId: string, threadId?: string) {
  const thread = threadId ? await getThread(userId, threadId) : await getOrCreateLatestThread(userId);
  if (!thread) return { threadId: null, messages: [] };
  const rows = await getThreadMessages(thread.id);
  const out: { id: string; role: "user" | "assistant"; content: string; createdAt: string }[] = [];
  for (const r of rows) {
    if (!r.visible || !r.displayText) continue;
    const last = out[out.length - 1];
    if (r.role === "assistant" && last?.role === "assistant") {
      last.content += `\n\n${r.displayText}`;
      continue;
    }
    out.push({ id: r.id, role: r.role as "user" | "assistant", content: r.displayText, createdAt: r.createdAt.toISOString() });
  }
  return { threadId: thread.id, title: thread.title, messages: out };
}

export async function startNewThread(userId: string) {
  return createThread(userId);
}
