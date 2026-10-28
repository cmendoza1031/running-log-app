-- Per-call context for cost analysis: which conversation/activity, which loop step, which tools, why it ended, how long.
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS thread_id UUID;
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS activity_id UUID;
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS iteration INTEGER; -- 0 = first API call of a coach turn
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS tools TEXT[] NOT NULL DEFAULT '{}'; -- tool names called in this response
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS stop_reason TEXT; -- end_turn | tool_use | max_tokens | refusal | aborted
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
CREATE INDEX IF NOT EXISTS ai_usage_thread_idx ON public.ai_usage (thread_id, created_at);
