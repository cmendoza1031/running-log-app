import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Trash2, Loader2, Bot, ChevronRight, Activity, Calendar, TrendingUp, Zap } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolStatuses?: string[];
  isStreaming?: boolean;
}

// ─── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  { icon: TrendingUp, text: "Analyze my last 2 weeks of training" },
  { icon: Calendar, text: "Build me a training plan for a 5K" },
  { icon: Activity, text: "Am I running too hard on easy days?" },
  { icon: Zap, text: "How should I taper for my upcoming race?" },
];

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-skyblue to-blue-600 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 shadow-sm">
          <Bot size={14} className="text-white" />
        </div>
      )}

      <div className={`max-w-[82%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        {/* Tool status pills */}
        {message.toolStatuses && message.toolStatuses.length > 0 && (
          <div className="flex flex-col gap-1 mb-1">
            {message.toolStatuses.map((status, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-blue-50 text-skyblue text-xs px-3 py-1.5 rounded-xl"
              >
                <Loader2 size={10} className="animate-spin" />
                {status}
              </div>
            ))}
          </div>
        )}

        <div
          className={`px-4 py-3 rounded-2xl shadow-sm ${
            isUser
              ? "bg-skyblue text-white rounded-br-md"
              : "bg-white text-gray-800 rounded-bl-md"
          }`}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed">{message.content}</p>
          ) : (
            <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-headings:mt-3 prose-headings:mb-1 prose-li:my-0.5 prose-code:bg-blue-50 prose-code:text-blue-700 prose-code:px-1 prose-code:rounded prose-table:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
              {message.isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-skyblue ml-0.5 animate-pulse rounded-sm" />
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Typing indicator ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex justify-start mb-3"
    >
      <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-skyblue to-blue-600 flex items-center justify-center mr-2 flex-shrink-0 shadow-sm">
        <Bot size={14} className="text-white" />
      </div>
      <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 0.15, 0.3].map((delay, i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Coach Page ──────────────────────────────────────────────────────────

export default function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Load history on mount
  useEffect(() => {
    const load = async () => {
      try {
        const token = await getAccessToken();
        if (!token) { setIsLoadingHistory(false); return; }
        const res = await fetch("/api/agent/history?threadId=default", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const history = await res.json() as { role: string; content: string }[];
          setMessages(history.map((m, i) => ({
            id: `hist-${i}`,
            role: m.role as "user" | "assistant",
            content: m.content,
          })));
        }
      } finally {
        setIsLoadingHistory(false);
        setTimeout(() => scrollToBottom(false), 100);
      }
    };
    load();
  }, [scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isThinking) return;

    await IOSFeedbackManager.lightImpact();

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: text };
    const assistantMsgId = `a-${Date.now()}`;

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);

    // Optimistically add streaming assistant message
    setMessages((prev) => [...prev, {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      toolStatuses: [],
      isStreaming: true,
    }]);

    try {
      const token = await getAccessToken();
      abortRef.current = new AbortController();

      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text, threadId: "default" }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as {
              type: string;
              content?: string;
              name?: string;
              status?: string;
            };

            if (event.type === "token") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: m.content + (event.content ?? ""), toolStatuses: [] }
                    : m
                )
              );
            } else if (event.type === "tool_start") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, toolStatuses: [...(m.toolStatuses ?? []), event.status ?? event.name ?? ""] }
                    : m
                )
              );
            } else if (event.type === "tool_end") {
              // Keep the last status shown until tokens arrive
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, isStreaming: false, toolStatuses: [] } : m
                )
              );
              // Invalidate run/plan queries so calendar refreshes
              qc.invalidateQueries({ queryKey: ["/api/runs"] });
              qc.invalidateQueries({ queryKey: ["/api/plans"] });
              await IOSFeedbackManager.successNotification();
            } else if (event.type === "error") {
              throw new Error(event.content);
            }
          } catch { /* skip malformed line */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Chat error:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: "Sorry, I ran into an issue. Please try again.", isStreaming: false, toolStatuses: [] }
            : m
        )
      );
      await IOSFeedbackManager.errorNotification();
    } finally {
      setIsThinking(false);
    }
  }, [isThinking, qc]);

  const clearHistory = async () => {
    await IOSFeedbackManager.heavyImpact();
    const token = await getAccessToken();
    if (!token) return;
    await fetch("/api/agent/history?threadId=default", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setMessages([]);
    toast({ title: "Conversation cleared" });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isEmptyChat = messages.length === 0 && !isLoadingHistory;

  return (
    <div className="flex flex-col h-screen bg-ivory">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-14 pb-4 bg-ivory">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Coach</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {user?.user_metadata?.full_name
              ? `Training with ${user.user_metadata.full_name.split(" ")[0]}`
              : "AI-powered training guidance"}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="p-2 rounded-xl text-gray-400 active:bg-gray-100 transition-colors"
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-2 pb-4"
        data-scroll-container
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="text-skyblue animate-spin" />
          </div>
        ) : isEmptyChat ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center h-full pb-8"
          >
            {/* Coach avatar */}
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-skyblue to-blue-600 flex items-center justify-center shadow-lg mb-5">
              <Bot size={36} className="text-white" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Your AI Coach</h2>
            <p className="text-gray-500 text-sm text-center max-w-xs mb-8">
              I have access to all your training data. Ask me anything, or I'll proactively analyze your training.
            </p>

            {/* Suggestion cards */}
            <div className="w-full space-y-2">
              {SUGGESTED_PROMPTS.map(({ icon: Icon, text }) => (
                <button
                  key={text}
                  onClick={() => { sendMessage(text); IOSFeedbackManager.lightImpact(); }}
                  className="w-full flex items-center bg-white rounded-2xl px-4 py-3.5 shadow-sm text-left active:scale-95 transition-transform"
                >
                  <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center mr-3 flex-shrink-0">
                    <Icon size={15} className="text-skyblue" />
                  </div>
                  <span className="text-sm text-gray-700 font-medium flex-1">{text}</span>
                  <ChevronRight size={14} className="text-gray-300" />
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          <div className="space-y-1 pt-2">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            </AnimatePresence>
            {isThinking && messages[messages.length - 1]?.content === "" && !messages[messages.length - 1]?.isStreaming && (
              <TypingIndicator />
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-28 pt-2 bg-ivory border-t border-gray-100">
        <div className="flex items-end gap-2 bg-white rounded-2xl shadow-sm px-4 py-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your coach anything..."
            rows={1}
            className="flex-1 resize-none bg-transparent text-gray-900 placeholder-gray-400 text-sm outline-none leading-relaxed max-h-28"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isThinking}
            className="w-9 h-9 bg-skyblue rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform disabled:opacity-40"
          >
            {isThinking ? (
              <Loader2 size={16} className="text-white animate-spin" />
            ) : (
              <Send size={15} className="text-white" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
