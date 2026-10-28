/**
 * Coach chat state, kept outside React so a streaming reply keeps running (and stays visible)
 * when the athlete leaves the Coach tab and comes back.
 */
import { useSyncExternalStore } from "react";
import { apiUrl, authHeaders, apiJson } from "@/lib/queryClient";
import { IOSFeedbackManager } from "@/lib/ios-utils";

export interface CoachMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: string | null;
  error?: boolean;
  stopped?: boolean;
  /** Local placeholder until the server returns the stored row id (needed for editing). */
  pending?: boolean;
}

interface CoachState {
  threadId: string | null;
  messages: CoachMessage[];
  busy: boolean;
  loaded: boolean;
}

interface HistoryResponse {
  threadId: string | null;
  messages: { id: string; role: "user" | "assistant"; content: string }[];
}

let state: CoachState = { threadId: null, messages: [], busy: false, loaded: false };
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<CoachState> | ((s: CoachState) => Partial<CoachState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

export const isCoachBusy = () => state.busy;

export function useCoachStore(): CoachState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Load the latest thread once per session; never while a reply is streaming. */
export async function loadCoachHistory(): Promise<void> {
  if (state.loaded || state.busy) return;
  try {
    const h = await apiJson<HistoryResponse>("GET", "/api/coach/history");
    if (state.busy) return;
    setState({ threadId: h.threadId, messages: h.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })), loaded: true });
  } catch {
    setState({ loaded: true });
  }
}

/** Open a past conversation. */
export async function openCoachThread(threadId: string): Promise<void> {
  if (state.busy || threadId === state.threadId) return;
  const h = await apiJson<HistoryResponse>("GET", `/api/coach/history?threadId=${encodeURIComponent(threadId)}`);
  setState({ threadId: h.threadId, messages: h.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })), loaded: true });
}

export async function startNewCoachThread(): Promise<void> {
  if (state.busy) return;
  const t = await apiJson<{ id: string }>("POST", "/api/coach/threads");
  setState({ threadId: t.id, messages: [] });
}

/** Clear on sign-out so the next account doesn't see this chat. */
export function resetCoachStore() {
  controller?.abort();
  state = { threadId: null, messages: [], busy: false, loaded: false };
  listeners.forEach((l) => l());
}

/** Stop the reply that is streaming now. What arrived so far stays on screen. */
export function stopCoachReply() {
  controller?.abort();
}

/**
 * Send a message and stream the reply into the store. `onDataChanged` runs when the coach edited training data.
 * With `editId`, that user message and everything after it are replaced (server truncates the thread).
 */
export async function sendCoachMessage(text: string, onDataChanged: () => void, editId?: string): Promise<void> {
  const msg = text.trim();
  if (!msg || state.busy) return;
  void IOSFeedbackManager.lightImpact();
  const uid = `u-${Date.now()}`;
  const aid = `a-${Date.now()}`;
  setState((s) => {
    const keep = editId ? s.messages.slice(0, Math.max(0, s.messages.findIndex((m) => m.id === editId))) : s.messages;
    return {
      busy: true,
      messages: [...keep, { id: uid, role: "user", content: msg, pending: true }, { id: aid, role: "assistant", content: "", streaming: true, status: "Thinking…" }],
    };
  });
  controller = new AbortController();
  let committed = "";
  let draft = "";
  const update = (patch: Partial<CoachMessage>, id = aid) => setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const render = () => update({ content: (committed + (committed && draft ? "\n\n" : "") + draft).trim() });
  try {
    const res = await fetch(apiUrl("/api/coach/chat"), {
      method: "POST",
      headers: await authHeaders(true),
      body: JSON.stringify({ message: msg, threadId: state.threadId, editMessageId: editId }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? "The coach is unavailable right now.");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let changed = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let ev: { type: string; content?: string; status?: string; threadId?: string; id?: string; changedData?: boolean };
        try {
          ev = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        switch (ev.type) {
          case "thread":
            if (ev.threadId) setState({ threadId: ev.threadId });
            break;
          case "user_message":
            if (ev.id) update({ id: ev.id, pending: false }, uid);
            break;
          case "token":
            draft += ev.content ?? "";
            update({ status: null });
            render();
            break;
          case "iteration_done":
            if (ev.content) committed = committed ? `${committed}\n\n${ev.content}` : ev.content;
            draft = "";
            render();
            break;
          case "iteration_reset":
            draft = "";
            render();
            break;
          case "progress":
            if (ev.content) update({ status: ev.content.slice(0, 140) });
            break;
          case "tool_start":
            update({ status: ev.status ?? "Working…" });
            break;
          case "done":
            changed = !!ev.changedData;
            break;
          case "error":
            throw new Error(ev.content ?? "Something went wrong");
        }
      }
    }
    update({ streaming: false, status: null });
    if (!committed && !draft) update({ content: "Done." });
    if (changed) onDataChanged();
    void IOSFeedbackManager.successNotification();
  } catch (err) {
    if (controller?.signal.aborted) {
      // Changes the coach already saved (tool calls that finished) are real, so refresh data.
      update({ streaming: false, status: null, stopped: true, content: (committed + draft).trim() });
      onDataChanged();
    } else {
      update({ streaming: false, status: null, error: true, content: (committed + draft).trim() || (err as Error).message });
      void IOSFeedbackManager.errorNotification();
    }
  } finally {
    controller = null;
    setState({ busy: false });
  }
}
