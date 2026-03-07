-- SEO Prospector: plans migration for monthly quotas
-- Run in Supabase SQL Editor (production) after deploying backend code.

-- 1) Ensure new enum values exist (safe to rerun)
ALTER TYPE public.plan_t ADD VALUE IF NOT EXISTS 'FREE';
ALTER TYPE public.plan_t ADD VALUE IF NOT EXISTS 'STARTER';
ALTER TYPE public.plan_t ADD VALUE IF NOT EXISTS 'AGENCY';

-- 2) Migrate legacy plans to new ones
UPDATE public.users
SET plan = 'FREE'::public.plan_t
WHERE plan::text = 'TRIAL';

UPDATE public.users
SET plan = 'AGENCY'::public.plan_t
WHERE plan::text = 'SCALE';

UPDATE public.subscriptions
SET plan = 'FREE'::public.plan_t
WHERE plan::text = 'TRIAL';

UPDATE public.subscriptions
SET plan = 'AGENCY'::public.plan_t
WHERE plan::text = 'SCALE';

-- 3) Optional normalization for null plan rows
UPDATE public.users
SET plan = 'FREE'::public.plan_t
WHERE plan IS NULL;

UPDATE public.subscriptions
SET plan = 'FREE'::public.plan_t
WHERE plan IS NULL;

-- 4) Verification
SELECT 'users' AS table_name, plan::text AS plan, COUNT(*) AS row_count
FROM public.users
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT 'subscriptions' AS table_name, plan::text AS plan, COUNT(*) AS row_count
FROM public.subscriptions
GROUP BY 1, 2
ORDER BY 1, 2;
