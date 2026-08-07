-- Marks the first two weeks of Ricky's seeded July 16-31 pay period as
-- already admin-approved (weekly review), so the demo walkthrough starts
-- from a realistic state: 7/16-7/24 already reviewed in earlier weekly
-- cycles, 7/27-7/31 still pending review (the week the walkthrough
-- actually approves live). Run once in the Supabase SQL editor, after
-- seed-ricky-july-pay-period.sql.

update public.time_entries
set status = 'approved',
    approved_by = '954e67be-05cf-4dd9-abaa-ba37790f9032',
    approved_at = now()
where employee_id = '954e67be-05cf-4dd9-abaa-ba37790f9032'
  and work_date between '2026-07-16' and '2026-07-24'
  and status = 'submitted';
