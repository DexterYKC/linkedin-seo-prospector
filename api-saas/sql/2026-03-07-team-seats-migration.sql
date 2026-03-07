-- SEO Prospector: per-seat team members
-- Run in Supabase SQL Editor (production) after deploying backend code.

CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'MEMBER',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_members_owner_member_unique UNIQUE (owner_user_id, member_user_id),
  CONSTRAINT team_members_member_unique UNIQUE (member_user_id),
  CONSTRAINT team_members_role_check CHECK (role IN ('MEMBER')),
  CONSTRAINT team_members_status_check CHECK (status IN ('ACTIVE', 'REMOVED'))
);

CREATE INDEX IF NOT EXISTS idx_team_members_owner_user_id
  ON public.team_members(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_team_members_member_user_id
  ON public.team_members(member_user_id);

CREATE OR REPLACE FUNCTION public.set_team_members_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_members_updated_at ON public.team_members;
CREATE TRIGGER trg_team_members_updated_at
BEFORE UPDATE ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION public.set_team_members_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_team_member_self_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id = NEW.member_user_id THEN
    RAISE EXCEPTION 'OWNER_CANNOT_BE_MEMBER';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_members_no_self ON public.team_members;
CREATE TRIGGER trg_team_members_no_self
BEFORE INSERT OR UPDATE ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION public.prevent_team_member_self_link();

-- Verification
SELECT
  owner_user_id,
  COUNT(*) AS active_members
FROM public.team_members
WHERE status = 'ACTIVE'
GROUP BY owner_user_id
ORDER BY active_members DESC;
