-- Messages replaced by an edit move here (same columns + when/why), so coach_messages only ever holds the live
-- conversation and no reader needs a "hidden" filter. Server-only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS public.coach_messages_archive (
  id UUID PRIMARY KEY,
  thread_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL,
  content JSONB NOT NULL,
  display_text TEXT,
  visible BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL,
  archived_at TIMESTAMP DEFAULT NOW() NOT NULL,
  reason TEXT NOT NULL DEFAULT 'edited'
);
CREATE INDEX IF NOT EXISTS coach_messages_archive_thread_idx ON public.coach_messages_archive (thread_id, created_at);
ALTER TABLE public.coach_messages_archive ENABLE ROW LEVEL SECURITY;
