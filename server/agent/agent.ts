import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { pool } from "../storage";
import { coachTools } from "./tools";
import { COACH_SYSTEM_PROMPT } from "./system-prompt";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../auth/middleware";

// ─── LLM ─────────────────────────────────────────────────────────────────────

const llm = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  streaming: true,
  maxTokens: 4096,
  temperature: 0.7,
});

// ─── Agent ───────────────────────────────────────────────────────────────────

let agentInstance: Awaited<ReturnType<typeof createReactAgent>> | null = null;

export async function getCoachAgent() {
  if (agentInstance) return agentInstance;

  // PostgreSQL checkpointer backed by Supabase — stores full conversation state
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();

  agentInstance = createReactAgent({
    llm,
    tools: coachTools,
    checkpointSaver: checkpointer,
    messageModifier: new SystemMessage(COACH_SYSTEM_PROMPT),
  });

  return agentInstance;
}

// ─── Streaming Chat Handler ───────────────────────────────────────────────────

export async function handleChatStream(req: Request, res: Response): Promise<void> {
  const { message, threadId = "default" } = req.body as { message: string; threadId?: string };
  const userId = (req as AuthenticatedRequest).userId;

  if (!message?.trim()) {
    res.status(400).json({ message: "Message is required" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const sendEvent = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const agent = await getCoachAgent();

    // Thread ID scoped per user to prevent cross-user data leakage
    const threadKey = `${userId}:${threadId}`;

    const eventStream = agent.streamEvents(
      { messages: [new HumanMessage(message)] },
      {
        version: "v2",
        configurable: {
          thread_id: threadKey,
          userId, // passed through to all tools via config.configurable.userId
        },
      }
    );

    for await (const event of eventStream) {
      switch (event.event) {
        case "on_chat_model_stream": {
          const chunk = event.data?.chunk;
          if (chunk?.content) {
            const text = typeof chunk.content === "string"
              ? chunk.content
              : Array.isArray(chunk.content)
                ? chunk.content.map((c: { text?: string }) => c.text ?? "").join("")
                : "";
            if (text) sendEvent({ type: "token", content: text });
          }
          break;
        }
        case "on_tool_start": {
          const toolName = event.name;
          const statusMap: Record<string, string> = {
            get_recent_runs: "Analyzing your recent training...",
            get_athlete_profile: "Loading your profile...",
            get_current_plan: "Checking your training plan...",
            create_training_plan: "Building your personalized plan...",
            calculate_fitness_metrics: "Crunching your fitness data...",
            update_plan_workout: "Updating your calendar...",
            add_workout_to_plan: "Adding to your calendar...",
            log_run: "Saving your run...",
            update_run_notes: "Saving your notes...",
            search_runs: "Searching your run history...",
          };
          sendEvent({
            type: "tool_start",
            name: toolName,
            status: statusMap[toolName] ?? `Running ${toolName}...`,
          });
          break;
        }
        case "on_tool_end": {
          sendEvent({ type: "tool_end", name: event.name });
          break;
        }
      }
    }

    sendEvent({ type: "done" });
  } catch (error) {
    console.error("Agent error:", error);
    sendEvent({
      type: "error",
      content: "I ran into an issue. Please try again.",
    });
  } finally {
    res.end();
  }
}

// ─── Non-streaming message history ───────────────────────────────────────────

export async function getChatHistory(userId: string, threadId = "default") {
  const agent = await getCoachAgent();
  const threadKey = `${userId}:${threadId}`;

  try {
    const state = await agent.getState({ configurable: { thread_id: threadKey } });
    const messages = (state.values?.messages as (HumanMessage | AIMessage)[]) ?? [];

    return messages
      .filter((m) => m instanceof HumanMessage || m instanceof AIMessage)
      .map((m) => ({
        role: m instanceof HumanMessage ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));
  } catch {
    return [];
  }
}
