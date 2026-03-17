-- Add action_url column to notifications for clickable ticket links
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
