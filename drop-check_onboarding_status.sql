-- Remove check_onboarding_status table.
-- Onboarding flow deferred until a payroll processor is selected.
-- Run against your dev/demo Postgres/Supabase instance first, verify, then apply to any other environment.

-- 1. Confirm the table exists and see what (if anything) references it before dropping.
--    Run this first and review the output.
SELECT
  tc.table_name AS referencing_table,
  kcu.column_name AS referencing_column,
  ccu.table_name AS referenced_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'check_onboarding_status';

-- 2. Drop the table. CASCADE removes any dependent FKs/views found above —
--    review step 1's output first so you know what CASCADE will take with it.
DROP TABLE IF EXISTS check_onboarding_status CASCADE;
