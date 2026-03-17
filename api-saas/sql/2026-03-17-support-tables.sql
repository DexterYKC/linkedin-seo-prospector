-- SEO Prospector: Support system tables
-- Run in Supabase SQL Editor before using the support feature.

-- 1) Support agents (internal team accounts)
CREATE TABLE IF NOT EXISTS public.support_agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Support tickets (created by users)
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx  ON public.support_tickets(status);

-- 3) Support messages (thread messages on a ticket)
CREATE TABLE IF NOT EXISTS public.support_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_type  TEXT NOT NULL CHECK (sender_type IN ('user', 'agent')),
  sender_id    UUID,
  sender_name  TEXT,
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_messages_ticket_id_idx ON public.support_messages(ticket_id);

-- 4) Auto-update updated_at on tickets when a new message is inserted
CREATE OR REPLACE FUNCTION public.touch_ticket_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.support_tickets SET updated_at = NOW() WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ticket ON public.support_messages;
CREATE TRIGGER trg_touch_ticket
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_ticket_updated_at();

-- 5) Verification
SELECT 'support_agents'  AS table_name, COUNT(*) FROM public.support_agents
UNION ALL
SELECT 'support_tickets' AS table_name, COUNT(*) FROM public.support_tickets
UNION ALL
SELECT 'support_messages' AS table_name, COUNT(*) FROM public.support_messages;