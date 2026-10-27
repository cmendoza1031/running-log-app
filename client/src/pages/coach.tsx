import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Loader2, SquarePen, Sparkles, CalendarRange, BatteryLow, Gauge, Flag, Activity, History } from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useProfile } from "@/lib/vista";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import { useCoachStore, loadCoachHistory, sendCoachMessage, startNewCoachThread, openCoachThread, type CoachMessage } from "@/lib/coach-store";
import { Sheet } from "@/components/kit";
import { fmtDate, timeAgo } from "@/lib/vista";
import type { Dashboard } from "@/lib/types";

function starterPrompts(hasPlan: boolean, race: string | null) {
  const list = [
    hasPlan
      ? { icon: CalendarRange, text: "How did this week go, and what matters most next week?" }
      : { icon: CalendarRange, text: race ? `Build my training plan for the ${race}` : "Build me a training plan" },
    { icon: Activity, text: "Review my last workout in detail" },
    { icon: BatteryLow, text: "I'm feeling run down — adjust my next few days" },
    { icon: Gauge, text: "Are my zones and thresholds right? What should I test?" },
    { icon: Flag, text: race ? `What should my pacing and fueling be for the ${race}?` : "What race would suit my current fitness?" },
  ];
  return list;
}

export default function CoachPage() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const { data: dash } = useQuery<Dashboard>({ queryKey: ["/api/dashboard"] });
  const { messages, busy, loaded, threadId } = useCoachStore();
  const [historyOpen, setHistoryOpen] = useState(false);
  const loading = !loaded;
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoPromptHandled = useRef(false);

  const scrollDown = useCallback((smooth = true) => endRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" }), []);

  useEffect(() => {
    void loadCoachHistory();
    setTimeout(() => scrollDown(false), 50);
  }, [scrollDown]);

  useEffect(() => {
    scrollDown();
  }, [messages, scrollDown]);

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || busy) return;
      setInput("");
      void sendCoachMessage(text, () => void qc.invalidateQueries());
    },
    [busy, qc],
  );

  // Deep links: /coach?prompt=plan or ?prompt=<text>
  useEffect(() => {
    if (loading || autoPromptHandled.current) return;
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (!p) return;
    autoPromptHandled.current = true;
    window.history.replaceState({}, "", "/coach");
    if (p === "plan") {
      send(profile?.targetRace ? `Build my training plan for the ${profile.targetRace}` : "Build me a training plan");
    } else {
      setInput(p);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loading, send, profile?.targetRace]);

  const newChat = async () => {
    if (busy) return;
    void IOSFeedbackManager.mediumImpact();
    await startNewCoachThread();
  };

  const empty = !loading && messages.length === 0;
  const firstName = profile?.fullName?.split(" ")[0];

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <div className="page-top flex shrink-0 items-center justify-between px-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-gradient-to-br from-[#0A84FF] to-[#5E5CE6] shadow-[0_0_20px_rgba(10,132,255,0.45)]">
            <Sparkles size={17} className="text-white" />
          </div>
          <div>
            <div className="text-[17px] font-bold leading-tight text-ink-1">Coach</div>
            <div className="text-[11px] text-ink-3">Knows your training, zones & plan</div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setHistoryOpen(true)} disabled={busy} className="press rounded-full bg-white/[0.08] p-2 text-ink-2 disabled:opacity-40" aria-label="Past conversations">
            <History size={17} />
          </button>
          {messages.length > 0 && (
            <button type="button" onClick={() => void newChat()} disabled={busy} className="press rounded-full bg-white/[0.08] p-2 text-ink-2 disabled:opacity-40" aria-label="New conversation">
              <SquarePen size={17} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" style={{ WebkitOverflowScrolling: "touch" }}>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="animate-spin text-ink-3" />
          </div>
        ) : empty ? (
          <div className="pb-4 pt-6">
            <h2 className="text-[24px] font-bold leading-tight text-ink-1">
              {firstName ? `Hey ${firstName}.` : "Hey."} <span className="text-ink-3">What are we working on?</span>
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              I can see your workouts, zones, fitness and calendar — and I can change your plan directly. Ask anything, from "why am I slow on hills" to "I only have 40 minutes today".
            </p>
            <div className="mt-5 space-y-2">
              {starterPrompts(!!dash?.plan, profile?.targetRace ?? dash?.race?.label ?? null).map(({ icon: Icon, text }) => (
                <button key={text} type="button" onClick={() => send(text)} className="press card flex w-full items-center gap-3 px-4 py-3.5 text-left">
                  <Icon size={17} className="shrink-0 text-primary" />
                  <span className="text-[14px] font-medium text-ink-1">{text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-3">
            {messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
          </div>
        )}
        <div ref={endRef} className="h-2" />
      </div>

      <HistorySheet
        open={historyOpen}
        currentId={threadId}
        onClose={() => setHistoryOpen(false)}
        onPick={(id) => {
          setHistoryOpen(false);
          void openCoachThread(id).then(() => setTimeout(() => scrollDown(false), 50));
        }}
      />

      <div className="shrink-0 px-3 pb-[calc(84px+env(safe-area-inset-bottom))] pt-2">
        <div className="flex items-end gap-2 rounded-[22px] border border-hairline bg-[#111113] py-1.5 pl-4 pr-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Message your coach"
            className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-snug text-ink-1 outline-none placeholder:text-ink-3"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim() || busy}
            className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:bg-white/[0.12] disabled:text-ink-3"
            aria-label="Send"
          >
            {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={18} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ThreadRow {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

function HistorySheet({ open, currentId, onClose, onPick }: { open: boolean; currentId: string | null; onClose: () => void; onPick: (id: string) => void }) {
  const { data, isLoading } = useQuery<ThreadRow[]>({ queryKey: ["/api/coach/threads"], enabled: open, staleTime: 0 });
  // Threads get a title on their first message; untitled ones are empty "new chat" shells.
  const threads = data?.filter((t) => t.title);
  return (
    <Sheet open={open} onClose={onClose} title="Past conversations">
      {isLoading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="animate-spin text-ink-3" />
        </div>
      ) : !threads?.length ? (
        <p className="py-6 text-center text-[14px] text-ink-3">No conversations yet.</p>
      ) : (
        <div className="-mx-1 max-h-[60vh] divide-y divide-hairline overflow-y-auto">
          {threads.map((t) => (
            <button key={t.id} type="button" onClick={() => onPick(t.id)} className="press flex w-full items-center gap-3 px-1 py-3 text-left">
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[15px] ${t.id === currentId ? "font-semibold text-primary" : "text-ink-1"}`}>{t.title || "New conversation"}</div>
                <div className="text-[12px] text-ink-3">
                  {fmtDate(t.createdAt.slice(0, 10))} · active {timeAgo(t.updatedAt)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function Bubble({ m }: { m: CoachMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-snug text-white">{m.content}</div>
      </div>
    );
  }
  return (
    <div className="max-w-full">
      {m.status && (
        <div className="mb-2 flex items-center gap-2 text-[13px] text-ink-3">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="line-clamp-2">{m.status}</span>
        </div>
      )}
      {m.content && (
        <div className={`coach-md text-[15px] leading-relaxed ${m.error ? "text-bad" : "text-ink-2"}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
          {m.streaming && !m.status && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />}
        </div>
      )}
    </div>
  );
}
