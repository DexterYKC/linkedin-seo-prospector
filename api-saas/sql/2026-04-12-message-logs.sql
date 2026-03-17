-- Message tracking logs
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS message_logs (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_url         text NOT NULL,
  lead_name           text NOT NULL DEFAULT '',
  opportunity_name    text NOT NULL DEFAULT '',
  generation_count    integer NOT NULL DEFAULT 0,
  last_generated_at   timestamptz,
  was_manually_edited boolean NOT NULL DEFAULT false,
  sent_at             timestamptz,
  sent_status         text,
  message_preview     text NOT NULL DEFAULT '',
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_logs_user_profile_idx
  ON message_logs (user_id, profile_url);

-- Enable RLS
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own message logs"
  ON message_logs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
