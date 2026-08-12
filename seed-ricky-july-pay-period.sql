-- One-time seed: historical time entries for Ricky
-- (954e67be-05cf-4dd9-abaa-ba37790f9032), pay period July 16-31, 2026.
-- Every weekday in the period EXCEPT July 31 (intentionally left blank so
-- the timekeeping demo simulation can have the employee enter that last
-- day live, trigger the pay-period certification popup, and walk through
-- the admin approval flow on a request that was "just submitted").
-- Charged to Business Development. Run once in the Supabase SQL editor.

do $$
declare
  v_employee_id uuid := '954e67be-05cf-4dd9-abaa-ba37790f9032';
  v_time_code_id uuid;
  v_dates date[] := array[
    '2026-07-16','2026-07-17',
    '2026-07-20','2026-07-21','2026-07-22','2026-07-23','2026-07-24',
    '2026-07-27','2026-07-28','2026-07-29','2026-07-30'
  ]::date[];
  d date;
begin
  select id into v_time_code_id
  from public.time_codes
  where label ilike 'Business Development%'
  limit 1;

  if v_time_code_id is null then
    raise exception 'No time_codes row found matching ''Business Development%%'' -- check the actual label in your time_codes table and adjust this script';
  end if;

  foreach d in array v_dates loop
    insert into public.time_entries (employee_id, work_date, time_code_id, hours, earning_type, status)
    values (v_employee_id, d, v_time_code_id, 8, 'regular', 'submitted');
  end loop;
end $$;
